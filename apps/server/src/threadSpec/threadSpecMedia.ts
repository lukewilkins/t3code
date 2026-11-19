import {
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  type ThreadId,
  type ThreadSpecStoredMedia,
  type ThreadSpecUnstoredMedia,
} from "@t3tools/contracts";
import {
  markdownDestinationHostPath,
  normalizeMarkdownLinkDestination,
  splitMarkdownLinkSearchAndHash,
} from "@t3tools/shared/markdownLinks";
import { mediaKindFromPath } from "@t3tools/shared/mediaPreview";
import { isWindowsAbsolutePath } from "@t3tools/shared/path";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import {
  createContentAttachmentId,
  createPendingAttachmentId,
  parseThreadSegmentFromAttachmentId,
  toSafeThreadAttachmentSegment,
} from "../attachmentStore.ts";
import { makeIsServerInternalPath } from "../auth/serverInternalPaths.ts";
import * as ServerConfig from "../config.ts";

const MARKDOWN_IMAGE =
  /(!\[[^\]\n]*\]\(\s*)(<[^>\n]*>|[^\s)]+)((?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\))/g;
const HTML_MEDIA_SRC = /(<(?:img|video|audio|source)\b[^>]*?\ssrc\s*=\s*)(["'])([^"'\n]*)\2/gi;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** The local media file a destination names, or null for URLs, relative paths and non-media. */
function localMediaPath(destination: string): string | null {
  const source = normalizeMarkdownLinkDestination(destination);
  if (!/^(?:file:|\/(?!\/)|[A-Za-z]:[\\/])/.test(source)) return null;
  const path = markdownDestinationHostPath(source);
  if (path === null || !(path.startsWith("/") || isWindowsAbsolutePath(path))) return null;
  return mediaKindFromPath(path) === null ? null : path;
}

/**
 * Rewrites every local media path the spec embeds (markdown images and `src` of img, video,
 * audio and source tags) through `replace`; fenced code is left alone because it is shown text.
 */
export function mapSpecLocalMedia(
  markdown: string,
  replace: (path: string) => string | undefined,
): string {
  let fence: string | null = null;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = FENCE.exec(line)?.[1];
      if (fence !== null) {
        if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) {
          fence = null;
        }
        return line;
      }
      if (marker !== undefined) {
        fence = marker;
        return line;
      }
      return line
        .replace(MARKDOWN_IMAGE, (match, open: string, destination: string, close: string) => {
          const path = localMediaPath(destination);
          const next = path === null ? undefined : replace(path);
          if (next === undefined) return match;
          const { hash } = splitMarkdownLinkSearchAndHash(
            normalizeMarkdownLinkDestination(destination),
          );
          const target = `${next}${/^file:/i.test(destination) ? "" : hash}`;
          return `${open}${/[\s()<>]/.test(target) ? `<${target}>` : target}${close}`;
        })
        .replace(HTML_MEDIA_SRC, (match, open: string, quote: string, src: string) => {
          const path = localMediaPath(src);
          const next = path === null ? undefined : replace(path);
          return next === undefined ? match : `${open}${quote}${next}${quote}`;
        });
    })
    .join("\n");
}

export function specLocalMediaPaths(markdown: string): ReadonlyArray<string> {
  const paths = new Set<string>();
  mapSpecLocalMedia(markdown, (path) => {
    paths.add(path);
    return undefined;
  });
  return [...paths];
}

export interface StoredSpecMedia {
  readonly markdown: string;
  readonly stored: ReadonlyArray<ThreadSpecStoredMedia>;
  readonly notStored: ReadonlyArray<ThreadSpecUnstoredMedia>;
  /** Copies this call wrote, which a write that then fails removes. */
  readonly created: ReadonlyArray<string>;
}

type Outcome =
  | { readonly kind: "keep" }
  | { readonly kind: "stored"; readonly path: string; readonly created: boolean }
  | { readonly kind: "notStored"; readonly reason: ThreadSpecUnstoredMedia["reason"] };

