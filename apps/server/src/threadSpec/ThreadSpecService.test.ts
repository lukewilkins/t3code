import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  TextGenerationError,
  ThreadId,
} from "@t3tools/contracts";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { ThreadSpecConflictError } from "../persistence/Errors.ts";
import Migration0103 from "../persistence/Migrations/103_ThreadSpecRevisions.ts";
import * as ThreadSpecRevisions from "../persistence/ThreadSpecRevisions.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ThreadSpecService from "./ThreadSpecService.ts";

const threadId = ThreadId.make("thread-1");
const otherThreadId = ThreadId.make("thread-2");
const missingThreadId = ThreadId.make("thread-missing");

const shell = {
  title: "Export page",
  projectId: ProjectId.make("project-1"),
  worktreePath: null,
  deletedAt: null,
};

type Guard = ProviderTextGeneration["checkThreadSpecWrite"];
const allow: Guard = () => Effect.succeed({ ok: true, reason: "", quote: "" });

const sqlLayer = Layer.effectDiscard(Migration0103).pipe(
  Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
);

const harness = (checkThreadSpecWrite: Guard) =>
  ThreadSpecService.layer.pipe(
    Layer.provideMerge(ThreadSpecRevisions.layer),
    Layer.provide(
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadShell: (id: ThreadId) => Effect.succeed(id === missingThreadId ? null : shell),
      } as never),
    ),
    Layer.provide(
      Layer.mock(ProjectStore.ProjectStoreV2)({
        get: () => Effect.succeedSome({ workspaceRoot: "/work" }),
      } as never),
    ),
    Layer.provide(
      Layer.mock(ServerSettings.ServerSettingsService)({
        getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
      }),
    ),
    Layer.provide(Layer.mock(TextGeneration.TextGeneration)({ checkThreadSpecWrite })),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-thread-spec-test-" })),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(sqlLayer),
  );

const agentReplace = (spec: string, baseRevision: number) =>
  Effect.flatMap(ThreadSpecService.ThreadSpecService, (specs) =>
    specs.replace(threadId, { baseRevision, spec, note: "n" }, "agent"),
  );

