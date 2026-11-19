import {
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  PipelineRun,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as PipelineService from "../../../pipeline/PipelineService.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    PipelineService.PipelineService,
  ],
};

const target = {
  environmentId: OrchestratorMcpEnvironmentTarget,
  threadId: Schema.optionalKey(ThreadId.annotate({ description: "Omit for this thread." })),
};

const RunResult = Schema.Struct({ threadId: ThreadId, run: Schema.NullOr(PipelineRun) });

const PipelineListTool = Tool.make("t3_pipeline_list", {
  ...shared,
  description:
    "List the pipelines set up in Settings (ordered phases, each a prompt) and the pipeline running on a thread, if any.",
  parameters: Schema.Struct(target),
  success: Schema.Struct({
    pipelines: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        phases: Schema.Array(Schema.Struct({ name: Schema.String, autoAdvance: Schema.Boolean })),
      }),
    ),
    threadId: ThreadId,
    run: Schema.NullOr(PipelineRun),
  }),
})
  .annotate(Tool.Title, "List pipelines")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const PipelineStartTool = Tool.make("t3_pipeline_start", {
  ...shared,
  description:
    "Move a thread into a pipeline when the user asks. Pass `handoff` with everything phase 1 needs: it then starts in a fresh session after this turn. Without it, phase 1 continues the current context.",
  parameters: Schema.Struct({
    ...target,
    pipeline: Schema.String.annotate({ description: "The pipeline's id or name." }),
    handoff: Schema.optionalKey(Schema.String),
  }),
  success: RunResult,
})
  .annotate(Tool.Title, "Start a pipeline")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false);

const PipelineHandoffTool = Tool.make("t3_pipeline_handoff", {
  ...shared,
  description:
    "End this pipeline phase: pass everything the next phase needs, since it starts with a fresh context. Call again to replace it.",
  parameters: Schema.Struct({
    ...target,
    context: Schema.String.annotate({
      description: "Goal, decisions, files involved, and open questions, as markdown.",
    }),
    returnTo: Schema.optionalKey(
      Schema.String.annotate({
        description:
          "An earlier phase's name, to send the work back there (e.g. review requests changes).",
      }),
    ),
  }),
  success: RunResult,
})
  .annotate(Tool.Title, "Hand off a pipeline phase")
  // Writes thread metadata, never the workspace, so a planning phase in plan mode can hand off.
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const PipelineAdvanceTool = Tool.make("t3_pipeline_advance", {
  ...shared,
  description:
    "Start a pipeline's next phase now, only when the user approves it. It uses the latest handoff.",
  parameters: Schema.Struct(target),
  success: RunResult,
})
  .annotate(Tool.Title, "Advance a pipeline")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false);

const PipelineCancelTool = Tool.make("t3_pipeline_cancel", {
  ...shared,
  description: "Stop a thread's pipeline. The thread stays; no further phases start.",
  parameters: Schema.Struct(target),
  success: RunResult,
})
  .annotate(Tool.Title, "Cancel a pipeline")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const PipelineToolkit = Toolkit.make(
  PipelineListTool,
  PipelineStartTool,
  PipelineHandoffTool,
  PipelineAdvanceTool,
  PipelineCancelTool,
);
