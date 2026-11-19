import { OrchestratorMcpFailure, type ThreadId, type ThreadSpecError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ThreadSpecService from "../../../threadSpec/ThreadSpecService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { SpecToolkit } from "./tools.ts";

const failure = (error: ThreadSpecError) =>
  new OrchestratorMcpFailure({
    code:
      error.reason === "not-found"
        ? "thread_not_found"
        : error.reason === "storage" || error.reason === "forbidden"
          ? "orchestration_error"
          : "invalid_request",
    message: error.message,
  });

const resolveThread = Effect.fn("SpecToolkit.resolveThread")(function* (
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

export const layer = McpToolAccess.toLayer(SpecToolkit, {
  t3_spec_read: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const threadId = yield* resolveThread(input.threadId);
      const specs = yield* ThreadSpecService.ThreadSpecService;
      const text = yield* specs.read(threadId, input.revision).pipe(Effect.mapError(failure));
      return { threadId, text };
    }),
  ),
  t3_spec_edit: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const threadId = yield* resolveThread(input.threadId);
        const specs = yield* ThreadSpecService.ThreadSpecService;
        const result = yield* specs
          .edit(
            threadId,
            { baseRevision: input.base_revision, note: input.note, edits: input.edits },
            "agent",
          )
          .pipe(Effect.mapError(failure));
        return { threadId, ...result };
      }),
  ),
  t3_spec_update: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const threadId = yield* resolveThread(input.threadId);
        const specs = yield* ThreadSpecService.ThreadSpecService;
        const result = yield* specs
          .replace(
            threadId,
            { baseRevision: input.base_revision, note: input.note, spec: input.spec },
            "agent",
          )
          .pipe(Effect.mapError(failure));
        return { threadId, ...result };
      }),
  ),
});
