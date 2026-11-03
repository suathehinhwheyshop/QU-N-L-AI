import { pool } from "@orbit/database/client";
import { OrbitError } from "@orbit/shared/contracts";
export async function withCliLease<T>(
  id: string,
  signal: AbortSignal,
  fn: () => Promise<T>,
) {
  const c = await pool.connect();
  let held = false;
  try {
    const deadline = Date.now() + 90000;
    while (!held) {
      if (signal.aborted || Date.now() > deadline)
        throw new OrbitError("TIMEOUT");
      held = (
        await c.query("SELECT pg_try_advisory_lock(hashtext($1)) AS held", [
          "orbit-cli:" + id,
        ])
      ).rows[0].held;
      if (!held) await new Promise((r) => setTimeout(r, 100));
    }
    return await fn();
  } finally {
    if (held)
      await c.query("SELECT pg_advisory_unlock(hashtext($1))", [
        "orbit-cli:" + id,
      ]);
    c.release();
  }
}
