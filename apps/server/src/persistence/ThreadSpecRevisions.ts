import * as Context from "effect/Context";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import {
  ThreadId,
  ThreadSpecRevision,
  ThreadSpecRevisionAuthor,
  ThreadSpecRevisionInfo,
} from "@t3tools/contracts";

import {
  PersistenceDecodeError,
  PersistenceSqlError,
  ThreadSpecConflictError,
  type ThreadSpecRevisionRepositoryError,
} from "./Errors.ts";

const ThreadIdRequest = Schema.Struct({ threadId: ThreadId });
const RevisionRequest = Schema.Struct({ threadId: ThreadId, revision: Schema.Number });

export interface ThreadSpecAppend {
  readonly body: string;
  readonly author: ThreadSpecRevisionAuthor;
  readonly note: string;
  /** The revision the writer started from; 0 when the thread has no spec yet. */
  readonly baseRevision: number;
  /** When the revision was written, as an ISO instant. */
  readonly createdAt: string;
}

/** Numbered revisions of each thread's spec. The current spec is the highest revision. */
export class ThreadSpecRevisionRepository extends Context.Service<
  ThreadSpecRevisionRepository,
  {
    readonly current: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<ThreadSpecRevision>, ThreadSpecRevisionRepositoryError>;
    /** Metadata only, oldest first. */
    readonly list: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<ThreadSpecRevisionInfo>, ThreadSpecRevisionRepositoryError>;
    readonly get: (
      threadId: ThreadId,
      revision: number,
    ) => Effect.Effect<Option.Option<ThreadSpecRevision>, ThreadSpecRevisionRepositoryError>;
    /**
     * Stores the next revision and returns it, or the current one when `body` equals it (nothing is
     * added). Fails with a conflict when `baseRevision` is not the current revision.
     */
    readonly append: (
      threadId: ThreadId,
      input: ThreadSpecAppend,
    ) => Effect.Effect<
      ThreadSpecRevision,
      ThreadSpecRevisionRepositoryError | ThreadSpecConflictError
    >;
  }
>()("t3/persistence/ThreadSpecRevisions/ThreadSpecRevisionRepository") {}

function toSqlOrDecodeError(operation: string) {
  return (cause: unknown): ThreadSpecRevisionRepositoryError =>
    Schema.isSchemaError(cause)
      ? PersistenceDecodeError.fromSchemaError("ThreadSpecRevision", cause)
      : new PersistenceSqlError({ operation, cause });
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const findCurrent = SqlSchema.findOneOption({
    Request: ThreadIdRequest,
    Result: ThreadSpecRevision,
    execute: ({ threadId }) =>
      sql`
        SELECT revision, author, note, created_at AS "createdAt", body
        FROM thread_spec_revisions
        WHERE thread_id = ${threadId}
        ORDER BY revision DESC
        LIMIT 1
      `,
  });
  const findRevision = SqlSchema.findOneOption({
    Request: RevisionRequest,
    Result: ThreadSpecRevision,
    execute: ({ threadId, revision }) =>
      sql`
        SELECT revision, author, note, created_at AS "createdAt", body
        FROM thread_spec_revisions
        WHERE thread_id = ${threadId} AND revision = ${revision}
      `,
  });
  const listRevisions = SqlSchema.findAll({
    Request: ThreadIdRequest,
    Result: ThreadSpecRevisionInfo,
    execute: ({ threadId }) =>
      sql`
        SELECT revision, author, note, created_at AS "createdAt"
        FROM thread_spec_revisions
        WHERE thread_id = ${threadId}
        ORDER BY revision ASC
      `,
  });

  return ThreadSpecRevisionRepository.of({
    current: Effect.fn("ThreadSpecRevisionRepository.current")(function (threadId) {
      return findCurrent({ threadId }).pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError(toSqlOrDecodeError("currentThreadSpecRevision")),
      );
    }),
    list: Effect.fn("ThreadSpecRevisionRepository.list")(function (threadId) {
      return listRevisions({ threadId }).pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError(toSqlOrDecodeError("listThreadSpecRevisions")),
      );
    }),
    get: Effect.fn("ThreadSpecRevisionRepository.get")(function (threadId, revision) {
      return findRevision({ threadId, revision }).pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError(toSqlOrDecodeError("getThreadSpecRevision")),
      );
    }),
    append: Effect.fn("ThreadSpecRevisionRepository.append")(function (threadId, input) {
      const write = Effect.gen(function* () {
        const current = yield* findCurrent({ threadId });
        const currentRevision = Option.match(current, {
          onNone: () => 0,
          onSome: (row) => row.revision,
        });
        if (currentRevision !== input.baseRevision) {
          return yield* new ThreadSpecConflictError({ currentRevision });
        }
        if (Option.isSome(current) && current.value.body === input.body) return current.value;
        const revision = currentRevision + 1;
        yield* sql`
          INSERT INTO thread_spec_revisions (thread_id, revision, body, author, note, created_at)
          VALUES (${threadId}, ${revision}, ${input.body}, ${input.author}, ${input.note}, ${input.createdAt})
        `;
        return {
          revision,
          author: input.author,
          note: input.note,
          createdAt: input.createdAt,
          body: input.body,
        } satisfies ThreadSpecRevision;
      });
      return sql
        .withTransaction(write)
        .pipe(
          Effect.mapError((cause) =>
            Predicate.isTagged(cause, "ThreadSpecConflictError")
              ? cause
              : toSqlOrDecodeError("appendThreadSpecRevision")(cause),
          ),
        );
    }),
  });
});

export const layer = Layer.effect(ThreadSpecRevisionRepository, make);
