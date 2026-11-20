import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  MAX_AUTO_PIPELINE_RETURNS,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type Pipeline,
  type PipelineRun,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import Migration0100 from "../persistence/Migrations/104_PipelineRuns.ts";
import * as PipelineRuns from "../persistence/PipelineRuns.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as PipelineService from "./PipelineService.ts";

const threadId = ThreadId.make("thread-1");
const selection = (model: string): ModelSelection => ({
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model,
});

const pipeline: Pipeline = {
  id: "delivery",
  name: "Delivery",
  phases: [
    { id: "plan", name: "Plan", prompt: "Plan it.", autoAdvance: false, modelSelection: null },
    {
      id: "build",
      name: "Build",
      prompt: "Build it.",
      autoAdvance: true,
      modelSelection: selection("fable"),
    },
    {
      id: "review",
      name: "Review",
      prompt: "Review it.",
      autoAdvance: false,
      modelSelection: null,
    },
  ],
};

interface ThreadState {
  /** Runs `hasOutstandingWork` sees; a queued one holds the phase back. */
  runs: ReadonlyArray<{ readonly id: string; readonly ordinal: number; readonly status: string }>;
  assistantText: string | null;
  failSends: boolean;
  /** Message ids the thread already holds, as if a failed send had committed. */
  committedMessageIds: ReadonlyArray<string>;
}

const makeHarness = Effect.fn("makePipelineHarness")(function* () {
  const sent = yield* Ref.make<ReadonlyArray<ThreadManagementService.ThreadManagementSendInput>>(
    [],
  );
  const state: ThreadState = {
    runs: [{ id: "run-1", ordinal: 1, status: "completed" }],
    assistantText: null,
    failSends: false,
    committedMessageIds: [],
  };
  const thread = {
    id: threadId,
    projectId: ProjectId.make("project-1"),
    modelSelection: selection("opus"),
    activeProviderThreadId: null,
  } as unknown as OrchestrationV2AppThread;
  const dependencies = Layer.mergeAll(
    PipelineRuns.layer.pipe(
      Layer.provideMerge(
        Layer.effectDiscard(Migration0100).pipe(
          Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
        ),
      ),
    ),
    Layer.mock(ServerSettings.ServerSettingsService)({
      getSettings: Effect.succeed({ ...DEFAULT_SERVER_SETTINGS, pipelines: [pipeline] }),
    }),
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      sendToThread: (input) =>
        state.failSends
          ? Effect.fail({ message: "provider offline" } as never)
          : // Yields like a real dispatch, so concurrent advances interleave without the lock.
            Effect.yieldNow.pipe(
              Effect.andThen(Ref.update(sent, (all) => [...all, input])),
              Effect.as({} as never),
            ),
    }),
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThread: () => Effect.succeed(thread),
      getThreadRecords: (_threadId, fields, filter) =>
        Effect.succeed(
          (fields.includes("messages" as never)
            ? {
                thread,
                messages:
                  filter?.messageIds !== undefined
                    ? filter.messageIds
                        .filter((id) => state.committedMessageIds.includes(id))
                        .map((id) => ({ id, role: "user", text: "" }))
                    : state.assistantText === null
                      ? []
                      : [{ role: "assistant", text: state.assistantText }],
              }
            : {
                thread,
                runs: state.runs,
                providerThreads: [],
                runtimeRequests: [],
                turnItems: [],
              }) as never,
        ),
    }),
    Layer.mock(Orchestrator.OrchestratorV2)({ streamDomainEvents: Stream.empty }),
    Layer.succeed(
      SecureRandom.SecureRandom,
      SecureRandom.make((size) => new Uint8Array(size).fill(7)),
    ),
  );
  const context = yield* Layer.build(PipelineService.layer.pipe(Layer.provideMerge(dependencies)));
  const service = Layer.succeedContext(context);
  return {
    sent,
    state,
    pipelines: yield* PipelineService.PipelineService.pipe(Effect.provide(service)),
    repository: yield* PipelineRuns.PipelineRunRepository.pipe(Effect.provide(service)),
  };
});

const runOf = (repository: PipelineRuns.PipelineRunRepository["Service"]) =>
  repository.get(threadId).pipe(Effect.map(Option.getOrThrow));

