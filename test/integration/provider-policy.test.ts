import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { testDatabase } from "../support";
let db: Awaited<ReturnType<typeof testDatabase>>,
  pool: (typeof import("@orbit/database/client"))["pool"],
  owner: string,
  dir: string;
before(async () => {
  db = await testDatabase();
  dir = await mkdtemp("/tmp/orbit-product-policy-");
  process.env.ORBIT_CLI_DIR = dir;
  process.env.ORBIT_SUBSCRIPTIONS_ENABLED = "true";
  delete process.env.ORBIT_ENABLE_OPTIONAL_GEMINI;
  await import("../../src/server/runtime");
  pool = (await import("@orbit/database/client")).pool;
  owner = (await (await import("../../scripts/seed")).seed()).id;
});
after(async () => {
  for (const k of [
    "ORBIT_CLI_DIR",
    "ORBIT_SUBSCRIPTIONS_ENABLED",
    "ORBIT_ENABLE_OPTIONAL_GEMINI",
  ])
    delete process.env[k];
  await pool.end();
  await db.cleanup();
  await rm(dir, { recursive: true, force: true });
});
test("default catalog has Claude Max5x, ChatGPT and Grokbot; no inferred Grokbot→xAI entitlement", async () => {
  const { subscriptionCatalog } =
    await import("../../src/server/subscriptions");
  const rows = await subscriptionCatalog(owner);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["claude-code", "codex-cli", "grokbot"],
  );
  assert.equal(rows[0].name, "Claude Max 5x");
  assert.equal(rows[0].status, "BLOCKED");
  assert.equal(rows[2].status, "BLOCKED");
  assert.equal(rows[2].vendor, "grokbot-unverified");
  assert.ok(rows.every((r) => r.status !== "CONNECTED"));
});
test("legacy enabled Gemini is disabled without deleting history; direct probe refuses before process/receipt creation", async () => {
  await pool.query(
    "UPDATE provider_configs SET enabled=true WHERE owner_id=$1 AND provider_id='gemini-cli'",
    [owner],
  );
  const { initializeSubscriptions } =
    await import("@orbit/database/subscriptions");
  await initializeSubscriptions(owner);
  assert.equal(
    (
      await pool.query(
        "SELECT enabled FROM provider_configs WHERE owner_id=$1 AND provider_id='gemini-cli'",
        [owner],
      )
    ).rows[0].enabled,
    false,
  );
  const before = (
    await pool.query("SELECT count(*)::int n FROM provider_probes")
  ).rows[0].n;
  const { probeSubscription } = await import("../../src/server/subscriptions");
  await assert.rejects(
    () => probeSubscription(owner, "gemini-cli", new AbortController().signal),
    /CLI_OPTIONAL_DISABLED/,
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM provider_probes")).rows[0].n,
    before,
  );
});
test("synthetic ChatGPT receipt cannot bypass included-allowance/cross-provider gates or activate Gemini", async () => {
  const { activeSubscriptionProviders, cliTag, subscriptionProviders } =
    await import("@orbit/providers/subscription-cli");
  const { configHash, configuredCandidates } =
    await import("@orbit/core/live-policy");
  const { installRegistry } = await import("@orbit/core/registry");
  const { workspaceHandlers } = await import("@orbit/workspaces/handlers");
  const { integrations } = await import("@orbit/integrations/registry");
  for (const p of subscriptionProviders)
    await pool.query(
      "INSERT INTO provider_probes(owner_id,provider_id,model,kind,status,config_hash,credential_tag,capabilities) VALUES($1,$2,'default','LIVE_CLI','VERIFIED',$3,$4,$5)",
      [
        owner,
        p.descriptor.id,
        configHash("default", null),
        cliTag(p.descriptor.id),
        JSON.stringify(p.descriptor.capabilities),
      ],
    );
  // Test receipt is synthetic database input, never evidence of a live request.
  await pool.query(
    "UPDATE settings SET data_policy='external' WHERE owner_id=$1",
    [owner],
  );
  await pool.query(
    "UPDATE provider_configs SET enabled=true WHERE owner_id=$1 AND provider_id='gemini-cli'",
    [owner],
  );
  installRegistry({
    providers: subscriptionProviders,
    handlers: workspaceHandlers,
    integrations,
  });
  const c = await pool.connect();
  try {
    assert.equal(
      (await configuredCandidates(c, owner)).find((x) => x.id === "gemini-cli")!
        .available,
      false,
    );
  } finally {
    c.release();
  }
  installRegistry({
    providers: activeSubscriptionProviders(),
    handlers: workspaceHandlers,
    integrations,
  });
  const ws = (
    await pool.query(
      "SELECT id FROM workspaces WHERE owner_id=$1 AND kind='research'",
      [owner],
    )
  ).rows[0].id;
  const { GoalInput } = await import("@orbit/shared/contracts");
  const { createWorkflow } = await import("@orbit/core/engine");
  await assert.rejects(
    () =>
      createWorkflow(
        owner,
        GoalInput.parse({
          goal: "Kiểm chứng hai provider độc lập bằng quyền thuê bao",
          workspace_id: ws,
          mode: "LIVE",
          live_data_consent: true,
          request_key: randomUUID(),
        }),
      ),
    /LIVE_NOT_READY/,
  );
});
