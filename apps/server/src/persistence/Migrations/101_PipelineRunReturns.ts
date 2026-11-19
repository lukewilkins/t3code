import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // A phase can hand the work back to an earlier one, so runs count steps and returns.
  yield* sql`ALTER TABLE pipeline_runs ADD COLUMN step INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE pipeline_runs ADD COLUMN return_to INTEGER`;
  yield* sql`ALTER TABLE pipeline_runs ADD COLUMN return_count INTEGER NOT NULL DEFAULT 0`;
});
