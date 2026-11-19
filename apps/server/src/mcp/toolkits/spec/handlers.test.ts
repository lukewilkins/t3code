import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId, ThreadSpecError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadSpecService from "../../../threadSpec/ThreadSpecService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as SpecHandlers from "./handlers.ts";
import { SpecToolkit } from "./tools.ts";

const callerThreadId = ThreadId.make("thread:spec-caller");
const otherThreadId = ThreadId.make("thread:spec-other");

const mcpScope = (options: { readonly inThread: boolean; readonly orchestration: boolean }) =>
  Layer.succeed(McpInvocationContext.McpInvocationContext, {
    environmentId: EnvironmentId.make("environment:spec"),
    requestNamespace: "provider:spec",
    thread: options.inThread
      ? {
          threadId: callerThreadId,
          providerSessionId: "provider:spec",
          providerInstanceId: ProviderInstanceId.make("codex"),
        }
      : undefined,
    client: undefined,
    capabilities: new Set(options.orchestration ? ["orchestration" as const] : []),
    issuedAt: 0,
  });

const withSpecs = <A, E, R>(
  specs: Partial<ThreadSpecService.ThreadSpecService["Service"]>,
  options: { readonly inThread: boolean; readonly orchestration: boolean },
  program: Effect.Effect<A, E, R>,
) =>
  program.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(SpecHandlers.layer).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            mcpScope(options),
            Layer.mock(ThreadManagement.ThreadManagementService)({
              getThreadShell: (id) => Effect.succeed(liveThreadShell(id)),
            }),
            Layer.mock(ThreadSpecService.ThreadSpecService)(specs),
          ),
        ),
      ),
    ),
  );

const inThread = { inThread: true, orchestration: true };

it.effect("writes to the calling thread by default and to a named thread when given", () =>
  Effect.gen(function* () {
    const written = yield* Ref.make<ReadonlyArray<unknown>>([]);
    const specs = {
      edit: (id, input, author) =>
        Ref.update(written, (all) => [...all, [id, input, author]]).pipe(
          Effect.as({ revision: 4, changed: true }),
        ),
      replace: (id, input, author) =>
        Ref.update(written, (all) => [...all, [id, input, author]]).pipe(
          Effect.as({ revision: 1, changed: true }),
        ),
    } satisfies Partial<ThreadSpecService.ThreadSpecService["Service"]>;
    yield* withSpecs(
      specs,
      inThread,
      Effect.gen(function* () {
        const toolkit = yield* SpecToolkit;
        const last = <Name extends "t3_spec_edit" | "t3_spec_update">(
          name: Name,
          params: Parameters<typeof toolkit.handle<Name>>[1],
        ) =>
          toolkit.handle(name, params).pipe(
            Stream.unwrap,
            Stream.runCollect,
            Effect.map((parts) => parts.at(-1)?.result),
          );
        const edits = [{ old_string: "a", new_string: "b" }];
        expect(yield* last("t3_spec_edit", { base_revision: 3, note: "n", edits })).toEqual({
          threadId: callerThreadId,
          revision: 4,
          changed: true,
        });
        expect(
          yield* last("t3_spec_update", {
            threadId: otherThreadId,
            base_revision: 0,
            note: "first",
            spec: "# Goal",
          }),
        ).toEqual({ threadId: otherThreadId, revision: 1, changed: true });
      }),
    );
    expect(yield* Ref.get(written)).toEqual([
      [
        callerThreadId,
        { baseRevision: 3, note: "n", edits: [{ old_string: "a", new_string: "b" }] },
        "agent",
      ],
      [otherThreadId, { baseRevision: 0, note: "first", spec: "# Goal" }, "agent"],
    ]);
  }),
);

it.effect("maps each spec error to the MCP failure code an agent can act on", () =>
  Effect.gen(function* () {
    const failing = (reason: ThreadSpecError["reason"]) => ({
      replace: () => Effect.fail(new ThreadSpecError({ reason, message: `${reason} message` })),
    });
    const codes: Record<string, unknown> = {};
    for (const reason of [
      "conflict",
      "rejected",
      "invalid-edit",
      "not-found",
      "storage",
    ] as const) {
      codes[reason] = yield* withSpecs(
        failing(reason),
        inThread,
        Effect.gen(function* () {
          const toolkit = yield* SpecToolkit;
          return yield* toolkit
            .handle("t3_spec_update", { base_revision: 1, note: "", spec: "x" })
            .pipe(
              Stream.unwrap,
              Stream.runCollect,
              Effect.map((parts) => parts.at(-1)?.result),
            );
        }),
      );
    }
    expect(codes).toMatchObject({
      conflict: { code: "invalid_request", message: "conflict message" },
      rejected: { code: "invalid_request", message: "rejected message" },
      "invalid-edit": { code: "invalid_request" },
      "not-found": { code: "thread_not_found" },
      storage: { code: "orchestration_error" },
    });
  }),
);

it.effect(
  "asks for a threadId outside a thread and refuses a credential without orchestration",
  () =>
    Effect.gen(function* () {
      const specs = { read: () => Effect.succeed("spec text") };
      const read = (options: { readonly inThread: boolean; readonly orchestration: boolean }) =>
        withSpecs(
          specs,
          options,
          Effect.gen(function* () {
            const toolkit = yield* SpecToolkit;
            return yield* toolkit.handle("t3_spec_read", {}).pipe(
              Stream.unwrap,
              Stream.runCollect,
              Effect.map((parts) => parts.at(-1)?.result),
            );
          }),
        );
      expect(yield* read({ inThread: false, orchestration: true })).toMatchObject({
        code: "target_required",
      });
      expect(yield* read({ inThread: true, orchestration: false })).toMatchObject({
        code: "capability_denied",
      });
      expect(yield* read(inThread)).toEqual({ threadId: callerThreadId, text: "spec text" });
    }),
);
