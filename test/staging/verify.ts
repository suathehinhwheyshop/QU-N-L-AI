import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { once } from "node:events";
import { parse } from "dotenv";
const dir = resolve(process.env.ORBIT_STAGING_CONFIG ?? ".orbit/staging");
const config = parse(await readFile(dir + "/staging.env"));
const origin = config.ORBIT_BASE_URL;
const host = new URL(origin);
if (host.hostname !== "localhost" || host.protocol !== "https:")
  throw Error("LOCAL_STAGING_ONLY");
const project = process.env.ORBIT_STAGING_PROJECT ?? "orbit-phase4-local";
if (!project.startsWith("orbit-phase4-")) throw Error("LOCAL_PROJECT_REQUIRED");
const args = [
  "--host=unix:///var/run/docker.sock",
  "compose",
  "--env-file",
  dir + "/staging.env",
  "-f",
  "compose.staging.yml",
  "-p",
  project,
];
const docker = (extra: string[], input?: string) =>
  execFileSync("docker", [...args, ...extra], {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 5_000_000,
  });
docker([
  "cp",
  "tls:/data/caddy/pki/authorities/local/root.crt",
  dir + "/ca.crt",
]);
const ca = await readFile(dir + "/ca.crt");
const password = (
    await readFile(dir + "/secrets/bootstrap_password", "utf8")
  ).trim(),
  email = process.env.ORBIT_STAGING_TEST_EMAIL;
if (!email) throw Error("EXPLICIT_TEST_EMAIL_REQUIRED");
let cookie = "";
type Result = {
  status: number;
  headers: IncomingHttpHeaders;
  bytes: Buffer;
  json: () => any;
};
function request(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Result> {
  const bytes =
    body === undefined
      ? undefined
      : Buffer.isBuffer(body)
        ? body
        : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const r = https.request(
      origin + "/api/" + path,
      {
        method,
        ca,
        family: 4,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(method === "GET"
            ? {}
            : { Origin: origin, "Content-Type": "application/json" }),
          ...(bytes ? { "Content-Length": String(bytes.length) } : {}),
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (b) => chunks.push(b));
        response.on("end", () => {
          const bytes = Buffer.concat(chunks);
          resolve({
            status: response.statusCode!,
            headers: response.headers,
            bytes,
            json: () => JSON.parse(bytes.toString()),
          });
        });
      },
    );
    r.on("error", reject);
    if (bytes) r.write(bytes);
    r.end();
  });
}
async function wait(fn: () => Promise<boolean>, limit = 45000) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("STAGING_CONDITION_TIMEOUT");
}
const checks: string[] = [];
let chrome: ChildProcess | undefined;
const nickname = "orbit-phase4-" + randomUUID(),
  nss = join(homedir(), ".pki/nssdb"),
  profile = "/tmp/orbit-staging-" + randomUUID();
