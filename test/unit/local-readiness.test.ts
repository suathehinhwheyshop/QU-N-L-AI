import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  writeFile,
  readFile,
  readdir,
  mkdir,
  rm,
  chmod,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import {
  inspectCodexAccount,
  type AccountTransport,
} from "@orbit/providers/codex-account";
import { localDoctor } from "../../ops/local-doctor.mjs";

async function fixture(mode: string) {
  const dir = await mkdtemp("/tmp/orbit-account-test-");
  const transcript = join(dir, "requests.jsonl");
  await writeFile(transcript, "");
  let pid: number | undefined;
  const transport: AccountTransport = {
    kind: "CLI_STUB",
    start(args, cwd) {
      assert.equal(args[0], "app-server");
      assert.ok(args.includes("stdio://"));
      assert.ok(!args.includes("exec"));
      const child = spawn(
        process.execPath,
        [resolve("test/fixtures/codex-account-stub.mjs"), mode, transcript],
        { cwd, stdio: ["pipe", "pipe", "pipe"], detached: true },
      );
      pid = child.pid;
      return child;
    },
  };
  return { transport, transcript, dir, pid: () => pid };
}
test("Codex read-only RPC handshake returns provider-reported windows, strips identity/credits, and never enables LIVE", async () => {
  const f = await fixture("normal");
  try {
    const result = await inspectCodexAccount({ transport: f.transport });
    assert.equal(result.auth, "CHATGPT_SIGNED_IN");
    assert.equal(result.evidence_kind, "CLI_STUB");
    assert.equal(result.live_execution_verified, false);
    assert.equal(result.execution_status, "BLOCKED");
    assert.equal(result.included_only_enforcement, "UNVERIFIED");
    assert.equal(result.usage?.ordinary_usage_allowed, true);
    assert.equal(result.usage?.windows[0].primary?.usedPercent, 27);
    assert.doesNotMatch(
      JSON.stringify(result),
      /fixture-private|email|accountId|balance|credits|remaining/i,
    );
    const requests = (await readFile(f.transcript, "utf8"))
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    assert.deepEqual(
      requests.map((m) => m.method),
      ["initialize", "initialized", "account/read", "account/rateLimits/read"],
    );
    assert.deepEqual(requests[3].params, {
      supportsLunaReserve: false,
      excludeResetCreditDetails: true,
    });
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
test("Codex signed-out and API-key accounts never trigger quota read, login, refresh, or inference", async () => {
  for (const mode of ["signed-out", "api-key"]) {
    const f = await fixture(mode);
    try {
      const result = await inspectCodexAccount({ transport: f.transport });
      assert.equal(
        result.auth,
        mode === "signed-out" ? "NOT_SIGNED_IN" : "UNSUPPORTED_AUTH",
      );
      assert.equal(result.usage, null);
      const requests = await readFile(f.transcript, "utf8");
      assert.doesNotMatch(
        requests,
        /rateLimits|login|turn\/|thread\/|consume|sendAddCredits/,
      );
      assert.match(requests, /"refreshToken":false/);
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  }
});
test("Codex diagnostic rejects malformed/oversized/error/server-request payloads without returning raw secrets", async () => {
  for (const mode of [
    "bad-json",
    "oversize",
    "server-request",
    "invalid-window",
    "rpc-error",
    "early-exit",
  ]) {
    const f = await fixture(mode);
    try {
      await assert.rejects(
        () => inspectCodexAccount({ transport: f.transport }),
        (e: Error) =>
          /^CLI_ACCOUNT_(OUTPUT_INVALID|UNAVAILABLE)$/.test(e.message),
      );
      assert.doesNotMatch(
        await readFile(f.transcript, "utf8"),
        /chatgptAuthTokens|consume|turn\/|thread\//,
      );
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  }
});
test("Codex diagnostic cancellation kills the subprocess and an exhausted quota never enables execution", async () => {
  const f = await fixture("hang");
  try {
    const began = Date.now();
    await assert.rejects(
      () =>
        inspectCodexAccount({
          transport: f.transport,
          signal: AbortSignal.timeout(150),
        }),
      /CANCELED/,
    );
    assert.ok(Date.now() - began < 2000);
    assert.throws(() => process.kill(f.pid()!, 0));
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
  const g = await fixture("exhausted");
  try {
    const result = await inspectCodexAccount({ transport: g.transport });
    assert.equal(result.usage?.ordinary_usage_allowed, false);
    assert.equal(result.execution_status, "BLOCKED");
  } finally {
    await rm(g.dir, { recursive: true, force: true });
  }
});
const docker = async (_program: string, args: string[]) =>
  args[0] === "info" ? "linux" : args[0] === "compose" ? "2.39.0" : "";
test("local doctor works before install, reports missing Docker, and never creates files", async () => {
  const dir = await mkdtemp("/tmp/orbit-doctor-");
  try {
    const report = await localDoctor({
      root: dir,
      directory: dir,
      run: async () => {
        throw Error("private docker error");
      },
      available: async () => true,
    });
    assert.equal(report.status, "BLOCKED");
    assert.equal(report.mutations, 0);
    assert.equal(report.windows10_verified, false);
    assert.equal(report.ai_live_verified, false);
    assert.ok(
      report.checks.some((c) => c.code === "NOT_INSTALLED_RUN_INSTALL"),
    );
    assert.deepEqual(await readdir(dir), []);
    assert.doesNotMatch(JSON.stringify(report), /private docker error/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("local doctor rejects a legacy profile without changing it and reports port conflicts without stopping services", async () => {
  const dir = await mkdtemp("/tmp/orbit-doctor-");
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const original = '{"port":3210,"project":"orbit-personal-old"}';
    await writeFile(join(dir, "config.json"), original);
    const report = await localDoctor({
      root: dir,
      directory: dir,
      run: docker,
      available: async () => false,
    });
    assert.equal(report.status, "BLOCKED");
    assert.ok(
      report.checks.some((c) => c.code === "INVALID_PROFILE_PRESERVED"),
    );
    assert.equal(
      report.checks.filter((c) => c.code === "PORT_IN_USE_NO_PROCESS_STOPPED")
        .length,
      2,
    );
    assert.equal(await readFile(join(dir, "config.json"), "utf8"), original);
    assert.equal(server.listening, true);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
test("local doctor validates private secret metadata and only accepts the configured Docker project's loopback mapping", async () => {
  const dir = await mkdtemp("/tmp/orbit-doctor-");
  try {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({
        instance: "codex",
        project: "orbit-codex-12345678",
        database: "orbit_codex",
        port: 3211,
        dbPort: 55435,
      }),
    );
    await mkdir(join(dir, "secrets"));
    for (const key of [
      "db_password",
      "api_db_password",
      "worker_db_password",
      "session_secret",
      "token_key",
      "backup_key",
    ])
      await writeFile(
        join(dir, "secrets", key),
        "fixture-secret-never-output",
        { mode: 0o600 },
      );
    const report = await localDoctor({
      root: dir,
      directory: dir,
      run: async (program, args) => {
        if (args[0] === "ps") {
          assert.ok(
            args.includes(
              "label=com.docker.compose.project=orbit-codex-12345678",
            ),
          );
          return "127.0.0.1:55435->5432/tcp";
        }
        return docker(program, args);
      },
      available: async (port) => port === 3211,
    });
    assert.equal(report.status, "LOCAL_PREREQUISITES_PASS");
    assert.doesNotMatch(JSON.stringify(report), /fixture-secret/);
    await chmod(join(dir, "secrets", "backup_key"), 0o644);
    const invalid = await localDoctor({
      root: dir,
      directory: dir,
      run: docker,
      available: async () => true,
    });
    assert.equal(invalid.status, "BLOCKED");
    assert.ok(
      invalid.checks.some(
        (c) => c.id === "secret:backup_key" && c.status === "BLOCKED",
      ),
    );
    assert.equal(
      await readFile(join(dir, "secrets", "backup_key"), "utf8"),
      "fixture-secret-never-output",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
