import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { testDatabase } from "../support";
import {
  assertRole,
  assertWorkspace,
  tokenHash,
} from "@orbit/database/security";
import { GoalInput } from "@orbit/shared/contracts";
import { gscStub } from "../gsc-support";
import { GscOAuth } from "@orbit/integrations/gsc-oauth";
let database: Awaited<ReturnType<typeof testDatabase>>,
  pool: (typeof import("@orbit/database/client"))["pool"],
  auth: typeof import("../../src/server/auth"),
  provision: (typeof import("../../scripts/provision-user"))["provisionUser"],
  engine: typeof import("@orbit/core/engine"),
  admin: string,
  workspace: string;
const password = randomBytes(24).toString("hex"),
  email = "admin@security.orbit.test";
before(async () => {
  database = await testDatabase();
  await import("../../src/server/runtime");
  pool = (await import("@orbit/database/client")).pool;
  auth = await import("../../src/server/auth");
  engine = await import("@orbit/core/engine");
  provision = (await import("../../scripts/provision-user")).provisionUser;
  admin = await provision(email, password);
  workspace = (
    await pool.query(
      "SELECT id FROM workspaces WHERE owner_id=$1 AND kind='seo'",
      [admin],
    )
  ).rows[0].id;
});
after(async () => {
  await pool?.end();
  await database?.cleanup();
});
test("real account login has opaque hashed sessions; logout, absolute/idle expiry and password reset revoke access", async () => {
  assert.equal(await auth.login(email, password, "test-a"), admin);
  const token = await auth.issueSession(admin);
  assert.equal((await auth.session(token))?.user_id, admin);
  const record = (
    await pool.query("SELECT * FROM auth_sessions WHERE token_hash=$1", [
      tokenHash(token),
    ])
  ).rows[0];
  assert.notEqual(record.token_hash, token);
  await auth.revokeSession(token);
  assert.equal(await auth.session(token), null);
  const expired = await auth.issueSession(admin);
  await pool.query(
    "UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
    [tokenHash(expired)],
  );
  assert.equal(await auth.session(expired), null);
  const idle = await auth.issueSession(admin);
  await pool.query(
    "UPDATE auth_sessions SET last_seen=now()-interval '31 minutes' WHERE token_hash=$1",
    [tokenHash(idle)],
  );
  assert.equal(await auth.session(idle), null);
  const old = await auth.issueSession(admin);
  await provision(email, password);
  assert.equal(await auth.session(old), null);
  assert.equal(await auth.session("body.signed-legacy-cookie"), null);
});
test("environment password is not an authentication backdoor; distributed login quotas bound guessing", async () => {
  process.env.ORBIT_ADMIN_PASSWORD = "legacy-env-only-password";
  await assert.rejects(
    () => auth.login(email, process.env.ORBIT_ADMIN_PASSWORD!, "test-b"),
    /UNAUTHORIZED/,
  );
  for (let i = 0; i < 10; i++)
    await assert.rejects(
      () => auth.login("missing@security.orbit.test", "incorrect", "rate-test"),
      /UNAUTHORIZED/,
    );
  await assert.rejects(
    () => auth.login("missing@security.orbit.test", "incorrect", "rate-test"),
    /RATE_LIMIT/,
  );
});
test("RBAC and workspace permissions are enforced on server and worker claim after revocation", async () => {
  const viewer = await provision(
    "viewer@security.orbit.test",
    password,
    "VIEWER",
  );
  await assertRole(viewer, "read");
  await assert.rejects(() => assertRole(viewer, "execute"), /FORBIDDEN/);
  await assert.rejects(() => assertRole(viewer, "manage"), /FORBIDDEN/);
  await assert.rejects(
    () => assertWorkspace(viewer, workspace, "read"),
    /FORBIDDEN/,
  );
  const run = await engine.createWorkflow(
    admin,
    GoalInput.parse({
      goal: "Verify permission-bound workflow execution",
      workspace_id: workspace,
      request_key: randomUUID(),
    }),
  );
  await pool.query(
    "UPDATE workspace_members SET role='VIEWER' WHERE user_id=$1 AND workspace_id=$2",
    [admin, workspace],
  );
  assert.equal(await engine.claimTask(), null);
  await assert.rejects(
    () => assertWorkspace(admin, workspace, "execute"),
    /FORBIDDEN/,
  );
  await pool.query(
    "UPDATE workspace_members SET role='EDITOR' WHERE user_id=$1 AND workspace_id=$2",
    [admin, workspace],
  );
  await assertWorkspace(admin, workspace, "execute");
  await assert.rejects(
    () => assertWorkspace(admin, workspace, "approve"),
    /FORBIDDEN/,
  );
  await pool.query(
    "UPDATE workspace_members SET role='ADMIN' WHERE user_id=$1 AND workspace_id=$2",
    [admin, workspace],
  );
  await engine.controlRun(admin, run.id, "cancel");
});
test("inactive users and OAuth callbacks from revoked sessions are rejected before token exchange", async () => {
  const token = await auth.issueSession(admin);
  await pool.query("UPDATE users SET is_active=false WHERE id=$1", [admin]);
  assert.equal(await auth.session(token), null);
  await pool.query("UPDATE users SET is_active=true WHERE id=$1", [admin]);
  process.env.ORBIT_GSC_CLIENT_ID = "fixture-client";
  process.env.ORBIT_GSC_CLIENT_SECRET = "fixture-client-secret";
  process.env.ORBIT_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const stub = await gscStub();
  try {
    const oauth = new GscOAuth(stub.transport);
    const session = await auth.issueSession(admin);
    const begin = await oauth.begin(admin, tokenHash(session));
    await auth.revokeSession(session);
    await assert.rejects(
      () =>
        oauth.callback(
          new URL(begin.url).searchParams.get("state")!,
          begin.browser,
          "fixture-code",
          new AbortController().signal,
        ),
      /GSC_OAUTH_STATE/,
    );
    assert.equal(stub.requests.length, 0);
  } finally {
    await stub.close();
  }
});
test("active-workflow quota is enforced atomically and idempotent replays still succeed", async () => {
  const goal = GoalInput.parse({
    goal: "Verify bounded queued workflows",
    workspace_id: workspace,
    request_key: randomUUID(),
  });
  const run = await engine.createWorkflow(admin, goal);
  await pool.query(
    "INSERT INTO runs(owner_id,workspace_id,request_key,goal,mode,config,plan,budget_cents) SELECT owner_id,workspace_id,gen_random_uuid(),goal,mode,config,plan,budget_cents FROM runs CROSS JOIN generate_series(1,49) WHERE id=$1",
    [run.id],
  );
  await assert.rejects(
    () =>
      engine.createWorkflow(
        admin,
        GoalInput.parse({ ...goal, request_key: randomUUID() }),
      ),
    /QUOTA_EXCEEDED/,
  );
  assert.equal((await engine.createWorkflow(admin, goal)).id, run.id);
});
