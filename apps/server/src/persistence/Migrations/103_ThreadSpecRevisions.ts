import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // A thread's spec is its highest revision; older rows are history. Rows are never rewritten.
  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_spec_revisions (
      thread_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      body TEXT NOT NULL,
      author TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, revision)
    ) WITHOUT ROWID
  `;
});
