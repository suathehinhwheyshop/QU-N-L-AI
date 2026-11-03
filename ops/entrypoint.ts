import { spawn } from "node:child_process";
import {
  loadServerSecrets,
  validateServerConfig,
} from "@orbit/shared/server-env";
loadServerSecrets();
const mode = process.argv[2];
const roles: Record<string, string[]> = {
  web: [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "0.0.0.0",
    "--port",
    "3000",
  ],
  worker: ["--import", "tsx", "src/worker.ts"],
  migrate: ["--import", "tsx", "scripts/migrate.ts"],
  "rotate-tokens": ["--import", "tsx", "ops/rotate-tokens.ts"],
  "artifact-retention": [
    "--import",
    "tsx",
    "ops/artifact-retention.ts",
    ...process.argv.slice(3),
  ],
  monitor: ["--import", "tsx", "ops/monitor.ts"],
  grants: ["--import", "tsx", "ops/db-grants.ts"],
  provision: [
    "--import",
    "tsx",
    "scripts/provision-user.ts",
    ...process.argv.slice(3),
  ],
};
const args = roles[mode];
if (!args) throw Error("INVALID_PROCESS_ROLE");
if (["web", "worker"].includes(mode)) validateServerConfig();
const child = spawn(process.execPath, args, {
  stdio: "inherit",
  env: process.env,
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => child.kill(signal));
child.on("error", () => {
  console.error("PROCESS_START_FAILED");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