describe("PipelineService", () => {
  it.effect("waits for approval after a manual phase hands off, and advances once", () =>
    Effect.gen(function* () {
      const { pipelines, repository, sent } = yield* makeHarness();
      yield* pipelines.attach({ threadId, pipelineRef: "Delivery" });
      yield* pipelines.recordHandoff(threadId, "the plan");
      yield* pipelines.settle(threadId);
      assert.strictEqual((yield* runOf(repository)).status, "awaiting_approval");
      assert.deepStrictEqual(yield* Ref.get(sent), []);

      // Refining after the run ended keeps it waiting rather than dropping back to ready.
      yield* pipelines.recordHandoff(threadId, "the revised plan");
      assert.strictEqual((yield* runOf(repository)).status, "awaiting_approval");

      const advanced = yield* pipelines.advance({ threadId, phaseIndex: 0 });
      assert.strictEqual(advanced.phaseIndex, 1);
      const stale = yield* Effect.exit(pipelines.advance({ threadId, phaseIndex: 0 }));
      assert.isTrue(Exit.isFailure(stale));

      const [send] = yield* Ref.get(sent);
      assert.strictEqual((yield* Ref.get(sent)).length, 1);
      assert.isTrue(send?.freshContext);
      assert.deepStrictEqual(send?.modelSelection, selection("fable"));
      assert.include(send?.text, "the revised plan");
    }),
  );

  it.effect("auto-advances only once nothing else is pending, back on the base model", () =>
    Effect.gen(function* () {
      const { pipelines, repository, sent, state } = yield* makeHarness();
      yield* pipelines.attach({
        threadId,
        pipelineRef: "delivery",
        baseModelSelection: selection("opus"),
      });
      yield* pipelines.advance({ threadId, phaseIndex: 0 });
      yield* pipelines.recordHandoff(threadId, "built");

      state.runs = [...state.runs, { id: "run-2", ordinal: 2, status: "queued" }];
      yield* pipelines.settle(threadId);
      assert.strictEqual((yield* runOf(repository)).status, "ready");
      assert.strictEqual((yield* Ref.get(sent)).length, 1);

      state.runs = [{ id: "run-2", ordinal: 2, status: "completed" }];
      yield* pipelines.settle(threadId);
      const run = yield* runOf(repository);
      assert.strictEqual(run.phaseIndex, 2);
      const review = (yield* Ref.get(sent))[1];
      // Review is a Default phase after Build overrode the model, so it returns to the base.
      assert.deepStrictEqual(review?.modelSelection, selection("opus"));
    }),
  );

  it.effect("hands off the last assistant reply when the phase never called the tool", () =>
    Effect.gen(function* () {
      const { pipelines, sent, state } = yield* makeHarness();
      state.assistantText = "what the agent said last";
      yield* pipelines.attach({ threadId, pipelineRef: "Delivery" });
      yield* pipelines.advance({ threadId });
      assert.include((yield* Ref.get(sent))[0]?.text, "what the agent said last");
    }),
  );

  it.effect("completes after the last phase hands off", () =>
    Effect.gen(function* () {
      const { pipelines, repository } = yield* makeHarness();
      yield* pipelines.attach({ threadId, pipelineRef: "Delivery" });
      yield* pipelines.advance({ threadId, phaseIndex: 0 });
      yield* pipelines.advance({ threadId, phaseIndex: 1 });
      yield* pipelines.recordHandoff(threadId, "reviewed");
      yield* pipelines.settle(threadId);
      assert.strictEqual((yield* runOf(repository)).status, "completed");
    }),
  );

  it.effect("refuses to attach over an active run until it is cancelled", () =>
    Effect.gen(function* () {
      const { pipelines, repository } = yield* makeHarness();
      yield* pipelines.attach({ threadId, pipelineRef: "Delivery" });
      const second = yield* Effect.exit(pipelines.attach({ threadId, pipelineRef: "Delivery" }));
      assert.isTrue(Exit.isFailure(second));

      yield* pipelines.cancel(threadId);
      const again = yield* pipelines.attach({ threadId, pipelineRef: "Delivery" });
      assert.strictEqual(again.status, "running");
      assert.strictEqual((yield* runOf(repository)).phaseIndex, 0);
    }),
  );

  it.effect("review sends the work back to an earlier phase under a new message id", () =>
    Effect.gen(function* () {
      const { pipelines, repository, sent } = yield* makeHarness();
      yield* pipelines.attach({ threadId, pipelineRef: "Delivery" });
      yield* pipelines.advance({ threadId, phaseIndex: 0 });
      yield* pipelines.advance({ threadId, phaseIndex: 1 });

      const unknown = yield* Effect.exit(pipelines.recordHandoff(threadId, "fix", "Deploy"));
      assert.isTrue(Exit.isFailure(unknown));

      yield* pipelines.recordHandoff(threadId, "fix the retry path", "build");
      yield* pipelines.settle(threadId);
      // Review is a manual phase, so going back waits for approval like going forward does.
      assert.strictEqual((yield* runOf(repository)).status, "awaiting_approval");

      yield* pipelines.advance({ threadId, phaseIndex: 2 });
      const run = yield* runOf(repository);
      assert.strictEqual(run.phaseIndex, 1);
      // A user-approved return doesn't count toward the automatic cap.
      assert.strictEqual(run.returnCount, 0);
      const keys = (yield* Ref.get(sent)).map((input) => input.messageId);
      assert.strictEqual(new Set(keys).size, keys.length);
      assert.include((yield* Ref.get(sent)).at(-1)?.text, "Handoff from Review");
    }),
  );

  it.effect("two Continue clicks on the same phase send it once", () =>
    Effect.gen(function* () {
      const { pipelines, repository, sent } = yield* makeHarness();
      yield* pipelines.attach({ threadId, pipelineRef: "Delivery" });
      const results = yield* Effect.forEach(
        [0, 0],
        (phaseIndex) => Effect.exit(pipelines.advance({ threadId, phaseIndex })),
        { concurrency: "unbounded" },
      );
      assert.strictEqual(results.filter(Exit.isSuccess).length, 1);
      assert.strictEqual((yield* Ref.get(sent)).length, 1);
      assert.strictEqual((yield* runOf(repository)).phaseIndex, 1);
    }),
  );

  it.effect(
    "a failed automatic send waits for approval, and Continue retries the same message",
    () =>
      Effect.gen(function* () {
        const { pipelines, repository, sent, state } = yield* makeHarness();
        yield* pipelines.attach({ threadId, pipelineRef: "Delivery" });
        yield* pipelines.advance({ threadId, phaseIndex: 0 });
        yield* pipelines.recordHandoff(threadId, "built");
        const firstKey = (yield* Ref.get(sent))[0]?.messageId;

        state.failSends = true;
        assert.isTrue(Exit.isFailure(yield* Effect.exit(pipelines.settle(threadId))));
        const stuck = yield* runOf(repository);
        assert.strictEqual(stuck.status, "awaiting_approval");
        assert.strictEqual(stuck.phaseIndex, 1);

        state.failSends = false;
        yield* pipelines.advance({ threadId, phaseIndex: 1 });
        const keys = (yield* Ref.get(sent)).map((input) => input.messageId);
        assert.strictEqual(keys.length, 2);
        assert.notStrictEqual(keys[1], firstKey);
        assert.strictEqual((yield* runOf(repository)).phaseIndex, 2);
      }),
  );

  it.effect("a send that reports failure after its message committed still moves the run on", () =>
    Effect.gen(function* () {
      const { pipelines, repository, state } = yield* makeHarness();
      const attached = yield* pipelines.attach({ threadId, pipelineRef: "Delivery" });
      state.failSends = true;
      state.committedMessageIds = [`pipeline:${attached.runKey}:1`];
      yield* pipelines.advance({ threadId, phaseIndex: 0 });
      assert.strictEqual((yield* runOf(repository)).phaseIndex, 1);
    }),
  );

  it.effect(
    "Continue waits while a turn runs, and a failed turn after a handoff waits for the user",
    () =>
      Effect.gen(function* () {
        const { pipelines, repository, sent, state } = yield* makeHarness();
        yield* pipelines.attach({ threadId, pipelineRef: "Delivery" });
        state.runs = [{ id: "run-1", ordinal: 1, status: "running" }];
        assert.isTrue(
          Exit.isFailure(yield* Effect.exit(pipelines.advance({ threadId, phaseIndex: 0 }))),
        );

        state.runs = [{ id: "run-1", ordinal: 1, status: "completed" }];
        yield* pipelines.advance({ threadId, phaseIndex: 0 });
        // Build auto-advances, but its turn failed after handing off.
        yield* pipelines.recordHandoff(threadId, "half built");
        state.runs = [{ id: "run-2", ordinal: 2, status: "failed" }];
        yield* pipelines.settle(threadId);
        assert.strictEqual((yield* runOf(repository)).status, "awaiting_approval");
        assert.strictEqual((yield* Ref.get(sent)).length, 1);
      }),
  );

  it.effect("automatic returns stop at the cap and wait for the user", () =>
    Effect.gen(function* () {
      const { pipelines, repository, sent } = yield* makeHarness();
      const attached = yield* pipelines.attach({ threadId, pipelineRef: "Delivery" });
      const autoReview = attached.phases.map((phase) =>
        phase.id === "review" ? { ...phase, autoAdvance: true } : phase,
      );
      const returning = (returnCount: number): PipelineRun => ({
        ...attached,
        phases: autoReview,
        phaseIndex: 2,
        step: 4,
        status: "ready",
        handoff: "fix the retry path",
        returnTo: 1,
        returnCount,
      });

      yield* repository.put(returning(MAX_AUTO_PIPELINE_RETURNS - 1));
      yield* pipelines.settle(threadId);
      const returned = yield* runOf(repository);
      assert.strictEqual(returned.phaseIndex, 1);
      assert.strictEqual(returned.returnCount, MAX_AUTO_PIPELINE_RETURNS);

      yield* repository.put(returning(MAX_AUTO_PIPELINE_RETURNS));
      yield* pipelines.settle(threadId);
      assert.strictEqual((yield* runOf(repository)).status, "awaiting_approval");
      assert.strictEqual((yield* Ref.get(sent)).length, 1);
    }),
  );

  it.effect("starting the worker settles phases that handed off while the server was down", () =>
    Effect.gen(function* () {
      const { pipelines, repository, sent } = yield* makeHarness();
      const attached = yield* pipelines.attach({ threadId, pipelineRef: "Delivery" });
      const handedOff: PipelineRun = {
        ...attached,
        phaseIndex: 1,
        status: "ready",
        handoff: "built offline",
      };
      yield* repository.put(handedOff);

      yield* Effect.scoped(pipelines.startWorker().pipe(Effect.flatMap(Fiber.join)));
      assert.strictEqual((yield* runOf(repository)).phaseIndex, 2);
      assert.include((yield* Ref.get(sent))[0]?.text, "built offline");
    }),
  );
});
