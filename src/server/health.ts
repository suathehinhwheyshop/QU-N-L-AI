import { localMode } from "@orbit/shared/execution-policy";
import { pool } from "@/db/client";
import { validateServerConfig } from "@orbit/shared/server-env";
import { readFile } from "node:fs/promises";
export async function readiness() {
  try {
    const cfg = validateServerConfig();
    const journal = JSON.parse(
      await readFile("migrations/meta/_journal.json", "utf8"),
    );
    const migrated = (
      await pool.query(
        "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
      )
    ).rows[0].n;
    if (migrated !== journal.entries.length) return false;
    if (cfg.stage || localMode()) {
      const rows = (
        await pool.query(
          "SELECT EXISTS(SELECT 1 FROM users WHERE role='ADMIN' AND is_active AND password_hash IS NOT NULL) AS provisioned,EXISTS(SELECT 1 FROM worker_heartbeats WHERE updated_at>now()-interval '180 seconds' AND status IN ('RUNNING','BUSY')) AS worker",
        )
      ).rows[0];
      if (!rows.provisioned || !rows.worker) return false;
    }
    return true;
  } catch {
    return false;
  }
}