describe("ThreadSpecService", () => {
  it.effect("numbers revisions from 1 and keeps every body", () =>
    Effect.gen(function* () {
      const specs = yield* ThreadSpecService.ThreadSpecService;
      assert.deepStrictEqual(
        yield* specs.replace(
          threadId,
          { baseRevision: 0, spec: "# Goal\none", note: "first" },
          "agent",
        ),
        {
          revision: 1,
          changed: true,
        },
      );
      assert.deepStrictEqual(
        yield* specs.edit(
          threadId,
          { baseRevision: 1, note: "second", edits: [{ old_string: "one", new_string: "two" }] },
          "user",
        ),
        { revision: 2, changed: true },
      );
      const snapshot = yield* specs.snapshot(threadId);
      assert.strictEqual(snapshot.current?.revision, 2);
      assert.strictEqual(snapshot.current?.body, "# Goal\ntwo");
      assert.deepStrictEqual(
        snapshot.revisions.map((r) => [r.revision, r.author, r.note]),
        [
          [1, "agent", "first"],
          [2, "user", "second"],
        ],
      );
      assert.strictEqual((yield* specs.revision(threadId, 1)).body, "# Goal\none");
    }).pipe(Effect.provide(harness(allow))),
  );

  it.effect("refuses a write from a stale base revision and stores nothing", () =>
    Effect.gen(function* () {
      const specs = yield* ThreadSpecService.ThreadSpecService;
      yield* specs.replace(threadId, { baseRevision: 0, spec: "a", note: "" }, "user");
      yield* specs.replace(threadId, { baseRevision: 1, spec: "b", note: "" }, "user");
      const stale = yield* specs
        .replace(threadId, { baseRevision: 1, spec: "c", note: "" }, "user")
        .pipe(Effect.flip);
      assert.strictEqual(stale.reason, "conflict");
      assert.include(stale.message, "revision 2, not 1");
      const first = yield* specs
        .replace(otherThreadId, { baseRevision: 3, spec: "c", note: "" }, "user")
        .pipe(Effect.flip);
      assert.include(first.message, "no spec yet");
      assert.strictEqual((yield* specs.snapshot(threadId)).current?.body, "b");
      assert.lengthOf((yield* specs.snapshot(otherThreadId)).revisions, 0);
    }).pipe(Effect.provide(harness(allow))),
  );

  it.effect("adds no revision, and skips the guard, when the text is unchanged", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);
      const layer = harness(() =>
        Ref.update(calls, (n) => n + 1).pipe(Effect.as({ ok: true, reason: "", quote: "" })),
      );
      return yield* Effect.gen(function* () {
        const specs = yield* ThreadSpecService.ThreadSpecService;
        yield* specs.replace(threadId, { baseRevision: 0, spec: "same", note: "" }, "user");
        const again = yield* agentReplace("same", 1);
        assert.deepStrictEqual(again, { revision: 1, changed: false });
        assert.lengthOf((yield* specs.snapshot(threadId)).revisions, 1);
        assert.strictEqual(yield* Ref.get(calls), 0);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("refuses an edit that does not apply and says which one", () =>
    Effect.gen(function* () {
      const specs = yield* ThreadSpecService.ThreadSpecService;
      yield* specs.replace(threadId, { baseRevision: 0, spec: "a", note: "" }, "user");
      const error = yield* specs
        .edit(
          threadId,
          { baseRevision: 1, note: "", edits: [{ old_string: "zzz", new_string: "b" }] },
          "agent",
        )
        .pipe(Effect.flip);
      assert.strictEqual(error.reason, "invalid-edit");
      assert.include(error.message, "Edit 1");
      assert.strictEqual((yield* specs.snapshot(threadId)).current?.revision, 1);
    }).pipe(Effect.provide(harness(allow))),
  );

  it.effect("reads the spec for an agent with line numbers, and says when there is none", () =>
    Effect.gen(function* () {
      const specs = yield* ThreadSpecService.ThreadSpecService;
      assert.include(yield* specs.read(threadId), "no spec yet");
      yield* specs.replace(threadId, { baseRevision: 0, spec: "a\nb", note: "" }, "user");
      yield* specs.replace(threadId, { baseRevision: 1, spec: "a\nc", note: "" }, "user");
      const current = yield* specs.read(threadId);
      assert.include(current, "Revision 2 (current)");
      assert.include(current, "   2\tc");
      const earlier = yield* specs.read(threadId, 1);
      assert.include(earlier, "Revision 1 of the spec");
      assert.include(earlier, "The current revision is 2");
      assert.strictEqual((yield* specs.read(threadId, 9).pipe(Effect.flip)).reason, "not-found");
    }).pipe(Effect.provide(harness(allow))),
  );

  it.effect("refuses a thread that does not exist", () =>
    Effect.gen(function* () {
      const specs = yield* ThreadSpecService.ThreadSpecService;
      assert.strictEqual(
        (yield* specs.snapshot(missingThreadId).pipe(Effect.flip)).reason,
        "not-found",
      );
      const write = yield* specs
        .replace(missingThreadId, { baseRevision: 0, spec: "a", note: "" }, "agent")
        .pipe(Effect.flip);
      assert.strictEqual(write.reason, "not-found");
    }).pipe(Effect.provide(harness(allow))),
  );
});

describe("ThreadSpecService guard", () => {
  it.effect("blocks an agent write the guard refuses, quoting the line, and stores nothing", () =>
    Effect.gen(function* () {
      const inputs = yield* Ref.make<ReadonlyArray<Parameters<Guard>[0]>>([]);
      const layer = harness((input) =>
        Ref.update(inputs, (all) => [...all, input]).pipe(
          Effect.as({ ok: false, reason: "That is a change log.", quote: "Round 2: fixed it" }),
        ),
      );
      return yield* Effect.gen(function* () {
        const specs = yield* ThreadSpecService.ThreadSpecService;
        yield* specs.replace(
          threadId,
          { baseRevision: 0, spec: "## Goal\nShip it\n\n## Status\nopen", note: "" },
          "user",
        );
        const error = yield* specs
          .edit(
            threadId,
            {
              baseRevision: 1,
              note: "",
              edits: [{ old_string: "open", new_string: "Round 2: fixed it" }],
            },
            "agent",
          )
          .pipe(Effect.flip);
        assert.strictEqual(error.reason, "rejected");
        assert.include(error.message, 'Offending line: "Round 2: fixed it"');
        assert.include(error.message, "still at revision 1");
        assert.strictEqual((yield* specs.snapshot(threadId)).current?.revision, 1);
        const [input] = yield* Ref.get(inputs);
        assert.strictEqual(input?.kind, "edit");
        assert.strictEqual(input?.goal, "Ship it");
        assert.strictEqual(input?.added, "Round 2: fixed it");
        assert.strictEqual(input?.threadTitle, "Export page");
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("lets a refused line through when it was not added by this write", () =>
    Effect.gen(function* () {
      const specs = yield* ThreadSpecService.ThreadSpecService;
      yield* specs.replace(
        threadId,
        { baseRevision: 0, spec: "Round 2: old\nx", note: "" },
        "user",
      );
      const stored = yield* agentReplace("Round 2: old\ny", 1);
      assert.strictEqual(stored.revision, 2);
    }).pipe(
      Effect.provide(
        harness(() => Effect.succeed({ ok: false, reason: "History.", quote: "Round 2: old" })),
      ),
    ),
  );

  it.effect("does not guard a user's write or a write that adds nothing", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);
      const layer = harness(() =>
        Ref.update(calls, (n) => n + 1).pipe(Effect.as({ ok: false, reason: "no", quote: "a" })),
      );
      return yield* Effect.gen(function* () {
        const specs = yield* ThreadSpecService.ThreadSpecService;
        yield* specs.replace(threadId, { baseRevision: 0, spec: "a\nb", note: "" }, "user");
        yield* specs.replace(threadId, { baseRevision: 1, spec: "a\nb\nc", note: "" }, "user");
        yield* agentReplace("a\nb", 2);
        assert.strictEqual(yield* Ref.get(calls), 0);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("lets the write through when the guard fails", () =>
    Effect.gen(function* () {
      const stored = yield* agentReplace("new text", 0);
      assert.deepStrictEqual(stored, { revision: 1, changed: true });
    }).pipe(
      Effect.provide(
        harness(() =>
          Effect.fail(
            new TextGenerationError({ operation: "checkThreadSpecWrite", detail: "down" }),
          ),
        ),
      ),
    ),
  );

  it.effect("lets the write through when the guard outlasts its timeout", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const layer = harness(() =>
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      );
      return yield* Effect.gen(function* () {
        const write = yield* Effect.forkChild(agentReplace("new text", 0));
        yield* Deferred.await(started);
        yield* TestClock.adjust(ThreadSpecService.THREAD_SPEC_GUARD_TIMEOUT);
        assert.deepStrictEqual(yield* Fiber.join(write), { revision: 1, changed: true });
      }).pipe(Effect.provide(layer));
    }),
  );
});

describe("ThreadSpecService.changes", () => {
  it.effect(
    "emits the whole spec, then a fresh snapshot after each new revision of that thread",
    () =>
      Effect.gen(function* () {
        const specs = yield* ThreadSpecService.ThreadSpecService;
        const pull = yield* Stream.toPull(specs.changes(threadId));
        const [initial] = yield* pull;
        assert.strictEqual(initial?.current, null);

        yield* specs.replace(otherThreadId, { baseRevision: 0, spec: "other", note: "" }, "user");
        yield* specs.replace(threadId, { baseRevision: 0, spec: "mine", note: "" }, "user");
        const [next] = yield* pull;
        assert.strictEqual(next?.threadId, threadId);
        assert.strictEqual(next?.current?.body, "mine");

        yield* specs.replace(threadId, { baseRevision: 1, spec: "mine", note: "" }, "user");
        yield* specs.replace(threadId, { baseRevision: 1, spec: "mine 2", note: "" }, "user");
        const [after] = yield* pull;
        assert.strictEqual(after?.current?.revision, 2);
      }).pipe(Effect.provide(harness(allow)), Effect.scoped),
  );
});

describe("ThreadSpecRevisionRepository", () => {
  it.effect(
    "refuses an append whose base is not the current revision, naming the current one",
    () =>
      Effect.gen(function* () {
        const repo = yield* ThreadSpecRevisions.ThreadSpecRevisionRepository;
        const input = { author: "agent", note: "", createdAt: "2026-01-01T00:00:00.000Z" } as const;
        yield* repo.append(threadId, { ...input, body: "a", baseRevision: 0 });
        const error = yield* repo
          .append(threadId, { ...input, body: "b", baseRevision: 0 })
          .pipe(Effect.flip);
        assert.instanceOf(error, ThreadSpecConflictError);
        assert.strictEqual((error as ThreadSpecConflictError).currentRevision, 1);
        assert.lengthOf(yield* repo.list(threadId), 1);
      }).pipe(Effect.provide(ThreadSpecRevisions.layer.pipe(Layer.provideMerge(sqlLayer)))),
  );
});

describe("ThreadSpecService media", () => {
  const scratchImage = Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const dir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-spec-scratch-" });
    const file = `${dir}/shot one.png`;
    yield* fileSystem.writeFileString(file, "png bytes");
    return file;
  });
  const attachmentFiles = Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const { attachmentsDir } = yield* ServerConfig.ServerConfig;
    return (yield* fileSystem.exists(attachmentsDir))
      ? yield* fileSystem.readDirectory(attachmentsDir)
      : [];
  });

  it.effect("copies embedded local media into the thread's attachments and names the copies", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { attachmentsDir } = yield* ServerConfig.ServerConfig;
      const specs = yield* ThreadSpecService.ThreadSpecService;
      const source = yield* scratchImage;
      const first = yield* agentReplace(`![shot](<${source}>)\n<img src="${source}">`, 0);
      const [stored] = first.stored ?? [];
      assert.strictEqual(stored?.from, source);
      assert.isTrue(stored?.path.startsWith(`${attachmentsDir}/thread-1-`));
      assert.strictEqual(yield* fileSystem.readFileString(stored?.path ?? ""), "png bytes");
      const body = (yield* specs.snapshot(threadId)).current?.body ?? "";
      assert.notInclude(body, source);
      assert.include(body, `<img src="${stored?.path}">`);

      // The same bytes again, from a new revision, reuse the copy.
      const second = yield* agentReplace(`${body}\n![again](<${source}>)`, 1);
      assert.strictEqual(second.stored?.[0]?.path, stored?.path);
      assert.lengthOf(yield* attachmentFiles, 1);
    }).pipe(Effect.provide(harness(allow)), Effect.scoped),
  );

  it.effect(
    "leaves missing, non-media and server-internal files as written, symlinked or not",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const { secretsDir, attachmentsDir } = yield* ServerConfig.ServerConfig;
        const specs = yield* ThreadSpecService.ThreadSpecService;
        yield* fileSystem.makeDirectory(secretsDir, { recursive: true });
        const secret = `${secretsDir}/key.png`;
        yield* fileSystem.writeFileString(secret, "secret");
        const link = `${yield* fileSystem.makeTempDirectoryScoped()}/innocent.png`;
        yield* fileSystem.symlink(secret, link);
        const notes = `${yield* fileSystem.makeTempDirectoryScoped()}/notes.json`;
        yield* fileSystem.writeFileString(notes, "{}");
        const disguised = `${yield* fileSystem.makeTempDirectoryScoped()}/disguised.png`;
        yield* fileSystem.symlink(notes, disguised);
        const traversal = `${attachmentsDir}/../secrets/key.png`;
        const missing = "/home/user/missing.png";
        const spec = [secret, link, disguised, traversal, missing]
          .map((p) => `![x](${p})`)
          .join("\n");
        const result = yield* agentReplace(spec, 0);
        assert.deepStrictEqual(result.notStored, [
          { path: secret, reason: "not-allowed" },
          { path: link, reason: "not-allowed" },
          { path: disguised, reason: "not-allowed" },
          { path: traversal, reason: "not-allowed" },
          { path: missing, reason: "not-found" },
        ]);
        assert.isUndefined(result.stored);
        assert.strictEqual((yield* specs.snapshot(threadId)).current?.body, spec);
        assert.lengthOf(yield* attachmentFiles, 0);
      }).pipe(Effect.provide(harness(allow)), Effect.scoped),
  );

  it.effect("removes a losing write's copy, and its retry stores one again", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      const layer = harness(() =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(gate)),
          Effect.as({ ok: true, reason: "", quote: "" }),
        ),
      );
      return yield* Effect.gen(function* () {
        const specs = yield* ThreadSpecService.ThreadSpecService;
        const source = yield* scratchImage;
        const write = yield* Effect.forkChild(agentReplace(`![shot](<${source}>)`, 0));
        yield* Deferred.await(started);
        yield* specs.replace(threadId, { baseRevision: 0, spec: "theirs", note: "" }, "user");
        yield* Deferred.succeed(gate, undefined);
        const error = yield* Fiber.join(write).pipe(Effect.flip);
        assert.strictEqual(error.reason, "conflict");
        assert.lengthOf(yield* attachmentFiles, 0);
        const retry = yield* agentReplace(`theirs\n![shot](<${source}>)`, 1);
        assert.strictEqual(retry.revision, 2);
        assert.lengthOf(yield* attachmentFiles, 1);
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped),
  );
});
