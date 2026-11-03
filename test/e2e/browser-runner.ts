import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { testDatabase } from "../support";
const database = await testDatabase();
const { pool } = await import("@orbit/database/client");
await (await import("../../scripts/seed")).seed();
const origin = "http://127.0.0.1:3202",
  cdp = "http://127.0.0.1:9231",
  profile = "/tmp/orbit-phase3-browser-" + randomUUID();
const environment = {
  ...process.env,
  ORBIT_BASE_URL: origin,
  ORBIT_ADMIN_PASSWORD: randomBytes(24).toString("hex"),
  ORBIT_SESSION_SECRET: randomBytes(32).toString("hex"),
  ORBIT_COOKIE_SECURE: "false",
  ORBIT_GSC_CLIENT_ID: "",
  ORBIT_GSC_CLIENT_SECRET: "",
  ORBIT_OPENAI_API_KEY: "",
  ORBIT_ANTHROPIC_API_KEY: "",
  ORBIT_GOOGLE_API_KEY: "",
  ORBIT_XAI_API_KEY: "",
  ORBIT_BROWSER_ORIGIN: origin,
  ORBIT_BROWSER_CDP: cdp,
};
let logs = "";
const children: ChildProcess[] = [];
function start(command: string, args: string[]) {
  const child = spawn(command, args, {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (b) => (logs += b));
  child.stderr?.on("data", (b) => (logs += b));
  children.push(child);
  return child;
}
async function ready(url: string) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error("BROWSER_READINESS_TIMEOUT");
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((r) =>
      setTimeout(() => {
        child.kill("SIGKILL");
        r(null);
      }, 3000).unref(),
    ),
  ]);
}
try {
  start(process.execPath, [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3202",
  ]);
  start(process.execPath, ["--import", "tsx", "src/worker.ts"]);
  start(process.env.ORBIT_CHROMIUM_PATH ?? "/usr/bin/chromium", [
    "--headless",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-background-networking",
    "--no-first-run",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=9231",
    "--user-data-dir=" + profile,
    "about:blank",
  ]);
  await Promise.all([ready(origin + "/login"), ready(cdp + "/json/list")]);
  const browser = start(process.execPath, [
    "--import",
    "tsx",
    "test/e2e/browser.ts",
  ]);
  const code = await new Promise<number | null>((r, j) => {
    browser.once("error", j);
    browser.once("exit", r);
  });
  if (code !== 0) throw Error("BROWSER_REGRESSION_FAILED");
  console.log(
    "Browser regression PASS (isolated database, API + worker + Chromium).",
  );
} catch (e) {
  await mkdir(".orbit", { recursive: true });
  await writeFile(".orbit/phase3-browser-debug.log", logs);
  throw e;
} finally {
  for (const child of children.reverse()) await stop(child);
  await pool.end();
  await database.cleanup();
  await rm(profile, { recursive: true, force: true });
}
