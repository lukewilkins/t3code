import { WS_METHODS, type ThreadSpecRevisionInfo } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

const REVISION_IDLE_TTL_MS = 10 * 60_000;

/**
 * Per-environment thread spec atoms. `live` streams the whole `ThreadSpecSnapshot` and re-sends it
 * after each revision; mounting it opens the stream, so read it only while the spec is on screen.
 * `revision` fetches one immutable revision body; the newest body is already in `live().current`.
 */
export function createThreadSpecEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    live: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:thread-spec:live",
      tag: WS_METHODS.threadSpecSubscribe,
      idleTtlMs: 30_000,
    }),
    revision: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:thread-spec:revision",
      tag: WS_METHODS.threadSpecRevision,
      staleTimeMs: 24 * 60 * 60_000,
      idleTtlMs: REVISION_IDLE_TTL_MS,
    }),
  };
}

export type ThreadSpecEnvironmentAtoms = ReturnType<typeof createThreadSpecEnvironmentAtoms>;

export interface ShownThreadSpecRevision {
  /** The revision on screen, or null when the spec has none yet. */
  readonly shown: number | null;
  readonly latest: number | null;
  /** The revision before `shown`, which "show changes" diffs against; null for the first. */
  readonly previous: number | null;
  /** True while following the newest revision. */
  readonly isLatest: boolean;
}

/**
 * Which revision to show. `pinned` is the revision a reader stepped back to, or null to follow the
 * newest; a pin that is the newest, or no longer exists, follows the newest too.
 */
export function resolveShownThreadSpecRevision(
  revisions: ReadonlyArray<Pick<ThreadSpecRevisionInfo, "revision">>,
  pinned: number | null,
): ShownThreadSpecRevision {
  const latest = revisions.at(-1)?.revision ?? null;
  if (latest === null) return { shown: null, latest: null, previous: null, isLatest: true };
  const index =
    pinned === null || pinned === latest
      ? revisions.length - 1
      : revisions.findIndex((entry) => entry.revision === pinned);
  const shownIndex = index === -1 ? revisions.length - 1 : index;
  return {
    shown: revisions[shownIndex]!.revision,
    latest,
    previous: revisions[shownIndex - 1]?.revision ?? null,
    isLatest: shownIndex === revisions.length - 1,
  };
}
