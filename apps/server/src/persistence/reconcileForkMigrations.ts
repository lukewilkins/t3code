import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

type MigrationRow = { readonly id: number; readonly name: string };

// This fork's migrations sit above upstream's and move up whenever a merge brings new upstream ids.
// They must stay idempotent: a ledger row left at an old id is dropped and the migration reruns.
const FORK_MIGRATION_NAMES = new Set([
  "ThreadSpecRevisions",
  "PipelineRuns",
  // Retired: folded into PipelineRuns before it shipped.
  "PipelineRunReturns",
]);

function staleForkMigrationIds(
  history: ReadonlyArray<MigrationRow>,
  manifest: ReadonlyArray<readonly [number, string]>,
): number[] {
  const manifestNames = new Map(manifest);
  return history
    .filter((row) => FORK_MIGRATION_NAMES.has(row.name) && manifestNames.get(row.id) !== row.name)
    .map((row) => row.id);
}

export const reconcileForkMigrations = Effect.fn("reconcileForkMigrations")(function* (
  manifest: ReadonlyArray<readonly [number, string]>,
) {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (tables.length === 0) return;
  const history = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations
  `;
  const stale = staleForkMigrationIds(
    history.map((row) => ({ id: row.migration_id, name: row.name })),
    manifest,
  );
  if (stale.length === 0) return;
  yield* Effect.log("Moving fork migrations above upstream's").pipe(
    Effect.annotateLogs({ staleIds: stale }),
  );
  yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id IN ${sql.in(stale)}`;
});
