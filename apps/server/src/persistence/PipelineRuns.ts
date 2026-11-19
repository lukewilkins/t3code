import * as Context from "effect/Context";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import { ModelSelection, PipelinePhase, PipelineRun, ThreadId } from "@t3tools/contracts";

import {
  PersistenceDecodeError,
  PersistenceSqlError,
  type PipelineRunRepositoryError,
} from "./Errors.ts";

/** A `PipelineRun` as stored: the phases and base model are JSON columns. */
const PipelineRunRow = Schema.Struct({
  ...PipelineRun.fields,
  phases: Schema.fromJsonString(Schema.Array(PipelinePhase)),
  baseModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
});

const ThreadIdRequest = Schema.Struct({ threadId: ThreadId });

/** Each thread's pipeline run, current or finished. Attaching a pipeline replaces the row. */
export class PipelineRunRepository extends Context.Service<
  PipelineRunRepository,
  {
    readonly get: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<PipelineRun>, PipelineRunRepositoryError>;
    readonly put: (run: PipelineRun) => Effect.Effect<void, PipelineRunRepositoryError>;
    /** Threads whose phase handed off but has not moved on yet. */
    readonly listReadyThreadIds: () => Effect.Effect<
      ReadonlyArray<ThreadId>,
      PipelineRunRepositoryError
    >;
  }
>()("t3/persistence/PipelineRuns/PipelineRunRepository") {}

function toSqlOrDecodeError(operation: string) {
  return (cause: unknown): PipelineRunRepositoryError =>
    Schema.isSchemaError(cause)
      ? PersistenceDecodeError.fromSchemaError("PipelineRun", cause)
      : new PersistenceSqlError({ operation, cause });
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const findRun = SqlSchema.findOneOption({
    Request: ThreadIdRequest,
    Result: PipelineRunRow,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          run_key AS "runKey",
          pipeline_id AS "pipelineId",
          pipeline_name AS "pipelineName",
          phases_json AS "phases",
          phase_index AS "phaseIndex",
          step,
          status,
          handoff,
          return_to AS "returnTo",
          return_count AS "returnCount",
          base_model_selection_json AS "baseModelSelection",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM pipeline_runs
        WHERE thread_id = ${threadId}
      `,
  });

  const upsertRun = SqlSchema.void({
    Request: PipelineRunRow,
    execute: (row) =>
      sql`
        INSERT INTO pipeline_runs (
          thread_id, run_key, pipeline_id, pipeline_name, phases_json, phase_index, step, status,
          handoff, return_to, return_count, base_model_selection_json, created_at, updated_at
        )
        VALUES (
          ${row.threadId}, ${row.runKey}, ${row.pipelineId}, ${row.pipelineName}, ${row.phases},
          ${row.phaseIndex}, ${row.step}, ${row.status}, ${row.handoff}, ${row.returnTo},
          ${row.returnCount}, ${row.baseModelSelection}, ${row.createdAt}, ${row.updatedAt}
        )
        ON CONFLICT (thread_id) DO UPDATE SET
          run_key = excluded.run_key,
          pipeline_id = excluded.pipeline_id,
          pipeline_name = excluded.pipeline_name,
          phases_json = excluded.phases_json,
          phase_index = excluded.phase_index,
          step = excluded.step,
          status = excluded.status,
          handoff = excluded.handoff,
          return_to = excluded.return_to,
          return_count = excluded.return_count,
          base_model_selection_json = excluded.base_model_selection_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
  });

  const findReady = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ThreadIdRequest,
    execute: () => sql`SELECT thread_id AS "threadId" FROM pipeline_runs WHERE status = 'ready'`,
  });

  return PipelineRunRepository.of({
    get: Effect.fn("PipelineRunRepository.get")(function (threadId) {
      return findRun({ threadId }).pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError(toSqlOrDecodeError("getPipelineRun")),
      );
    }),
    put: Effect.fn("PipelineRunRepository.put")(function (run) {
      return upsertRun(run).pipe(Effect.mapError(toSqlOrDecodeError("putPipelineRun")));
    }),
    listReadyThreadIds: Effect.fn("PipelineRunRepository.listReadyThreadIds")(function () {
      return findReady(undefined).pipe(
        Effect.map((rows) => rows.map((row) => row.threadId)),
        NodeSqliteClient.readOnly,
        Effect.mapError(toSqlOrDecodeError("listReadyPipelineRuns")),
      );
    }),
  });
});

export const layer = Layer.effect(PipelineRunRepository, make);