let trusted = false;
try {
  assert.equal((await request("health/ready")).status, 200);
  assert.equal((await request("bootstrap")).status, 401);
  assert.equal((await request("admin/metrics")).status, 401);
  assert.equal((await request("worker/tick", "POST", {})).status, 401);
  const login = await request("auth/login", "POST", { email, password });
  assert.equal(login.status, 200);
  const set = login.headers["set-cookie"]?.find((s) =>
    s.startsWith("orbit_session="),
  )!;
  assert.ok(set.includes("HttpOnly"));
  assert.ok(set.includes("Secure"));
  assert.match(set, /SameSite=Strict/i);
  cookie = set.split(";")[0];
  const firstCookie = cookie;
  const boot = (await request("bootstrap")).json();
  assert.equal(boot.identity.email, email);
  assert.equal(boot.identity.role, "ADMIN");
  assert.ok(!JSON.stringify(boot).includes("password_hash"));
  assert.ok(!JSON.stringify(boot).includes("token_hash"));
  assert.equal(boot.workspaces.length, 4);
  assert.equal(
    (
      await request(
        "settings",
        "PATCH",
        { max_budget_cents: 100, concurrency: 2, data_policy: "local-only" },
        { Origin: "https://wrong.invalid" },
      )
    ).status,
    401,
  );
  assert.equal(
    (await request("settings", "PATCH", {}, { "Sec-Fetch-Site": "cross-site" }))
      .status,
    401,
  );
  assert.equal((await request("worker/tick", "POST", {})).status, 404);
  assert.equal(
    (
      await request("connections/openai/config", "PATCH", {
        enabled: true,
        model: "test-model",
        endpoint: "http://169.254.169.254",
      })
    ).status,
    409,
  );
  checks.push(
    "HTTPS verified against local CA; Secure/HttpOnly/Strict cookies, no token/hash exposure, CSRF/SSRF override blocked, no worker-control endpoint",
  );
  const page = await new Promise<{
    headers: IncomingHttpHeaders;
    text: string;
  }>((resolve, reject) =>
    https
      .get(origin + "/login", { ca, family: 4 }, (r) => {
        let text = "";
        r.on("data", (b) => (text += b));
        r.on("end", () => resolve({ headers: r.headers, text }));
      })
      .on("error", reject),
  );
  assert.match(String(page.headers["content-security-policy"]), /nonce-/);
  assert.ok(
    !String(page.headers["content-security-policy"]).includes("'unsafe-eval'"),
  );
  assert.match(String(page.headers["strict-transport-security"]), /max-age=/);
  assert.match(page.text, /name="email"/);
  const spec = {
    property: "sc-domain:wheyshop.vn",
    current: { start: "2026-10-01", end: "2026-10-28" },
    search_type: "web",
    country: "all",
    device: "all",
  };
  const csv =
    "period,page,query,clicks,impressions,position\ncurrent,https://wheyshop.vn/whey,whey,20,1000,8\ncurrent,https://wheyshop.vn/creatine,creatine,30,500,3\ncurrent,https://wheyshop.vn/bcaa,bcaa,5,500,12\n";
  const form = new FormData();
  form.set("spec", JSON.stringify(spec));
  form.set("request_key", randomUUID());
  form.set("file", new File([csv], "staging.csv", { type: "text/csv" }));
  const encoded = new Response(form);
  const imported = await request(
    "gsc/import",
    "POST",
    Buffer.from(await encoded.arrayBuffer()),
    { "Content-Type": encoded.headers.get("content-type")! },
  );
  assert.equal(imported.status, 201);
  const dataset = imported.json();
  assert.equal(dataset.kind, "IMPORT");
  const goal = {
    goal: "Phân tích số liệu SEO có bằng chứng; không chỉnh sửa website",
    workspace_id: boot.workspaces.find(
      (w: { kind: string }) => w.kind === "seo",
    ).id,
    seo_dataset_id: dataset.id,
    request_key: randomUUID(),
    budget_cents: 0,
    mode: "MOCK",
    planning_strategy: "TEMPLATE",
  };
  const planned = await request("plans", "POST", goal);
  assert.equal(planned.status, 200);
  assert.equal(planned.json().nodes.length, 7);
  const created = await request("runs", "POST", goal);
  assert.equal(created.status, 201);
  const run = created.json();
  assert.equal((await request("runs", "POST", goal)).json().id, run.id);
  await wait(
    async () =>
      (await request("runs/" + run.id)).json().run.status ===
      "WAITING_APPROVAL",
  );
  let detail = (await request("runs/" + run.id)).json();
  assert.equal(
    detail.tasks.find((t: { key: string }) => t.key === "board").output.metrics
      .clicks,
    55,
  );
  const approval = detail.approvals[0];
  docker(["restart", "web", "worker"]);
  await wait(async () => (await request("health/ready")).status === 200);
  detail = (await request("runs/" + run.id)).json();
  assert.equal(detail.run.status, "WAITING_APPROVAL");
  assert.equal(detail.approvals[0].output_hash, approval.output_hash);
  assert.equal(
    (
      await request("approvals/" + approval.id, "POST", {
        decision: "approve",
        output_hash: "0".repeat(64),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("approvals/" + approval.id, "POST", {
        decision: "approve",
        output_hash: approval.output_hash,
      })
    ).status,
    200,
  );
  await wait(
    async () =>
      (await request("runs/" + run.id)).json().run.status === "COMPLETED",
  );
  detail = (await request("runs/" + run.id)).json();
  assert.equal(detail.artifacts.length, 10);
  const reports = detail.artifacts.filter((a: { kind: string }) =>
    a.kind.startsWith("report_"),
  );
  for (const file of reports) {
    const downloaded = await request("artifacts/" + file.id);
    assert.equal(downloaded.status, 200);
    assert.equal(
      createHash("sha256").update(downloaded.bytes).digest("hex"),
      file.sha256,
    );
  }
  checks.push(
    "TLS goal → planning → two MOCK providers → code validation → approval → MD/CSV/JSON; idempotency, checksum and persistent state survive web/worker restart",
  );
  const otherPassword = randomBytes(24).toString("hex");
  docker(
    [
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "provision",
      "provision",
      "--email=viewer@staging.orbit.test",
      "--role=VIEWER",
    ],
    otherPassword + "\n",
  );
  const adminCookie = cookie;
  cookie = "";
  const view = await request("auth/login", "POST", {
    email: "viewer@staging.orbit.test",
    password: otherPassword,
  });
  assert.equal(view.status, 200);
  cookie = view.headers["set-cookie"]![0].split(";")[0];
  assert.equal((await request("bootstrap")).status, 200);
  assert.equal((await request("runs/" + run.id)).status, 404);
  assert.equal((await request("artifacts/" + reports[0].id)).status, 404);
  assert.equal((await request("settings", "PATCH", {})).status, 403);
  assert.equal((await request("gsc/oauth/start", "POST", {})).status, 403);
  assert.equal((await request("plans", "POST", goal)).status, 403);
  assert.equal((await request("admin/metrics")).status, 403);
  cookie = adminCookie;
  const dbUserProbe = docker([
    "exec",
    "-T",
    "web",
    "node",
    "--import",
    "tsx",
    "--input-type=module",
    "-e",
    "const {pool}=await import('@orbit/database/client');let denied=false;try{await pool.query('CREATE DATABASE forbidden_staging_probe')}catch(e){denied=e.code==='42501'}await pool.end();if(!denied)process.exit(1);console.log('least privilege PASS');",
  ]);
  assert.match(dbUserProbe, /PASS/);
  const workerProbe = docker([
    "exec",
    "-T",
    "worker",
    "node",
    "--import",
    "tsx",
    "--input-type=module",
    "-e",
    "const {pool}=await import('@orbit/database/client');for(const sql of ['SELECT password_hash FROM users','SELECT token_hash FROM auth_sessions','SELECT verifier_cipher FROM gsc_oauth_states']){let denied=false;try{await pool.query(sql)}catch(e){denied=e.code==='42501'}if(!denied)throw Error('WORKER_PRIVILEGE_LEAK')}await pool.end();console.log('worker least privilege PASS');",
  ]);
  assert.match(workerProbe, /PASS/);
  checks.push(
    "VIEWER cannot mutate, manage credentials, inspect admin metrics or read another owner’s run/artifact; web DB role cannot create databases; worker cannot read password hashes, sessions or OAuth states",
  );
  const logout = await request("auth/logout", "POST", {});
  assert.equal(logout.status, 200);
  assert.equal((await request("bootstrap")).status, 401);
  const again = await request("auth/login", "POST", { email, password });
  assert.equal(again.status, 200);
  cookie = again.headers["set-cookie"]![0].split(";")[0];
  assert.notEqual(cookie, firstCookie);
  assert.equal(
    (
      await request("bootstrap", "GET", undefined, {
        Cookie: "orbit_session=legacy.signed-cookie",
      })
    ).status,
    401,
  );
  checks.push(
    "logout revokes server session, re-login rotates opaque token, legacy signed cookies rejected",
  );
  await mkdir(nss, { recursive: true });
  try {
    execFileSync("certutil", ["-L", "-d", "sql:" + nss], { stdio: "ignore" });
  } catch {
    execFileSync("certutil", ["-N", "-d", "sql:" + nss, "--empty-password"], {
      stdio: "ignore",
    });
  }
  execFileSync("certutil", [
    "-A",
    "-d",
    "sql:" + nss,
    "-n",
    nickname,
    "-t",
    "C,,",
    "-i",
    dir + "/ca.crt",
  ]);
  trusted = true;
  chrome = spawn(
    process.env.ORBIT_CHROMIUM_PATH ?? "/usr/bin/chromium",
    [
      "--headless",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=9232",
      "--user-data-dir=" + profile,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  await wait(async () => (await fetch("http://127.0.0.1:9232/json/list")).ok);
  const browser = spawn(
    process.execPath,
    ["--import", "tsx", "test/e2e/browser.ts"],
    {
      env: {
        ...process.env,
        ORBIT_TEST_LOGIN_EMAIL: email,
        ORBIT_TEST_LOGIN_PASSWORD: password,
        ORBIT_BROWSER_ORIGIN: origin,
        ORBIT_BROWSER_CDP: "http://127.0.0.1:9232",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  browser.stdout?.on("data", (b) => (log += b));
  browser.stderr?.on("data", (b) => (log += b));
  const code = await new Promise<number | null>((r) => browser.once("exit", r));
  await writeFile(".orbit/staging-browser.log", log);
  assert.equal(code, 0, "TLS browser regression failed; private log saved");
  checks.push(
    "Chromium trusts the local CA explicitly; desktop/mobile 390px browser regression passed without TLS bypass",
  );
  await mkdir("docs/evidence", { recursive: true });
  await writeFile(
    "docs/evidence/phase4-staging.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: "LOCAL_HTTPS_STAGING_VERIFIED",
        public_staging: "BLOCKED_NOT_DEPLOYED",
        production_ready: false,
        ai_live_verified: false,
        gsc_live_verified: false,
        origin: "HTTPS loopback only",
        run_id: run.id,
        dataset_id: dataset.id,
        checks,
        report_checksums: reports.map(
          (f: { kind: string; sha256: string }) => ({
            kind: f.kind,
            sha256: f.sha256,
          }),
        ),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ status: "LOCAL_HTTPS_STAGING_VERIFIED", checks }, null, 2),
  );
} finally {
  if (chrome && chrome.exitCode === null) {
    chrome.kill("SIGTERM");
    await Promise.race([
      once(chrome, "exit"),
      new Promise((r) =>
        setTimeout(() => {
          chrome?.kill("SIGKILL");
          r(null);
        }, 3000).unref(),
      ),
    ]);
  }
  if (trusted)
    execFileSync("certutil", ["-D", "-d", "sql:" + nss, "-n", nickname]);
  await rm(profile, { recursive: true, force: true });
}
