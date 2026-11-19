import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
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
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import Migration0100 from "../persistence/Migrations/100_PipelineRuns.ts";
import Migration0101 from "../persistence/Migrations/101_PipelineRunReturns.ts";
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
}

const makeHarness = Effect.fn("makePipelineHarness")(function* () {
  const sent = yield* Ref.make<ReadonlyArray<ThreadManagementService.ThreadManagementSendInput>>(
    [],
  );
  const state: ThreadState = {
    runs: [{ id: "run-1", ordinal: 1, status: "completed" }],
    assistantText: null,
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
        Layer.effectDiscard(Migration0100.pipe(Effect.andThen(Migration0101))).pipe(
          Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
        ),
      ),
    ),
    Layer.mock(ServerSettings.ServerSettingsService)({
      getSettings: Effect.succeed({ ...DEFAULT_SERVER_SETTINGS, pipelines: [pipeline] }),
    }),
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      sendToThread: (input) =>
        Ref.update(sent, (all) => [...all, input]).pipe(Effect.as({} as never)),
    }),
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThread: () => Effect.succeed(thread),
      getThreadRecords: (_threadId, fields) =>
        Effect.succeed(
          (fields.includes("messages" as never)
            ? {
                thread,
                messages:
                  state.assistantText === null
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
      assert.strictEqual(run.returnCount, 1);
      const keys = (yield* Ref.get(sent)).map((input) => input.messageId);
      assert.strictEqual(new Set(keys).size, keys.length);
      assert.include((yield* Ref.get(sent)).at(-1)?.text, "Handoff from Review");
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

      yield* Effect.scoped(pipelines.startWorker());
      assert.strictEqual((yield* runOf(repository)).phaseIndex, 2);
      assert.include((yield* Ref.get(sent))[0]?.text, "built offline");
    }),
  );
});
