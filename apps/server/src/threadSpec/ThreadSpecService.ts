import {
  type ThreadId,
  ThreadSpecError,
  type ThreadSpecEdit,
  type ThreadSpecRevision,
  type ThreadSpecRevisionAuthor,
  type ThreadSpecSnapshot,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  applyThreadSpecEdits,
  numberSpecLines,
  ThreadSpecEditError,
  threadSpecChangedSections,
  threadSpecGoal,
} from "@t3tools/shared/threadSpec";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadSpecRevisions from "../persistence/ThreadSpecRevisions.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { parseThreadSpecGuardVerdict } from "./threadSpecGuard.ts";

/** A slow guard must not hold an agent's write; past this the write goes through. */
export const THREAD_SPEC_GUARD_TIMEOUT = "45 seconds";

export interface ThreadSpecWriteResult {
  readonly revision: number;
  /** False when the text was already the current revision, so nothing was added. */
  readonly changed: boolean;
}

export class ThreadSpecService extends Context.Service<
  ThreadSpecService,
  {
    readonly snapshot: (threadId: ThreadId) => Effect.Effect<ThreadSpecSnapshot, ThreadSpecError>;
    readonly revision: (
      threadId: ThreadId,
      revision: number,
    ) => Effect.Effect<ThreadSpecRevision, ThreadSpecError>;
    /** The spec as an agent reads it: line numbers and its revision; the current one by default. */
    readonly read: (
      threadId: ThreadId,
      revision?: number,
    ) => Effect.Effect<string, ThreadSpecError>;
    readonly edit: (
      threadId: ThreadId,
      input: {
        readonly baseRevision: number;
        readonly note: string;
        readonly edits: ReadonlyArray<ThreadSpecEdit>;
      },
      author: ThreadSpecRevisionAuthor,
    ) => Effect.Effect<ThreadSpecWriteResult, ThreadSpecError>;
    readonly replace: (
      threadId: ThreadId,
      input: { readonly baseRevision: number; readonly spec: string; readonly note: string },
      author: ThreadSpecRevisionAuthor,
    ) => Effect.Effect<ThreadSpecWriteResult, ThreadSpecError>;
    /** The whole spec now, then again after each new revision. */
    readonly changes: (threadId: ThreadId) => Stream.Stream<ThreadSpecSnapshot, ThreadSpecError>;
  }
>()("t3/threadSpec/ThreadSpecService") {}

const isEditError = Schema.is(ThreadSpecEditError);

const specError = (reason: ThreadSpecError["reason"], message: string) =>
  new ThreadSpecError({ reason, message });

const conflictMessage = (currentRevision: number, baseRevision: number) =>
  currentRevision === 0
    ? `Not saved: this thread has no spec yet, so base_revision must be 0, not ${baseRevision}. Write the first draft with t3_spec_update.`
    : `Not saved: the spec is at revision ${currentRevision}, not ${baseRevision}. Read it again with t3_spec_read and redo the change.`;

