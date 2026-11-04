import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { release } from "node:os";
import { join, resolve } from "node:path";
import {
  codexInstance,
  localDirectory,
  validateCodexConfig,
} from "./local-instance.mjs";

const execute = promisify(execFile);
const command = async (program, args) =>
  (
    await execute(program, args, { timeout: 10000, maxBuffer: 65536 })
  ).stdout.trim();
async function portAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

// Read metadata only. Never load secrets, run migrations, install tools, or stop services.
export async function localDoctor({
  root = process.cwd(),
  directory = localDirectory(root, process.env.ORBIT_LOCAL_DIR),
  run = command,
  available = portAvailable,
  platform = process.platform,
  kernel = release(),
} = {}) {
  root = resolve(root);
  const checks = [];
  const check = (id, status, code) => checks.push({ id, status, code });
  check(
    "node",
    Number(process.versions.node.split(".")[0]) >= 24 ? "PASS" : "BLOCKED",
    "NODE_24_REQUIRED",
  );
  const wsl = platform === "linux" && /microsoft-standard/i.test(kernel);
  check(
    "runtime",
    platform === "linux" ? "PASS" : "BLOCKED",
    wsl ? "WSL2_KERNEL_DETECTED" : "LINUX_EQUIVALENT_ONLY",
  );
  if (wsl)
    check(
      "checkout",
      root.startsWith("/home/") ? "PASS" : "BLOCKED",
      "DEDICATED_LINUX_CHECKOUT_REQUIRED",
    );

  let config;
  try {
    config = validateCodexConfig(
      JSON.parse(await readFile(join(directory, "config.json"), "utf8")),
    );
    check("profile", "PASS", "ISOLATED_CODEX_3211_PROFILE");
  } catch (e) {
    check(
      "profile",
      e.code === "ENOENT" ? "INFO" : "BLOCKED",
      e.code === "ENOENT"
        ? "NOT_INSTALLED_RUN_INSTALL"
        : "INVALID_PROFILE_PRESERVED",
    );
  }
  if (config) {
    for (const name of [
      "db_password",
      "api_db_password",
      "worker_db_password",
      "session_secret",
      "token_key",
      "backup_key",
    ]) {
      try {
        const meta = await stat(join(directory, "secrets", name));
        check(
          "secret:" + name,
          meta.isFile() && meta.size > 0 && (meta.mode & 0o077) === 0
            ? "PASS"
            : "BLOCKED",
          "PRIVATE_NONEMPTY_FILE_REQUIRED",
        );
      } catch {
        check("secret:" + name, "BLOCKED", "PRIVATE_FILE_MISSING");
      }
    }
  }
  let docker = false;
  try {
    docker =
      (await run("docker", ["info", "--format", "{{.OSType}}"])) === "linux";
    check(
      "docker",
      docker ? "PASS" : "BLOCKED",
      "DOCKER_LINUX_ENGINE_REQUIRED",
    );
  } catch {
    check("docker", "BLOCKED", "DOCKER_UNAVAILABLE_ENABLE_WSL_INTEGRATION");
  }
  try {
    const version = await run("docker", ["compose", "version", "--short"]);
    check(
      "compose",
      /^v?[2-9]\./.test(version) ? "PASS" : "BLOCKED",
      "DOCKER_COMPOSE_V2_REQUIRED",
    );
  } catch {
    check("compose", "BLOCKED", "DOCKER_COMPOSE_V2_REQUIRED");
  }
  for (const [id, port] of [
    ["web_port", codexInstance.port],
    ["database_port", codexInstance.dbPort],
  ]) {
    if (await available(port)) {
      check(id, "PASS", "LOOPBACK_PORT_AVAILABLE");
      continue;
    }
    let owned = false;
    if (config && id === "web_port") {
      try {
        const processInfo = JSON.parse(
          await readFile(join(directory, "process.json"), "utf8"),
        );
        if (Number.isSafeInteger(processInfo.pid) && processInfo.pid > 0) {
          const args = await readFile(
            `/proc/${processInfo.pid}/cmdline`,
            "utf8",
          );
          const start = (
            await readFile(`/proc/${processInfo.pid}/stat`, "utf8")
          ).split(" ")[21];
          owned =
            args.split("\0").includes(join(root, "ops/local.mjs")) &&
            args.split("\0").includes("serve") &&
            start === processInfo.start;
        }
      } catch {}
    } else if (config && docker && id === "database_port") {
      try {
        const ports = await run("docker", [
          "ps",
          "--filter",
          "label=com.docker.compose.project=" + config.project,
          "--filter",
          "label=com.docker.compose.service=db",
          "--format",
          "{{.Ports}}",
        ]);
        owned = ports.split(/\s*,\s*|\n/).includes("127.0.0.1:55435->5432/tcp");
      } catch {}
    }
    check(
      id,
      owned ? "PASS" : "BLOCKED",
      owned ? "OWN_CODEX_SERVICE_RUNNING" : "PORT_IN_USE_NO_PROCESS_STOPPED",
    );
  }
  check(
    "subscription_execution",
    "INFO",
    "BLOCKED_ENTITLEMENT_OR_INCLUDED_ALLOWANCE_UNVERIFIED",
  );
  return {
    at: new Date().toISOString(),
    status: checks.some((c) => c.status === "BLOCKED")
      ? "BLOCKED"
      : "LOCAL_PREREQUISITES_PASS",
    runtime: wsl
      ? "WSL2_DETECTED_WINDOWS_ACCEPTANCE_PENDING"
      : "LINUX_EQUIVALENT_NOT_WINDOWS",
    windows10_verified: false,
    ai_live_verified: false,
    origin: "http://127.0.0.1:3211",
    mutations: 0,
    checks,
  };
}
