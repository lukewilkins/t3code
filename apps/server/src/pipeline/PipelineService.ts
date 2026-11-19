import {
  CommandId,
  MessageId,
  type ModelSelection,
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
  type Pipeline,
  PipelineError,
  type PipelineRun,
  type PipelineThreadSnapshot,
  type ThreadId,
  isPipelineRunActive,
} from "@t3tools/contracts";
import { derivePendingBackgroundWork } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as PipelineRuns from "../persistence/PipelineRuns.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  decideAfterRunCompleted,
  findPipeline,
  type PipelinePhaseSend,
  planAdvance,
  planStart,
} from "./pipelineLogic.ts";

export interface PipelineSender {
  readonly createdBy: OrchestrationV2Actor;
  readonly creationSource: OrchestrationV2CreationSource;
}

const SERVER_SENDER: PipelineSender = { createdBy: "agent", creationSource: "server" };

export class PipelineService extends Context.Service<
  PipelineService,
  {
    readonly list: Effect.Effect<ReadonlyArray<Pipeline>, PipelineError>;
    readonly snapshot: (threadId: ThreadId) => Effect.Effect<PipelineThreadSnapshot, PipelineError>;
    /** The thread's run now, then again after each change. */
    readonly changes: (threadId: ThreadId) => Stream.Stream<PipelineThreadSnapshot, PipelineError>;
    /** Records a run at phase 1 without sending anything; the composer sends phase 1 itself. */
    readonly attach: (input: {
      readonly threadId: ThreadId;
      readonly pipelineRef: string;
      readonly baseModelSelection?: ModelSelection;
    }) => Effect.Effect<PipelineRun, PipelineError>;
    /** Attaches and sends phase 1, fresh when the caller hands off its context. */
    readonly start: (input: {
      readonly threadId: ThreadId;
      readonly pipelineRef: string;
      readonly handoff?: string;
    }) => Effect.Effect<PipelineRun, PipelineError>;
    /** `returnTo` names an earlier phase to send the work back to, such as review returning to work. */
    readonly recordHandoff: (
      threadId: ThreadId,
      handoff: string,
      returnTo?: string,
    ) => Effect.Effect<PipelineRun, PipelineError>;
    readonly advance: (input: {
      readonly threadId: ThreadId;
      readonly phaseIndex?: number;
    }) => Effect.Effect<PipelineRun, PipelineError>;
    readonly cancel: (threadId: ThreadId) => Effect.Effect<PipelineThreadSnapshot, PipelineError>;
    /** Decides what a completed run means for the thread's pipeline, and acts on it. */
    readonly settle: (threadId: ThreadId) => Effect.Effect<void, PipelineError>;
    /**
     * Moves pipelines on as their phases' runs complete, after settling phases that handed off
     * while the server was down.
     */
    readonly startWorker: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/pipeline/PipelineService") {}

/** The index of the earlier phase named `name` (ignoring case), or undefined when there is none. */
const findEarlierPhase = (run: PipelineRun, name: string): number | undefined => {
  const index = run.phases.findIndex(
    (phase, at) => at < run.phaseIndex && phase.name.toLowerCase() === name.trim().toLowerCase(),
  );
  return index === -1 ? undefined : index;
};

const pipelineError = (reason: PipelineError["reason"], message: string) =>
  new PipelineError({ reason, message });

const storageError = (cause: unknown) =>
  pipelineError("storage", `Pipeline storage failed: ${String(cause)}`);

const make = Effect.gen(function* () {
  const repository = yield* PipelineRuns.PipelineRunRepository;
  const settings = yield* ServerSettings.ServerSettingsService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const random = yield* SecureRandom.SecureRandom;
  const changed = yield* PubSub.unbounded<ThreadId>();
  // Every mutation reads the row, decides and writes; one at a time keeps a double click to one advance.
  const lock = yield* Semaphore.make(1);

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const getRun = (threadId: ThreadId) =>
    repository.get(threadId).pipe(Effect.map(Option.getOrNull), Effect.mapError(storageError));

  const putRun = (run: PipelineRun) =>
    repository.put(run).pipe(
      Effect.mapError(storageError),
      Effect.tap(() => PubSub.publish(changed, run.threadId)),
      Effect.as(run),
    );

  const requireActiveRun = Effect.fn("PipelineService.requireActiveRun")(function* (
    threadId: ThreadId,
  ) {
    const run = yield* getRun(threadId);
    if (run === null || !isPipelineRunActive(run)) {
      return yield* pipelineError("not-found", "This thread has no pipeline running.");
    }
    return run;
  });

  const list = settings.getSettings.pipe(
    Effect.map((current) => current.pipelines),
    Effect.mapError((cause) => pipelineError("storage", `Could not read settings: ${cause}`)),
  );

  const snapshot = Effect.fn("PipelineService.snapshot")(function* (threadId: ThreadId) {
    return { threadId, run: yield* getRun(threadId) } satisfies PipelineThreadSnapshot;
  });

  const newRun = Effect.fn("PipelineService.newRun")(function* (input: {
    readonly threadId: ThreadId;
    readonly pipelineRef: string;
    readonly baseModelSelection: ModelSelection | null;
  }) {
    const existing = yield* getRun(input.threadId);
    if (isPipelineRunActive(existing)) {
      return yield* pipelineError(
        "invalid-state",
        `This thread is already running "${existing?.pipelineName}". Cancel it first.`,
      );
    }
    const pipeline = findPipeline(yield* list, input.pipelineRef);
    if (pipeline === undefined) {
      return yield* pipelineError("not-found", `No pipeline named "${input.pipelineRef}".`);
    }
    const now = yield* nowIso;
    return {
      threadId: input.threadId,
      runKey: yield* random.uuidV4().pipe(Effect.orDie),
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
      phases: pipeline.phases,
      phaseIndex: 0,
      step: 0,
      status: "running",
      handoff: null,
      returnTo: null,
      returnCount: 0,
      baseModelSelection: input.baseModelSelection,
      createdAt: now,
      updatedAt: now,
    } satisfies PipelineRun;
  });

  const send = Effect.fn("PipelineService.send")(function* (
    threadId: ThreadId,
    phaseSend: PipelinePhaseSend,
  ) {
    const thread = yield* projections
      .getThread(threadId)
      .pipe(Effect.mapError(() => pipelineError("not-found", "The thread no longer exists.")));
    yield* threads
      .sendToThread({
        projectId: thread.projectId,
        threadId,
        // Same ids on a retry, so the orchestrator applies the phase once.
        commandId: CommandId.make(phaseSend.key),
        messageId: MessageId.make(phaseSend.key),
        text: phaseSend.text,
        attachments: [],
        ...(phaseSend.modelSelection === undefined
          ? {}
          : { modelSelection: phaseSend.modelSelection }),
        mode: "queue",
        ...(phaseSend.freshContext ? { freshContext: true } : {}),
        ...SERVER_SENDER,
      })
      .pipe(
        Effect.mapError((cause) =>
          pipelineError("dispatch", `Could not send the next phase: ${cause.message}`),
        ),
      );
  });

  const attach: PipelineService["Service"]["attach"] = (input) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const run = yield* newRun({
          threadId: input.threadId,
          pipelineRef: input.pipelineRef,
          baseModelSelection: input.baseModelSelection ?? null,
        });
        return yield* putRun(run);
      }),
    );

  const start: PipelineService["Service"]["start"] = (input) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const thread = yield* projections
          .getThread(input.threadId)
          .pipe(Effect.mapError(() => pipelineError("not-found", "The thread no longer exists.")));
        const run = yield* newRun({
          threadId: input.threadId,
          pipelineRef: input.pipelineRef,
          baseModelSelection: thread.modelSelection,
        });
        yield* send(input.threadId, planStart(run, input.handoff));
        return yield* putRun(run);
      }),
    );

  const recordHandoff: PipelineService["Service"]["recordHandoff"] = (
    threadId,
    handoff,
    returnTo,
  ) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const run = yield* requireActiveRun(threadId);
        const target = returnTo === undefined ? null : findEarlierPhase(run, returnTo);
        if (target === undefined) {
          const earlier = run.phases.slice(0, run.phaseIndex).map((phase) => phase.name);
          return yield* pipelineError(
            "invalid-state",
            earlier.length === 0
              ? "This is the first phase, so there is no earlier phase to return to."
              : `returnTo must name an earlier phase: ${earlier.join(", ")}.`,
          );
        }
        // Refining after the run ended keeps the thread waiting for approval.
        const status = run.status === "awaiting_approval" ? "awaiting_approval" : "ready";
        return yield* putRun({
          ...run,
          status,
          handoff,
          returnTo: target,
          updatedAt: yield* nowIso,
        });
      }),
    );

  /** The last assistant reply, for a phase whose provider could not call the handoff tool. */
  const fallbackHandoff = Effect.fn("PipelineService.fallbackHandoff")(function* (
    threadId: ThreadId,
  ) {
    const { messages } = yield* projections
      .getThreadRecords(threadId, ["messages"], { messageRoles: ["assistant"] })
      .pipe(Effect.orElseSucceed(() => ({ messages: [] })));
    return messages.at(-1)?.text ?? "";
  });

  const advanceLocked = Effect.fn("PipelineService.advanceLocked")(function* (
    threadId: ThreadId,
    expectedPhaseIndex: number | undefined,
  ) {
    const run = yield* requireActiveRun(threadId);
    if (expectedPhaseIndex !== undefined && expectedPhaseIndex !== run.phaseIndex) {
      return yield* pipelineError("invalid-state", "The pipeline already moved past that phase.");
    }
    const handoff = run.handoff ?? (yield* fallbackHandoff(threadId));
    const plan = planAdvance(run, handoff, yield* nowIso);
    if (plan === null) {
      return yield* putRun({ ...run, status: "completed", updatedAt: yield* nowIso });
    }
    yield* send(threadId, plan.send);
    return yield* putRun(plan.run);
  });

  const advance: PipelineService["Service"]["advance"] = (input) =>
    lock.withPermits(1)(advanceLocked(input.threadId, input.phaseIndex));

  const cancel: PipelineService["Service"]["cancel"] = (threadId) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const run = yield* requireActiveRun(threadId);
        const cancelled = yield* putRun({ ...run, status: "cancelled", updatedAt: yield* nowIso });
        return { threadId, run: cancelled } satisfies PipelineThreadSnapshot;
      }),
    );

  const changes: PipelineService["Service"]["changes"] = (threadId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changed);
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

  const hasOutstandingWork = Effect.fn("PipelineService.hasOutstandingWork")(function* (
    threadId: ThreadId,
  ) {
    const thread = yield* projections.getThread(threadId);
    const records = yield* projections.getThreadRecords(
      threadId,
      ["runs", "providerThreads", "runtimeRequests", "turnItems"],
      {
        runStatuses: ["queued", "preparing", "starting", "running", "rolled_back"],
        includeLatestRun: true,
        turnItemStatuses: ["pending", "running", "waiting"],
        runtimeRequestStatuses: ["pending"],
        ...(thread.activeProviderThreadId === null
          ? {}
          : { providerThreadIds: [thread.activeProviderThreadId] }),
      },
    );
    const live = records.runs.filter((run) => run.status !== "rolled_back");
    if (
      live.some((run) => ["queued", "preparing", "starting", "running"].includes(run.status)) ||
      records.runtimeRequests.some((request) => request.status === "pending")
    ) {
      return true;
    }
    const latestRun = live.reduce<(typeof live)[number] | null>(
      (latest, run) => (latest === null || run.ordinal > latest.ordinal ? run : latest),
      null,
    );
    // Background work wakes the thread again; the phase moves on after that run instead.
    return (
      derivePendingBackgroundWork({
        latestRun,
        runs: live,
        providerThreads: records.providerThreads,
        turnItems: records.turnItems,
        activeProviderThreadId: thread.activeProviderThreadId,
      }).length > 0
    );
  });

  const settle = Effect.fn("PipelineService.settle")(function* (threadId: ThreadId) {
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const run = yield* getRun(threadId);
        if (run === null || run.status !== "ready") return;
        const outstanding = yield* hasOutstandingWork(threadId).pipe(
          Effect.mapError((cause) =>
            pipelineError("storage", `Could not read the thread: ${cause}`),
          ),
        );
        const decision = decideAfterRunCompleted(run, outstanding);
        switch (decision) {
          case "complete":
            yield* putRun({ ...run, status: "completed", updatedAt: yield* nowIso });
            return;
          case "await_approval":
            yield* putRun({ ...run, status: "awaiting_approval", updatedAt: yield* nowIso });
            return;
          case "advance":
            // A failed automatic send waits for approval, so Continue retries it.
            yield* advanceLocked(threadId, run.phaseIndex).pipe(
              Effect.tapError(() =>
                Effect.flatMap(nowIso, (updatedAt) =>
                  putRun({ ...run, status: "awaiting_approval", updatedAt }),
                ),
              ),
            );
            return;
          case "wait":
          case "none":
            return;
        }
      }),
    );
  });

  const settleLogged = (threadId: ThreadId) =>
    settle(threadId).pipe(
      Effect.catch((cause) => Effect.logWarning("pipeline advance skipped", { threadId, cause })),
    );

  const startWorker = Effect.fn("PipelineService.startWorker")(function* () {
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
        event.type === "run.updated" && event.payload.status === "completed"
          ? settleLogged(event.threadId)
          : Effect.void,
      ),
    );
    // Subscribed first, so a run that completes during the sweep is not missed.
    const ready = yield* repository
      .listReadyThreadIds()
      .pipe(Effect.orElseSucceed((): ReadonlyArray<ThreadId> => []));
    yield* Effect.forEach(ready, settleLogged, { discard: true });
  });

  return PipelineService.of({
    list,
    snapshot,
    changes,
    attach,
    start,
    recordHandoff,
    advance,
    cancel,
    settle,
    startWorker,
  });
});

export const layer = Layer.effect(PipelineService, make);
