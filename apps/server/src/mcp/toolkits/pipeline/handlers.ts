import { OrchestratorMcpFailure, type PipelineError, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as PipelineService from "../../../pipeline/PipelineService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { PipelineToolkit } from "./tools.ts";

const failure = (error: PipelineError) =>
  new OrchestratorMcpFailure({
    code:
      error.reason === "storage" || error.reason === "dispatch"
        ? "orchestration_error"
        : "invalid_request",
    message: error.message,
  });

const resolveThread = Effect.fn("PipelineToolkit.resolveThread")(function* (
  threadId: ThreadId | undefined,
) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  if (!scope.capabilities.has("orchestration")) {
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "This MCP credential does not grant orchestration capabilities.",
    });
  }
  const resolved = threadId ?? scope.thread?.threadId;
  if (resolved === undefined) {
    return yield* new OrchestratorMcpFailure({
      code: "target_required",
      message: "Pass threadId: this MCP client is not running inside a T3 thread.",
    });
  }
  return resolved;
});

export const layer = McpToolAccess.toLayer(PipelineToolkit, {
  t3_pipeline_list: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const threadId = yield* resolveThread(input.threadId);
      const pipelines = yield* PipelineService.PipelineService;
      const listed = yield* pipelines.list.pipe(Effect.mapError(failure));
      const { run } = yield* pipelines.snapshot(threadId).pipe(Effect.mapError(failure));
      return {
        pipelines: listed.map((pipeline) => ({
          id: pipeline.id,
          name: pipeline.name,
          phases: pipeline.phases.map((phase) => ({
            name: phase.name,
            autoAdvance: phase.autoAdvance,
          })),
        })),
        threadId,
        run,
      };
    }),
  ),
  t3_pipeline_start: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const threadId = yield* resolveThread(input.threadId);
        const pipelines = yield* PipelineService.PipelineService;
        const run = yield* pipelines
          .start({
            threadId,
            pipelineRef: input.pipeline,
            ...(input.handoff === undefined ? {} : { handoff: input.handoff }),
          })
          .pipe(Effect.mapError(failure));
        return { threadId, run };
      }),
  ),
  t3_pipeline_handoff: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const threadId = yield* resolveThread(input.threadId);
        const pipelines = yield* PipelineService.PipelineService;
        const run = yield* pipelines
          .recordHandoff(threadId, input.context, input.returnTo)
          .pipe(Effect.mapError(failure));
        return { threadId, run };
      }),
  ),
  t3_pipeline_advance: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const threadId = yield* resolveThread(input.threadId);
        const pipelines = yield* PipelineService.PipelineService;
        const run = yield* pipelines.advance({ threadId }).pipe(Effect.mapError(failure));
        return { threadId, run };
      }),
  ),
  t3_pipeline_cancel: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const threadId = yield* resolveThread(input.threadId);
        const pipelines = yield* PipelineService.PipelineService;
        return yield* pipelines.cancel(threadId).pipe(Effect.mapError(failure));
      }),
  ),
});