/**
 * Copies the local media a spec embeds into the thread's attachments and points the spec at the
 * copies, so spec visuals outlive scratch folders and are deleted with the thread's attachments.
 */
export const storeSpecLocalMedia = Effect.fn("ThreadSpecMedia.store")(function* (
  threadId: ThreadId,
  markdown: string,
) {
  const paths = specLocalMediaPaths(markdown);
  const none: StoredSpecMedia = { markdown, stored: [], notStored: [], created: [] };
  const segment = toSafeThreadAttachmentSegment(threadId);
  if (paths.length === 0 || segment === null) return none;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const isServerInternalPath = yield* makeIsServerInternalPath;
  const attachmentsRoot = yield* fileSystem
    .realPath(config.attachmentsDir)
    .pipe(Effect.orElseSucceed(() => path.resolve(config.attachmentsDir)));

  const store = Effect.fn("ThreadSpecMedia.storeOne")(function* (requested: string) {
    const notStored = (reason: ThreadSpecUnstoredMedia["reason"]): Outcome => ({
      kind: "notStored",
      reason,
    });
    const source = yield* fileSystem.realPath(requested).pipe(Effect.option);
    if (source._tag === "None") return notStored("not-found");
    const info = yield* fileSystem.stat(source.value).pipe(Effect.option);
    if (info._tag === "None" || info.value.type !== "File") return notStored("not-found");
    // The resolved file decides: a `.png` symlink to a key file is not media.
    if (mediaKindFromPath(source.value) === null || (yield* isServerInternalPath(source.value))) {
      return notStored("not-allowed");
    }
    if (
      path.dirname(source.value) === attachmentsRoot &&
      parseThreadSegmentFromAttachmentId(path.parse(source.value).name) === segment
    ) {
      return { kind: "keep" } satisfies Outcome;
    }
    if (Number(info.value.size) > PROVIDER_SEND_TURN_MAX_FILE_BYTES) return notStored("too-large");
    const extension = path.extname(source.value).slice(1).toLowerCase();
    const copied = yield* Effect.gen(function* () {
      const bytes = yield* fileSystem.readFile(source.value);
      const id = createContentAttachmentId(threadId, bytes, extension);
      const target =
        id === null
          ? null
          : resolveAttachmentRelativePath({
              attachmentsDir: config.attachmentsDir,
              relativePath: `${id}.${extension}`,
            });
      if (target === null) return null;
      if (yield* fileSystem.exists(target)) {
        return { kind: "stored", path: target, created: false } satisfies Outcome;
      }
      yield* fileSystem.makeDirectory(config.attachmentsDir, { recursive: true });
      // A rename publishes whole files only; the pending sweep reclaims an abandoned `.part`.
      const partial = `${target}.${createPendingAttachmentId()}.part`;
      yield* fileSystem.writeFile(partial, bytes);
      yield* fileSystem
        .rename(partial, target)
        .pipe(
          Effect.onError(() => fileSystem.remove(partial, { force: true }).pipe(Effect.ignore)),
        );
      return { kind: "stored", path: target, created: true } satisfies Outcome;
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not copy spec media into the thread's attachments", {
          threadId,
          cause,
        }).pipe(Effect.as(null)),
      ),
    );
    return copied ?? notStored("copy-failed");
  });

  const outcomes = new Map<string, Outcome>();
  for (const requested of paths) outcomes.set(requested, yield* store(requested));
  const stored: Array<ThreadSpecStoredMedia> = [];
  const notStored: Array<ThreadSpecUnstoredMedia> = [];
  const created: Array<string> = [];
  for (const [from, outcome] of outcomes) {
    if (outcome.kind === "stored") {
      stored.push({ from, path: outcome.path });
      if (outcome.created) created.push(outcome.path);
    } else if (outcome.kind === "notStored") {
      notStored.push({ path: from, reason: outcome.reason });
    }
  }
  const replacements = new Map(stored.map((entry) => [entry.from, entry.path]));
  return {
    markdown: mapSpecLocalMedia(markdown, (from) => replacements.get(from)),
    stored,
    notStored,
    created,
  } satisfies StoredSpecMedia;
});
