import { assert, describe, it } from "@effect/vitest";
import { ProviderInstanceId, ThreadId, type PipelineRun } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import Migration0100 from "./Migrations/104_PipelineRuns.ts";
import * as PipelineRuns from "./PipelineRuns.ts";

const layer = PipelineRuns.layer.pipe(
  Layer.provideMerge(
    Layer.effectDiscard(Migration0100).pipe(
      Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
    ),
  ),
);

const threadId = ThreadId.make("thread-1");
const selection = (model: string) => ({
  instanceId: ProviderInstanceId.make("codex"),
  model,
});

const run: PipelineRun = {
  threadId,
  runKey: "run-a",
  pipelineId: "pl",
  pipelineName: "Flow",
  phases: [
    { id: "p1", name: "Plan", prompt: "Plan", autoAdvance: true, modelSelection: selection("big") },
    { id: "p2", name: "Build", prompt: "", autoAdvance: false, modelSelection: null },
  ],
  phaseIndex: 1,
  step: 3,
  status: "ready",
  handoff: "notes",
  returnTo: 0,
  returnCount: 2,
  baseModelSelection: selection("base"),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

describe("PipelineRunRepository", () => {
  it.effect("round-trips JSON columns and replaces the row on put", () =>
    Effect.gen(function* () {
      const repo = yield* PipelineRuns.PipelineRunRepository;
      assert.isTrue(Option.isNone(yield* repo.get(threadId)));

      yield* repo.put(run);
      assert.deepStrictEqual(yield* repo.get(threadId), Option.some(run));

      const replacement: PipelineRun = {
        ...run,
        runKey: "run-b",
        status: "completed",
        handoff: null,
        returnTo: null,
        returnCount: 0,
        step: 0,
        baseModelSelection: null,
        phases: [run.phases[1]!],
        phaseIndex: 0,
      };
      yield* repo.put(replacement);
      assert.deepStrictEqual(yield* repo.get(threadId), Option.some(replacement));
    }).pipe(Effect.provide(layer)),
  );
});
