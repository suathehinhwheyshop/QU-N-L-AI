import { pool } from "@/db/client";
import { localMode } from "@orbit/shared/execution-policy";
import { OrbitError } from "@orbit/shared/contracts";
export async function assertLocalOwner(id: string) {
  if (!localMode()) return;
  if (!process.env.ORBIT_OWNER_ID || id !== process.env.ORBIT_OWNER_ID)
    throw new OrbitError("FORBIDDEN");
}
export async function pauseLocalStartup() {
  if (!localMode()) return;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(7493121)");
    const runs = (
      await c.query(
        "UPDATE runs SET status='PAUSED',updated_at=now() WHERE status IN ('RUNNING','QUEUED') RETURNING id",
      )
    ).rows;
    for (const r of runs)
      await c.query(
        "INSERT INTO events(run_id,type,message) VALUES($1,'LOCAL_STARTUP_PAUSED','Máy/worker vừa khởi động. Cần người dùng Resume; không tự chạy lại.')",
        [r.id],
      );
    await c.query("COMMIT");
    return runs.length;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