const make = Effect.gen(function* () {
  const revisions = yield* ThreadSpecRevisions.ThreadSpecRevisionRepository;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const fileSystem = yield* FileSystem.FileSystem;
  const written = yield* PubSub.unbounded<ThreadId>();

  const storage = (operation: string) => (cause: unknown) =>
    Effect.logWarning(`Thread spec storage failed: ${operation}`, { cause }).pipe(
      Effect.as(specError("storage", "The thread spec could not be read or saved.")),
    );

  const requireThread = Effect.fn("ThreadSpecService.requireThread")(function* (
    threadId: ThreadId,
  ) {
    const shell = yield* threads
      .getThreadShell(threadId)
      .pipe(Effect.catch((cause) => Effect.flip(storage("getThreadShell")(cause))));
    if (shell === null || shell.deletedAt !== null) {
      return yield* specError("not-found", `Thread ${threadId} was not found.`);
    }
    return shell;
  });

  const snapshot: ThreadSpecService["Service"]["snapshot"] = Effect.fn(
    "ThreadSpecService.snapshot",
  )(function* (threadId) {
    yield* requireThread(threadId);
    const [current, list] = yield* Effect.all([
      revisions.current(threadId),
      revisions.list(threadId),
    ]).pipe(Effect.catch((cause) => Effect.flip(storage("snapshot")(cause))));
    return { threadId, current: Option.getOrNull(current), revisions: list };
  });

  const revision: ThreadSpecService["Service"]["revision"] = Effect.fn(
    "ThreadSpecService.revision",
  )(function* (threadId, number) {
    yield* requireThread(threadId);
    const found = yield* revisions
      .get(threadId, number)
      .pipe(Effect.catch((cause) => Effect.flip(storage("revision")(cause))));
    if (Option.isNone(found)) {
      return yield* specError("not-found", `This thread's spec has no revision ${number}.`);
    }
    return found.value;
  });

  const read: ThreadSpecService["Service"]["read"] = Effect.fn("ThreadSpecService.read")(
    function* (threadId, requested) {
      yield* requireThread(threadId);
      const current = yield* revisions
        .current(threadId)
        .pipe(Effect.catch((cause) => Effect.flip(storage("read")(cause))));
      if (Option.isNone(current)) {
        return "This thread has no spec yet. Write the first draft with t3_spec_update and base_revision 0.";
      }
      const shown =
        requested === undefined || requested === current.value.revision
          ? current.value
          : yield* revision(threadId, requested);
      const label = shown.revision === current.value.revision ? " (current)" : "";
      return [
        `Revision ${shown.revision}${label} of the spec, saved ${shown.createdAt} by ${shown.author}${shown.note ? `: ${shown.note}` : ""}.`,
        ...(label === ""
          ? [`The current revision is ${current.value.revision}; write against that one.`]
          : [`Pass base_revision ${shown.revision} when you write.`]),
        "",
        numberSpecLines(shown.body),
      ].join("\n");
    },
  );

  // Fails open: a guard that errors or runs long lets the write through.
  const guard = Effect.fn("ThreadSpecService.guard")(function* (
    threadId: ThreadId,
    before: string,
    after: string,
    kind: "edit" | "replace",
    currentRevision: number,
  ) {
    const { sections, added } = threadSpecChangedSections(before, after);
    if (added.trim() === "") return;
    const shell = yield* requireThread(threadId);
    const verdict = yield* Effect.gen(function* () {
      const project = yield* projects.get(shell.projectId);
      if (Option.isNone(project)) return undefined;
      const settings = resolveProjectSettings(
        yield* serverSettings.getSettings,
        shell.projectId,
      ).settings;
      const worktreePath = shell.worktreePath;
      const worktreeExists =
        worktreePath !== null &&
        (yield* fileSystem.exists(worktreePath).pipe(Effect.orElseSucceed(() => false)));
      const raw = yield* textGeneration.checkThreadSpecWrite({
        cwd: worktreeExists ? worktreePath : project.value.workspaceRoot,
        threadTitle: shell.title,
        goal: threadSpecGoal(before),
        kind,
        sections,
        added,
        modelSelection: settings.textGenerationModelSelection,
        projectId: shell.projectId,
      });
      return parseThreadSpecGuardVerdict(raw, added);
    }).pipe(
      Effect.timeout(THREAD_SPEC_GUARD_TIMEOUT),
      Effect.catch((cause) =>
        Effect.logWarning("Thread spec guard could not judge the write, so it goes through", {
          threadId,
          cause,
        }).pipe(Effect.as(undefined)),
      ),
    );
    if (verdict !== undefined && !verdict.ok) {
      return yield* specError(
        "rejected",
        `Not saved: this write adds history or logging, and the spec is a current summary. ${verdict.reason} Offending line: "${verdict.quote}". Rewrite it as the current state (a decision goes inline in the Plan step or acceptance criterion it shapes, with its reason) and write again. Nothing was changed; the spec is still at revision ${currentRevision}.`,
      );
    }
  });

  const write = Effect.fn("ThreadSpecService.write")(function* (input: {
    readonly threadId: ThreadId;
    readonly baseRevision: number;
    readonly note: string;
    readonly author: ThreadSpecRevisionAuthor;
    readonly kind: "edit" | "replace";
    readonly next: (before: string, currentRevision: number) => string;
  }) {
    const { threadId, baseRevision } = input;
    yield* requireThread(threadId);
    const current = yield* revisions
      .current(threadId)
      .pipe(Effect.catch((cause) => Effect.flip(storage("write")(cause))));
    const currentRevision = Option.match(current, { onNone: () => 0, onSome: (r) => r.revision });
    if (currentRevision !== baseRevision) {
      return yield* specError("conflict", conflictMessage(currentRevision, baseRevision));
    }
    const before = Option.match(current, { onNone: () => "", onSome: (r) => r.body });
    const after = yield* Effect.try({
      try: () => input.next(before, currentRevision),
      catch: (cause) =>
        isEditError(cause)
          ? specError("invalid-edit", `Not saved: ${cause.message}`)
          : specError("invalid-edit", "Not saved: the edit could not be applied."),
    });
    if (after === before) return { revision: currentRevision, changed: false };
    if (input.author === "agent") {
      yield* guard(threadId, before, after, input.kind, currentRevision);
    }
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    const stored = yield* revisions
      .append(threadId, {
        body: after,
        author: input.author,
        note: input.note,
        baseRevision,
        createdAt,
      })
      .pipe(
        Effect.catchTags({
          ThreadSpecConflictError: (conflict) =>
            Effect.fail(
              specError("conflict", conflictMessage(conflict.currentRevision, baseRevision)),
            ),
          PersistenceSqlError: (cause) => Effect.flip(storage("append")(cause)),
          PersistenceDecodeError: (cause) => Effect.flip(storage("append")(cause)),
        }),
      );
    const changed = stored.revision !== currentRevision;
    if (changed) yield* PubSub.publish(written, threadId);
    return { revision: stored.revision, changed };
  });

  const edit: ThreadSpecService["Service"]["edit"] = Effect.fn("ThreadSpecService.edit")(
    function (threadId, input, author) {
      return write({
        threadId,
        baseRevision: input.baseRevision,
        note: input.note,
        author,
        kind: "edit",
        next: (before, currentRevision) =>
          applyThreadSpecEdits(before, input.edits, currentRevision),
      });
    },
  );

  const replace: ThreadSpecService["Service"]["replace"] = Effect.fn("ThreadSpecService.replace")(
    function (threadId, input, author) {
      return write({
        threadId,
        baseRevision: input.baseRevision,
        note: input.note,
        author,
        kind: "replace",
        next: () => input.spec,
      });
    },
  );

  const changes: ThreadSpecService["Service"]["changes"] = (threadId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before reading so a write in between is not missed.
        const subscription = yield* PubSub.subscribe(written);
        const initial = yield* snapshot(threadId);
        return Stream.concat(
          Stream.make(initial),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((id) => id === threadId),
            Stream.mapEffect(() => snapshot(threadId)),
          ),
        );
      }),
    );

  return ThreadSpecService.of({ snapshot, revision, read, edit, replace, changes });
});

export const layer = Layer.effect(ThreadSpecService, make);
