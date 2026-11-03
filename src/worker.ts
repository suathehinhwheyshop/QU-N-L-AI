import "./server/runtime";
import { tick } from "./core/engine";
import { pool } from "./db/client";
let stopped = false;
process.on("SIGTERM", () => (stopped = true));
process.on("SIGINT", () => (stopped = true));
console.log(
  "ORBIT worker started; durable queue, provider execution gated by verified configuration.",
);
while (!stopped) {
  try {
    await tick(2);
  } catch {
    console.error(
      "Worker tick failed; details withheld. Check database availability.",
    );
  }
  if (!stopped) await new Promise((r) => setTimeout(r, 500));
}
await pool.end();
console.log("Worker stopped after checkpoint.");
