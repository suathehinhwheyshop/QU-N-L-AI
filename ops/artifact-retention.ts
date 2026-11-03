import { pool } from "@orbit/database/client";
import { collectOrphans } from "@orbit/storage/retention";
try {
  const referenced = new Set<string>();
  for (const row of (
    await pool.query(
      "SELECT blob_key AS storage_key FROM artifacts UNION SELECT blob_key AS storage_key FROM seo_datasets UNION SELECT raw_blob_key AS storage_key FROM seo_datasets WHERE raw_blob_key IS NOT NULL",
    )
  ).rows)
    referenced.add(row.storage_key);
  for (const row of (await pool.query("SELECT checkpoint FROM gsc_jobs")).rows)
    for (const page of row.checkpoint?.pages ?? [])
      if (page.key) referenced.add(page.key);
  if (process.argv.includes("--apply")) {
    if (process.env.ORBIT_MAINTENANCE_CONFIRM !== "true")
      throw Error("MAINTENANCE_REQUIRED");
    const active = (
      await pool.query(
        "SELECT count(*)::int n FROM worker_heartbeats WHERE status IN ('RUNNING','BUSY') AND updated_at>now()-interval '180 seconds'",
      )
    ).rows[0].n;
    if (active) throw Error("WORKER_MUST_BE_STOPPED");
  }
  console.log(
    JSON.stringify(
      await collectOrphans(
        process.env.ORBIT_STORAGE_DIR!,
        referenced,
        process.argv.includes("--apply"),
      ),
    ),
  );
} catch {
  console.error("ARTIFACT_RETENTION_FAILED");
  process.exitCode = 1;
} finally {
  await pool.end();
}
