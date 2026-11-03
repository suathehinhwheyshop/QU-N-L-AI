import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import {
  childEnvironment,
  createSubscriptionAdapter,
  cliRoot,
  prepareCliProfiles,
  spawnCli,
} from "@orbit/providers/subscription-cli";
import { stubCli } from "../cli-support";
import { assertPaidApiAllowed } from "@orbit/shared/execution-policy";
const input = {
  capability: "probe",
  data: {},
  attempt: 1,
  scenario: "normal",
  signal: new AbortController().signal,
};
test("CLI subprocess protocols produce validated structured output and explicit CLI_STUB evidence, never LIVE", async () => {
  const root = await mkdtemp("/tmp/orbit-cli-test-");
  process.env.ORBIT_CLI_DIR = root;
  try {
    for (const id of ["codex-cli", "gemini-cli"] as const) {
      const adapter = createSubscriptionAdapter(id, stubCli());
      assert.equal(adapter.descriptor.mode, "MOCK");
      const r = await adapter.invoke(input);
      assert.deepEqual(r.output, { ok: true });
      assert.equal(r.evidence?.kind, "CLI_STUB");
      assert.equal(r.usage.remaining_quota, null);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    delete process.env.ORBIT_CLI_DIR;
  }
});
test("CLI errors distinguish quota and auth, reject invalid output, and kill cancelled subprocesses", async () => {
  const root = await mkdtemp("/tmp/orbit-cli-errors-");
  process.env.ORBIT_CLI_DIR = root;
  try {
    for (const [mode, code] of [
      ["quota", "CLI_LIMIT_REACHED"],
      ["auth", "CLI_NOT_SIGNED_IN"],
      ["invalid", "CLI_OUTPUT_INVALID"],
    ])
      await assert.rejects(
        () =>
          createSubscriptionAdapter("gemini-cli", stubCli(mode)).invoke(input),
        new RegExp(code),
      );
    const c = new AbortController();
    setTimeout(() => c.abort(), 200);
    const began = Date.now();
    await assert.rejects(
      () =>
        createSubscriptionAdapter("gemini-cli", stubCli("hang")).invoke({
          ...input,
          signal: c.signal,
        }),
      /CANCELED/,
    );
    assert.ok(Date.now() - began < 3000);
  } finally {
    await rm(root, { recursive: true, force: true });
    delete process.env.ORBIT_CLI_DIR;
  }
});
test("CLI environment excludes API keys, DB credentials and inherited model config; profile enforces OAuth and no overage/tools", async () => {
  const root = await mkdtemp("/tmp/orbit-cli-env-");
  process.env.ORBIT_CLI_DIR = root;
  process.env.OPENAI_API_KEY = "fixture-never-forward";
  process.env.GEMINI_API_KEY = "fixture-never-forward";
  process.env.ORBIT_OPENAI_API_KEY = "fixture-never-forward";
  try {
    for (const id of ["codex-cli", "gemini-cli"] as const) {
      const env = childEnvironment(id);
      assert.equal(env.OPENAI_API_KEY, undefined);
      assert.equal(env.GEMINI_API_KEY, undefined);
      assert.equal(env.ORBIT_OPENAI_API_KEY, undefined);
      assert.equal(env.DATABASE_URL, undefined);
      assert.equal(env.HOME, undefined);
    }
    await prepareCliProfiles("gemini-cli");
    const cfg = JSON.parse(
      await readFile(root + "/gemini-system.json", "utf8"),
    );
    assert.equal(cfg.security.auth.enforcedType, "oauth-personal");
    assert.equal(cfg.billing.overageStrategy, "never");
    assert.deepEqual(cfg.tools.core, []);
    assert.match(
      await readFile(root + "/gemini-deny.toml", "utf8"),
      /decision = "deny"/,
    );
    process.env.ORBIT_AI_POLICY = "subscription-only";
    assert.throws(() => assertPaidApiAllowed(), /PAID_API_DISABLED/);
  } finally {
    for (const k of [
      "ORBIT_CLI_DIR",
      "OPENAI_API_KEY",
      "GEMINI_API_KEY",
      "ORBIT_OPENAI_API_KEY",
      "ORBIT_AI_POLICY",
    ])
      delete process.env[k];
    await rm(root, { recursive: true, force: true });
  }
});
test("CLI installation alone never reports a connected provider; Windows bridge uses fixed actions and argument arrays", async () => {
  const a = createSubscriptionAdapter("codex-cli", stubCli());
  assert.equal((await a.health()).status, "DISCONNECTED");
  const ps = await readFile("ops/windows/Orbit.ps1", "utf8");
  assert.match(ps, /ValidateSet/);
  assert.match(ps, /& wsl.exe @Arguments/);
  assert.doesNotMatch(ps, /^\s*(?:Invoke-Expression|iex)\s+/im);
  const bridge = await readFile("ops/windows/bridge.sh", "utf8");
  assert.match(bridge, /microsoft-standard/);
  assert.match(bridge, /exec node ops\/local.mjs/);
});
