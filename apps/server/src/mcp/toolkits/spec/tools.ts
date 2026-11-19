import {
  NonNegativeInt,
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  PositiveInt,
  ThreadId,
  ThreadSpecEdit,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadSpecService from "../../../threadSpec/ThreadSpecService.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ThreadSpecService.ThreadSpecService,
  ],
};

const target = {
  environmentId: OrchestratorMcpEnvironmentTarget,
  threadId: Schema.optionalKey(ThreadId.annotate({ description: "Omit for this thread." })),
};

const baseRevision = NonNegativeInt.annotate({
  description:
    "The revision you read, or 0 when the thread has no spec yet. Refused if it moved on.",
});

const note = Schema.String.annotate({
  description: "A few words on what this revision changes. Kept with the revision.",
});

const Written = Schema.Struct({
  threadId: ThreadId,
  revision: Schema.Number,
  changed: Schema.Boolean,
});

const SpecReadTool = Tool.make("t3_spec_read", {
  ...shared,
  description:
    "Read a thread's spec with line numbers and its revision. Omit `revision` for the current one.",
  parameters: Schema.Struct({
    ...target,
    revision: Schema.optionalKey(PositiveInt),
  }),
  success: Schema.Struct({ threadId: ThreadId, text: Schema.String }),
})
  .annotate(Tool.Title, "Read a thread's spec")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const SpecEditTool = Tool.make("t3_spec_edit", {
  ...shared,
  description:
    "Change part of a thread's spec, all or nothing. Each edit is `{old_string, new_string, replace_all?}` (exact text) or `{start_line, end_line, new_text, expected?}` (lines of `base_revision`; `end_line` = `start_line` - 1 inserts).",
  parameters: Schema.Struct({
    ...target,
    base_revision: baseRevision,
    note,
    edits: Schema.Array(ThreadSpecEdit).check(Schema.isMinLength(1)),
  }),
  success: Written,
})
  .annotate(Tool.Title, "Edit a thread's spec")
  // Like send_to_user: it writes thread metadata, never the workspace, so plan mode may call it.
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false);

const SpecUpdateTool = Tool.make("t3_spec_update", {
  ...shared,
  description:
    "Write a thread's whole spec: the first draft or a rewrite. A write that adds history is refused with the line quoted.",
  parameters: Schema.Struct({
    ...target,
    base_revision: baseRevision,
    note,
    spec: Schema.String.annotate({ description: "The full markdown text." }),
  }),
  success: Written,
})
  .annotate(Tool.Title, "Write a thread's spec")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false);

export const SpecToolkit = Toolkit.make(SpecReadTool, SpecEditTool, SpecUpdateTool);
