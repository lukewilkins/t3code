import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";
import ThreadSpecRevisions from "./Migrations/103_ThreadSpecRevisions.ts";
import PipelineRuns from "./Migrations/104_PipelineRuns.ts";

it.effect("moves fork migrations recorded at upstream's ids above them, keeping their data", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 98 });
    yield* Migrator.make({})({
      loader: Migrator.fromRecord({
        "99_ThreadSpecRevisions": ThreadSpecRevisions,
        "100_PipelineRuns": PipelineRuns,
        "101_PipelineRunReturns": Effect.void,
      }),
    });
    yield* sql`
      INSERT INTO thread_spec_revisions (thread_id, revision, body, author, note, created_at)
      VALUES ('thread-1', 1, '# Goal', 'agent', 'first', '2026-11-01')
    `;

    const executed = yield* runMigrations();

    assert.deepStrictEqual(
      executed.map(([id]) => id),
      migrationManifest.filter(([id]) => id > 98).map(([id]) => id),
    );
    const ledger = yield* sql<{ readonly migration_id: number; readonly name: string }>`
      SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
    `;
    assert.deepStrictEqual(
      ledger.map((row) => [row.migration_id, row.name]),
      migrationManifest.map(([id, name]) => [id, name]),
    );
    const specs = yield* sql`SELECT thread_id, body FROM thread_spec_revisions`;
    assert.deepStrictEqual(specs, [{ thread_id: "thread-1", body: "# Goal" }]);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
