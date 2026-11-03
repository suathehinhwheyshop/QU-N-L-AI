import { pool } from "@orbit/database/client";
import { readFile } from "node:fs/promises";
try {
  const id = await readFile(
    process.env.ORBIT_WORKER_ID_FILE ?? "/tmp/orbit-worker-id",
    "utf8",
  );
  const row = (
    await pool.query(
      "SELECT id FROM worker_heartbeats WHERE id=$1 AND updated_at>now()-interval '180 seconds' AND status IN ('RUNNING','BUSY')",
      [id],
    )
  ).rows[0];
  if (!row) process.exitCode = 1;
} catch {
  process.exitCode = 1;
} finally {
  await pool.end();
}
