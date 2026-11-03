import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  preferredSubscriptionProviders,
  subscriptionCliEnabled,
} from "@orbit/shared/subscription-policy";
import {
  enabledCliDefinitions,
  activeSubscriptionProviders,
  createSubscriptionAdapter,
  prepareCliProfiles,
  type CliRunner,
} from "@orbit/providers/subscription-cli";
import {
  codexInstance,
  localDirectory,
  validateCodexConfig,
} from "../../ops/local-instance.mjs";
import {
  sessionCookieName,
  gscCookieName,
} from "../../src/server/cookie-names";
test("three product priorities, Codex-only default execution/install and no Gemini profile side effects", async () => {
  const prior = process.env.ORBIT_ENABLE_OPTIONAL_GEMINI;
  delete process.env.ORBIT_ENABLE_OPTIONAL_GEMINI;
  const dir = await mkdtemp("/tmp/orbit-policy-");
  process.env.ORBIT_CLI_DIR = dir;
  try {
    assert.deepEqual(preferredSubscriptionProviders, [
      "claude-code",
      "codex-cli",
      "grokbot",
    ]);
    assert.deepEqual(
      enabledCliDefinitions().map((d) => d.id),
      ["codex-cli"],
    );
    assert.deepEqual(
      activeSubscriptionProviders().map((d) => d.descriptor.id),
      ["codex-cli"],
    );
    assert.equal(subscriptionCliEnabled("gemini-cli"), false);
    let invoked = false;
    const runner: CliRunner = {
      kind: "LIVE_CLI",
      async run() {
        invoked = true;
        throw Error("MUST_NOT_RUN");
      },
    };
    await assert.rejects(
      () =>
        createSubscriptionAdapter("gemini-cli", runner).invoke({
          capability: "probe",
          data: {},
          attempt: 1,
          scenario: "normal",
          signal: new AbortController().signal,
        }),
      /CLI_OPTIONAL_DISABLED/,
    );
    assert.equal(invoked, false);
    await prepareCliProfiles();
    assert.deepEqual(await readdir(dir), ["codex"]);
  } finally {
    if (prior === undefined) delete process.env.ORBIT_ENABLE_OPTIONAL_GEMINI;
    else process.env.ORBIT_ENABLE_OPTIONAL_GEMINI = prior;
    delete process.env.ORBIT_CLI_DIR;
    await rm(dir, { recursive: true, force: true });
  }
});
test("Codex instance uses 3211/new project and refuses legacy 3210 profile without modifying files", async () => {
  assert.equal(codexInstance.port, 3211);
  assert.equal(codexInstance.dbPort, 55435);
  assert.ok(localDirectory("/workspace/repo").endsWith("/.orbit/codex"));
  const dir = await mkdtemp("/tmp/orbit-legacy-profile-"),
    legacy = {
      project: "orbit-personal-12345678",
      database: "orbit",
      port: 3210,
      dbPort: 55434,
      artifacts: dir + "/artifacts",
    };
  const source = JSON.stringify(legacy);
  await writeFile(dir + "/config.json", source);
  try {
    assert.throws(
      () => validateCodexConfig(legacy),
      /LEGACY_PROFILE_PRESERVED/,
    );
    await assert.rejects(() =>
      promisify(execFile)(process.execPath, ["ops/local.mjs", "status"], {
        env: { ...process.env, ORBIT_LOCAL_DIR: dir },
      }),
    );
    assert.equal(await readFile(dir + "/config.json", "utf8"), source);
    assert.deepEqual(await readdir(dir), ["config.json"]);
    assert.equal(
      validateCodexConfig({
        ...legacy,
        instance: "codex",
        project: "orbit-codex-12345678",
        database: "orbit_codex",
        port: 3211,
        dbPort: 55435,
      }).port,
      3211,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("session and OAuth cookies are independently named while legacy behavior remains unchanged", () => {
  const old = process.env.ORBIT_LOCAL_INSTANCE;
  try {
    delete process.env.ORBIT_LOCAL_INSTANCE;
    assert.equal(sessionCookieName(), "orbit_session");
    assert.equal(gscCookieName(), "orbit_gsc_oauth");
    process.env.ORBIT_LOCAL_INSTANCE = "codex";
    assert.equal(sessionCookieName(), "orbit_codex_session");
    assert.equal(gscCookieName(), "orbit_codex_gsc_oauth");
  } finally {
    if (old === undefined) delete process.env.ORBIT_LOCAL_INSTANCE;
    else process.env.ORBIT_LOCAL_INSTANCE = old;
  }
});
test("unverified included-only policy cannot trigger a real Codex prompt or be overridden by an environment assertion", async () => {
  let invoked = false;
  process.env.ORBIT_LOCAL_MODE = "true";
  process.env.ORBIT_CODEX_INCLUDED_ONLY_VERIFIED = "true";
  try {
    const runner: CliRunner = {
      kind: "LIVE_CLI",
      async run() {
        invoked = true;
        throw Error("MUST_NOT_RUN");
      },
    };
    await assert.rejects(
      () =>
        createSubscriptionAdapter("codex-cli", runner).invoke({
          capability: "probe",
          data: {},
          attempt: 1,
          scenario: "normal",
          signal: new AbortController().signal,
        }),
      /CLI_INCLUDED_ALLOWANCE_UNVERIFIED/,
    );
    assert.equal(invoked, false);
  } finally {
    delete process.env.ORBIT_LOCAL_MODE;
    delete process.env.ORBIT_CODEX_INCLUDED_ONLY_VERIFIED;
  }
});
