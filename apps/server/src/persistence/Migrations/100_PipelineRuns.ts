import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One pipeline run per thread; attaching another replaces it.
  yield* sql`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      thread_id TEXT PRIMARY KEY,
      run_key TEXT NOT NULL,
      pipeline_id TEXT NOT NULL,
      pipeline_name TEXT NOT NULL,
      phases_json TEXT NOT NULL,
      phase_index INTEGER NOT NULL,
      step INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      handoff TEXT,
      return_to INTEGER,
      return_count INTEGER NOT NULL DEFAULT 0,
      base_model_selection_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) WITHOUT ROWID
  `;
});
