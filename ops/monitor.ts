import { pool } from "@orbit/database/client";
try {
  const workers = (
    await pool.query(
      "SELECT count(*)::int n FROM worker_heartbeats WHERE status IN ('RUNNING','BUSY') AND updated_at>now()-interval '180 seconds'",
    )
  ).rows[0].n;
  const failures = (
    await pool.query(
      "SELECT count(*)::int n FROM runs WHERE status='FAILED' AND updated_at>now()-interval '15 minutes'",
    )
  ).rows[0].n;
  const overdue = (
    await pool.query(
      "SELECT count(*)::int n FROM tasks WHERE status='RUNNING' AND lease_until<now()-interval '30 seconds'",
    )
  ).rows[0].n;
  const alerts = [
    ...(!workers ? ["WORKER_STALE"] : []),
    ...(failures ? ["RECENT_RUN_FAILURE"] : []),
    ...(overdue ? ["TASK_LEASE_OVERDUE"] : []),
  ];
  console.log(
    JSON.stringify({
      event: "operations_check",
      at: new Date().toISOString(),
      workers,
      failures,
      overdue,
      alerts,
    }),
  );
  if (alerts.length) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ event: "operations_check_failed" }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
