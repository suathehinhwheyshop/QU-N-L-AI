import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
config({ path: ".env.local", quiet: true });
const evidencePath = "docs/evidence/phase2-live.json";
const keyNames = [
  "ORBIT_OPENAI_API_KEY",
  "ORBIT_ANTHROPIC_API_KEY",
  "ORBIT_GOOGLE_API_KEY",
  "ORBIT_XAI_API_KEY",
];
const report: Record<string, unknown> = {
  at: new Date().toISOString(),
  kind: "LIVE_API",
  status: "BLOCKED",
  real_api_verified: false,
};
let worker: ChildProcess | undefined;
let pool: (typeof import("@orbit/database/client"))["pool"] | undefined;
async function save() {
  await mkdir("docs/evidence", { recursive: true });
  await writeFile(evidencePath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
try {
  const present = keyNames.filter((k) => !!process.env[k]);
  if (present.length < 2) {
    report.reason = "AT_LEAST_TWO_SERVER_CREDENTIALS_REQUIRED";
    report.missing_credentials = keyNames.filter((k) => !process.env[k]);
    process.exitCode = 2;
  } else if (!process.argv.includes("--execute")) {
    report.reason = "EXPLICIT_EXECUTION_REQUIRED";
    report.next =
      "Review server model/pricing/data policy, then npm run verify:live -- --execute; performs paid calls.";
    process.exitCode = 2;
  } else {
    await import("../src/server/runtime");
    pool = (await import("@orbit/database/client")).pool;
    const { GoalInput, ModelProfile, OrbitError } =
      await import("@orbit/shared/contracts");
    const { probeLive } = await import("../src/server/live");
    const { keyNames: providerKeys } =
      await import("@orbit/providers/transport");
    const engine = await import("@orbit/core/engine");
    const owner = (
      await pool.query("SELECT id FROM users WHERE email='owner@orbit.local'")
    ).rows[0]?.id;
    const setting = (
      await pool.query("SELECT * FROM settings WHERE owner_id=$1", [owner])
    ).rows[0];
    const configs = (
      await pool.query(
        "SELECT * FROM provider_configs WHERE owner_id=$1 AND enabled=true",
        [owner],
      )
    ).rows.filter(
      (c) =>
        providerKeys[c.provider_id] &&
        !!process.env[providerKeys[c.provider_id]] &&
        ModelProfile.safeParse(c.model_config).success,
    );
    if (!owner || setting?.data_policy !== "external" || configs.length < 2) {
      report.reason = "MODEL_PRICING_OR_EXTERNAL_POLICY_REQUIRED";
      process.exitCode = 2;
    } else {
      report.status = "RUNNING";
      const receipts = [];
      for (const c of configs.slice(0, 2))
        receipts.push(await probeLive(owner, c.provider_id));
      report.probes = receipts;
      const workspace = (
        await pool.query(
          "SELECT id FROM workspaces WHERE owner_id=$1 AND kind='research'",
          [owner],
        )
      ).rows[0];
      const run = await engine.createWorkflow(
        owner,
        GoalInput.parse({
          workspace_id: workspace.id,
          request_key: randomUUID(),
          goal: "Lập kế hoạch nghiên cứu đánh giá chất lượng dữ liệu, nêu giả định và giới hạn từ yêu cầu được cung cấp. Không khẳng định đã đọc nguồn bên ngoài.",
          mode: "LIVE",
          planning_strategy: "AI_WITH_FALLBACK",
          live_data_consent: true,
          budget_cents: setting.max_budget_cents,
          acceptance_criteria: [
            "Mỗi nhận định có nguồn từ input hoặc được ghi rõ là giả định.",
          ],
        }),
      );
      report.run_id = run.id;
      await save();
      worker = spawn(process.execPath, ["--import", "tsx", "src/worker.ts"], {
        env: { ...process.env },
        stdio: "ignore",
      });
      const deadline = Date.now() + 240000;
      let row;
      while (Date.now() < deadline) {
        row = (
          await pool.query("SELECT status,error_code FROM runs WHERE id=$1", [
            run.id,
          ])
        ).rows[0];
        if (
          ["FAILED", "CANCELED", "WAITING_APPROVAL", "COMPLETED"].includes(
            row.status,
          )
        )
          break;
        await new Promise((r) => setTimeout(r, 300));
      }
      report.workflow_status = row?.status;
      if (row?.status !== "WAITING_APPROVAL")
        throw new OrbitError(row?.error_code ?? "LIVE_SMOKE_TIMEOUT");
      const attempts = (
        await pool.query(
          "SELECT a.provider_id,a.model,a.status,a.cost_cents,a.usage FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE t.run_id=$1 AND t.kind='model'",
          [run.id],
        )
      ).rows;
      const successes = attempts.filter(
        (a) =>
          a.status === "COMPLETED" && a.usage?.evidence?.kind === "LIVE_API",
      );
      if (new Set(successes.map((a) => a.provider_id)).size < 2)
        throw new OrbitError("UNTRUSTED_EXECUTION");
      report.attempts = attempts;
      report.real_api_verified = true;
      report.status = "PASS_TO_APPROVAL";
      report.notice =
        "Two official APIs executed structured handoff through worker/database. Human approval and final delivery remain pending; open this run in ORBIT. This is not full Phase 2 acceptance.";
    }
  }
} catch (error) {
  report.status = "FAILED";
  report.reason =
    error instanceof Error && /^[A-Z_]+$/.test(error.message)
      ? error.message
      : "LIVE_SMOKE_FAILED";
  process.exitCode = 1;
} finally {
  if (worker && worker.exitCode === null) {
    worker.kill("SIGTERM");
    await Promise.race([
      once(worker, "exit"),
      new Promise((r) =>
        setTimeout(() => {
          worker?.kill("SIGKILL");
          r(null);
        }, 5000).unref(),
      ),
    ]);
  }
  await pool?.end();
  await save();
}
