import { localMode } from "@orbit/shared/execution-policy";
import { pauseLocalStartup } from "./server/local-mode";
import "./server/runtime";
import { tick } from "./core/engine";
import { pool } from "./db/client";
import { validateServerConfig } from "@orbit/shared/server-env";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
validateServerConfig();
const id = randomUUID();
let stopped = false,
  heartbeat: Promise<void> | undefined;
await writeFile(
  process.env.ORBIT_WORKER_ID_FILE ?? "/tmp/orbit-worker-id",
  id,
  { mode: 0o600 },
);
const beat = async (status: string) => {
  await pool.query(
    "INSERT INTO worker_heartbeats(id,status,updated_at) VALUES($1,$2,now()) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=now()",
    [id, status],
  );
};
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
const localLease = localMode() ? await pool.connect() : null;
if (
  localLease &&
  !(await localLease.query("SELECT pg_try_advisory_lock(7493122) AS locked"))
    .rows[0].locked
) {
  localLease.release();
  throw Error("LOCAL_WORKER_ALREADY_RUNNING");
}
await pauseLocalStartup();
await beat("RUNNING");
console.log(JSON.stringify({ event: "WORKER_STARTED", worker_id: id }));
const timer = setInterval(() => {
  if (!heartbeat)
    heartbeat = beat(stopped ? "DRAINING" : "BUSY")
      .catch(() => undefined)
      .finally(() => {
        heartbeat = undefined;
      });
}, 10000).unref();
while (!stopped) {
  try {
    await tick(2);
    await beat("RUNNING");
  } catch {
    console.error(
      JSON.stringify({
        event: "WORKER_TICK_FAILED",
        worker_id: id,
        code: "DATABASE_OR_EXECUTION_ERROR",
      }),
    );
  }
  if (!stopped) await new Promise((r) => setTimeout(r, 500));
}
clearInterval(timer);
await heartbeat;
await beat("STOPPED");
if (localLease) {
  await localLease.query("SELECT pg_advisory_unlock(7493122)");
  localLease.release();
}
await pool.end();
console.log(JSON.stringify({ event: "WORKER_STOPPED", worker_id: id }));
