import { configuredCandidates, admitLive, configHash } from "./live-policy";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@orbit/database/client";
import type { Run, Task, Attempt } from "@orbit/database/schema";
import {
  GoalInput,
  OrbitError,
  safeMessage,
  type Goal,
  type Plan,
} from "@orbit/shared/contracts";
import { planGoal, validateGoalAccess } from "./planner";
import { routeModel } from "./router";
import { getProvider, getHandler } from "./registry";
import { LocalArtifactStore, digest, jsonBytes } from "@orbit/storage/store";
export const blobs = new LocalArtifactStore();
async function transaction<T>(fn: (c: PoolClient) => Promise<T>) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(7493121)");
    const v = await fn(c);
    await c.query("COMMIT");
    return v;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function event(
  c: PoolClient,
  run: string,
  type: string,
  message: string,
  task?: string,
  attempt?: string,
) {
  await c.query(
    "INSERT INTO events(run_id,task_id,attempt_id,type,message) VALUES($1,$2,$3,$4,$5)",
    [run, task ?? null, attempt ?? null, type, message],
  );
}
async function owned(c: PoolClient, id: string, owner: string) {
  const { rows } = await c.query<Run>(
    "SELECT * FROM runs WHERE id=$1 AND owner_id=$2 FOR UPDATE",
    [id, owner],
  );
  if (!rows[0]) throw new OrbitError("NOT_FOUND");
  return rows[0];
}
export async function previewGoal(owner: string, goal: Goal) {
  const { rows } = await pool.query(
    "SELECT * FROM workspaces WHERE id=$1 AND owner_id=$2",
    [goal.workspace_id, owner],
  );
  if (!rows[0]) throw new OrbitError("NOT_FOUND");
  await validateGoalAccess(owner, goal, rows[0].kind);
  const plan = planGoal(goal, rows[0].kind);
  const readiness =
    goal.mode === "LIVE"
      ? await admitLive(
          owner,
          goal,
          plan.nodes.filter((n) => n.kind === "model").map((n) => n.capability),
        )
      : null;
  if (readiness)
    plan.estimate = {
      mode: "LIVE",
      cost_cents: readiness.estimate,
      notice: readiness.notice,
    };
  return plan;
}
export async function createWorkflow(owner: string, goal: Goal) {
  // Replays must keep returning the persisted run even after a LIVE probe
  // expires or the operator revokes external execution permission.
  const existing = (
    await pool.query<Run>(
      "SELECT * FROM runs WHERE owner_id=$1 AND request_key=$2",
      [owner, goal.request_key],
    )
  ).rows[0];
  if (existing) {
    if (
      digest(jsonBytes(GoalInput.parse(existing.config))) !==
      digest(jsonBytes(goal))
    )
      throw new OrbitError("CONFLICT");
    return existing;
  }
  const plan = await previewGoal(owner, goal);
  return createFromPlan(owner, goal, plan);
}
export async function createFromPlan(owner: string, goal: Goal, plan: Plan) {
  return transaction(async (c) => {
    const old = await c.query<Run>(
      "SELECT * FROM runs WHERE owner_id=$1 AND request_key=$2",
      [owner, goal.request_key],
    );
    if (old.rows[0]) {
      if (
        digest(jsonBytes(GoalInput.parse(old.rows[0].config))) !==
        digest(jsonBytes(goal))
      )
        throw new OrbitError("CONFLICT");
      return old.rows[0];
    }
    const ws = await c.query(
      "SELECT * FROM workspaces WHERE id=$1 AND owner_id=$2",
      [goal.workspace_id, owner],
    );
    if (!ws.rows[0]) throw new OrbitError("NOT_FOUND");
    await validateGoalAccess(owner, goal, ws.rows[0].kind);
    if (goal.mode === "LIVE")
      await admitLive(
        owner,
        goal,
        plan.nodes.filter((n) => n.kind === "model").map((n) => n.capability),
      );
    const { validateGraph } = await import("./planner");
    validateGraph(plan.nodes);
    const setting = (
      await c.query("SELECT * FROM settings WHERE owner_id=$1", [owner])
    ).rows[0];
    if (!setting || goal.budget_cents > setting.max_budget_cents)
      throw new OrbitError("BUDGET_EXCEEDED");
    const queued = (
      await c.query(
        "SELECT count(*)::int n FROM runs WHERE owner_id=$1 AND status IN ('QUEUED','RUNNING','PAUSED','WAITING_APPROVAL')",
        [owner],
      )
    ).rows[0].n;
    if (queued >= 50) throw new OrbitError("QUOTA_EXCEEDED");
    if (goal.attachment_ids.length) {
      const n = await c.query(
        "SELECT id FROM artifacts WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND kind=$3",
        [goal.attachment_ids, owner, "upload"],
      );
      if (n.rowCount !== goal.attachment_ids.length)
        throw new OrbitError("NOT_FOUND");
    }
    const {
      rows: [run],
    } = await c.query<Run>(
      "INSERT INTO runs(owner_id,workspace_id,request_key,goal,mode,config,plan,budget_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [
        owner,
        goal.workspace_id,
        goal.request_key,
        goal.goal,
        goal.mode,
        goal,
        plan,
        goal.budget_cents,
      ],
    );
    const ids = new Map<string, string>();
    for (const n of plan.nodes) {
      const taskId = randomUUID();
      ids.set(n.key, taskId);
      await c.query(
        "INSERT INTO tasks(id,run_id,key,title,handler,kind,capability,effect,priority,acceptance,max_attempts,timeout_ms,input) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
        [
          taskId,
          run.id,
          n.key,
          n.title,
          n.handler,
          n.kind,
          n.capability,
          n.effect,
          n.priority,
          n.acceptance,
          n.max_attempts,
          n.timeout_ms,
          n.input,
        ],
      );
    }
    for (const n of plan.nodes)
      for (const d of n.depends_on)
        await c.query(
          "INSERT INTO task_dependencies(task_id,depends_on_id) VALUES($1,$2)",
          [ids.get(n.key), ids.get(d)],
        );
    await event(
      c,
      run.id,
      "CREATED",
      `Đã lưu goal và DAG. Mode ${run.mode}; chỉ tạo báo cáo, không ghi lên website.`,
    );
    return run;
  });
}
export type Claim = { task: Task; attempt: Attempt; run: Run };
async function finishState(c: PoolClient, runId: string) {
  const r = (
    await c.query<Run>("SELECT * FROM runs WHERE id=$1 FOR UPDATE", [runId])
  ).rows[0];
  if (["CANCELED", "FAILED", "PAUSED"].includes(r.status)) return;
  const all = (
    await c.query<Task>("SELECT * FROM tasks WHERE run_id=$1", [runId])
  ).rows;
  const status = all.some((t) => t.status === "FAILED")
    ? "FAILED"
    : all.every((t) => t.status === "COMPLETED")
      ? "COMPLETED"
      : all.some((t) => t.status === "WAITING_APPROVAL")
        ? "WAITING_APPROVAL"
        : "RUNNING";
  await c.query(
    "UPDATE runs SET status=$2,updated_at=now(),finished_at=CASE WHEN $2 IN ('COMPLETED','FAILED') THEN now() ELSE NULL END WHERE id=$1",
    [runId, status],
  );
  if (status === "COMPLETED")
    await event(
      c,
      runId,
      "COMPLETED",
      `Đã kiểm chứng output và bàn giao artifact. Mode ${r.mode}.`,
    );
}
export async function claimTask(): Promise<Claim | null> {
  return transaction(async (c) => {
    const {
      rows: [task],
    } =
      await c.query<Task>(`SELECT t.* FROM tasks t JOIN runs r ON r.id=t.run_id JOIN settings s ON s.owner_id=r.owner_id
 WHERE t.status='PENDING' AND t.next_attempt_at<=now() AND r.status IN ('QUEUED','RUNNING')
 AND (SELECT count(*) FROM tasks busy JOIN runs br ON br.id=busy.run_id WHERE br.owner_id=r.owner_id AND busy.status='RUNNING')<s.concurrency
 AND EXISTS(SELECT 1 FROM users u JOIN workspace_members m ON m.user_id=u.id WHERE u.id=r.owner_id AND u.is_active=true AND u.role IN ('ADMIN','OPERATOR') AND m.workspace_id=r.workspace_id AND m.role IN ('ADMIN','EDITOR'))
 AND NOT EXISTS(SELECT 1 FROM task_dependencies d JOIN tasks p ON p.id=d.depends_on_id WHERE d.task_id=t.id AND p.status<>'COMPLETED')
 ORDER BY t.priority,t.created_at,t.key FOR UPDATE OF t SKIP LOCKED LIMIT 1`);
    if (!task) return null;
    const run = (
      await c.query<Run>("SELECT * FROM runs WHERE id=$1 FOR UPDATE", [
        task.run_id,
      ])
    ).rows[0];
    if (task.effect !== "read") {
      await fatal(c, task, run, "FORBIDDEN_EFFECT");
      return null;
    }
    const setting = (
      await c.query("SELECT * FROM settings WHERE owner_id=$1", [run.owner_id])
    ).rows[0];
    let providerId: string | null = null,
      model: string | null = null,
      reserve = 0;
    let snapshot: Record<string, unknown> | null = null;
    if (task.kind === "model") {
      const avoidKey = task.input.avoid_provider_task;
      const avoid = avoidKey
        ? (
            await c.query(
              "SELECT provider_id FROM tasks WHERE run_id=$1 AND key=$2",
              [run.id, avoidKey],
            )
          ).rows[0]?.provider_id
        : undefined;
      try {
        const configured = await configuredCandidates(c, run.owner_id);
        const d = routeModel(
          configured,
          task.capability,
          run.mode as "MOCK" | "LIVE",
          setting.data_policy,
          run.budget_cents - run.spent_cents - run.reserved_cents,
          avoid,
        );
        providerId = d.id;
        model = d.model;
        reserve = d.costCents;
        snapshot = {
          profile:
            d.profile ??
            (
              await c.query(
                "SELECT model_config FROM provider_configs WHERE owner_id=$1 AND provider_id=$2",
                [run.owner_id, d.id],
              )
            ).rows[0]?.model_config,
          credential_tag: getProvider(d.id).credentialTag?.() ?? null,
        };
      } catch (e) {
        if (getHandler(task.handler).safeFallback) {
          providerId = null;
          model = null;
          reserve = 0;
        } else {
          await fatal(
            c,
            task,
            run,
            e instanceof OrbitError ? e.code : "NO_PROVIDER",
          );
          return null;
        }
      }
    }
    const id = randomUUID();
    const {
      rows: [attempt],
    } = await c.query<Attempt>(
      "INSERT INTO attempts(id,task_id,number,status,provider_id,model,reserved_cents,provider_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [
        id,
        task.id,
        task.attempt_count + 1,
        task.kind === "approval" ? "WAITING_APPROVAL" : "RUNNING",
        providerId,
        model,
        reserve,
        snapshot,
      ],
    );
    if (task.kind === "approval") {
      const parent = (
        await c.query<Task>(
          "SELECT p.* FROM task_dependencies d JOIN tasks p ON p.id=d.depends_on_id WHERE d.task_id=$1",
          [task.id],
        )
      ).rows[0];
      if (!parent?.output) throw new OrbitError("INVALID_OUTPUT");
      await c.query(
        "INSERT INTO approvals(run_id,task_id,output_hash) VALUES($1,$2,$3) ON CONFLICT(task_id) DO NOTHING",
        [run.id, task.id, digest(jsonBytes(parent.output))],
      );
      await c.query(
        "UPDATE tasks SET status=$2,attempt_count=attempt_count+1,active_attempt_id=$3 WHERE id=$1",
        [task.id, "WAITING_APPROVAL", id],
      );
      await c.query("UPDATE runs SET status=$2,updated_at=now() WHERE id=$1", [
        run.id,
        "WAITING_APPROVAL",
      ]);
      await event(
        c,
        run.id,
        "WAITING_APPROVAL",
        "Bảng việc đã sẵn sàng. Cần anh duyệt trước khi xuất báo cáo.",
        task.id,
        id,
      );
      return null;
    }
    const {
      rows: [updated],
    } = await c.query<Task>(
      "UPDATE tasks SET status='RUNNING',attempt_count=attempt_count+1,active_attempt_id=$2,provider_id=$3,model=$4,lease_until=now()+($5::integer*interval '1 millisecond'),updated_at=now() WHERE id=$1 RETURNING *",
      [task.id, id, providerId, model, task.timeout_ms + 5000],
    );
    await c.query(
      "UPDATE runs SET status='RUNNING',reserved_cents=reserved_cents+$2,updated_at=now() WHERE id=$1",
      [run.id, reserve],
    );
    await event(
      c,
      run.id,
      "ATTEMPT_STARTED",
      `Bắt đầu attempt ${attempt.number}; ${providerId || task.kind}; mode ${run.mode}.`,
      task.id,
      id,
    );
    return { task: updated, attempt, run };
  });
}
async function fatal(c: PoolClient, task: Task, run: Run, code: string) {
  await c.query(
    "UPDATE tasks SET status='FAILED',error_code=$2,lease_until=NULL WHERE id=$1",
    [task.id, code],
  );
  await c.query(
    "UPDATE runs SET status='FAILED',error_code=$2,updated_at=now(),finished_at=now() WHERE id=$1",
    [run.id, code],
  );
  await event(
    c,
    run.id,
    "FAILED",
    safeMessage[code] || "Tác vụ không hoàn thành.",
    task.id,
  );
}
async function dependenciesFor(task: Task) {
  const rows = (
    await pool.query<Task>(
      "SELECT p.* FROM task_dependencies d JOIN tasks p ON p.id=d.depends_on_id WHERE d.task_id=$1",
      [task.id],
    )
  ).rows;
  const inputs: Record<string, Record<string, unknown>> = {},
    hashes: Record<string, string> = {};
  for (const parent of rows) {
    if (!parent.output || parent.status !== "COMPLETED")
      throw new OrbitError("INVALID_OUTPUT");
    const artifact = (
      await pool.query("SELECT * FROM artifacts WHERE task_id=$1 AND kind=$2", [
        parent.id,
        "output",
      ])
    ).rows[0];
    if (!artifact) throw new OrbitError("ARTIFACT_CORRUPT");
    await blobs.read(artifact.blob_key, artifact.sha256);
    if (digest(jsonBytes(parent.output)) !== artifact.sha256)
      throw new OrbitError("ARTIFACT_CORRUPT");
    inputs[parent.key] = parent.output;
    hashes[parent.key] = artifact.sha256;
  }
  return { inputs, hashes };
}
export async function executeClaim(claim: Claim) {
  const { task, attempt, run } = claim;
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined,
    cost = 0,
    usage: Record<string, unknown> = { mock: run.mode === "MOCK" };
  let successfulLiveCall = false;
  try {
    const work = async () => {
      const handler = getHandler(task.handler);
      handler.input.parse(task.input);
      const deps = await dependenciesFor(task);
      const raw = await handler.execute({
        execution: {
          ownerId: run.owner_id,
          runId: run.id,
          taskId: task.id,
          attemptId: attempt.id,
        },
        input: task.input,
        signal: controller.signal,
        ...deps,
        invoke: async (data) => {
          if (!task.provider_id) throw new OrbitError("NO_PROVIDER");
          const adapter = getProvider(task.provider_id);
          if (
            run.mode === "LIVE" &&
            adapter.credentialTag?.() !==
              attempt.provider_snapshot?.credential_tag
          )
            throw new OrbitError("LIVE_NOT_READY");
          let result;
          try {
            result = await adapter.invoke({
              capability: task.capability,
              model: task.model ?? undefined,
              profile: attempt.provider_snapshot?.profile as Parameters<
                typeof adapter.invoke
              >[0]["profile"],
              data: {
                ...data,
                goal: task.input.goal,
                workspace: task.input.workspace,
                goal_contract: task.input.goal_contract,
              },
              attempt: attempt.number,
              scenario: String(task.input.scenario),
              signal: handler.invokeTimeoutMs
                ? AbortSignal.any([
                    controller.signal,
                    AbortSignal.timeout(handler.invokeTimeoutMs),
                  ])
                : controller.signal,
            });
          } catch (error) {
            if (
              run.mode === "LIVE" &&
              error instanceof OrbitError &&
              [
                "AUTH_FAILED",
                "UNVERIFIED_MODEL",
                "API_RESPONSE_INVALID",
              ].includes(error.code)
            ) {
              await pool.query(
                "INSERT INTO provider_probes(owner_id,provider_id,model,kind,status,config_hash,credential_tag,capabilities,error_code,finished_at) VALUES($1,$2,$3,'INVOCATION_FAILURE','FAILED',$4,$5,'[]',$6,now())",
                [
                  run.owner_id,
                  task.provider_id,
                  task.model,
                  configHash(task.model!, attempt.provider_snapshot?.profile),
                  attempt.provider_snapshot?.credential_tag ?? "",
                  error.code,
                ],
              );
            }
            if (error instanceof OrbitError && error.billingUncertain) {
              cost = attempt.reserved_cents;
              usage = { billing_state: "UNCERTAIN_RESERVED_CHARGED" };
            }
            throw error;
          }
          cost = result.costCents;
          usage = result.usage;
          if (
            run.mode === "LIVE" &&
            (result.evidence?.kind !== "LIVE_API" ||
              result.evidence.provider !==
                getProvider(task.provider_id).descriptor.vendor ||
              result.evidence.model !== task.model)
          )
            throw new OrbitError("UNTRUSTED_EXECUTION");
          successfulLiveCall = result.evidence?.kind === "LIVE_API";
          return result;
        },
      });
      const parsed = handler.output.safeParse(raw);
      if (!parsed.success) throw new OrbitError("INVALID_OUTPUT");
      if (
        run.mode === "LIVE" &&
        task.kind === "model" &&
        !successfulLiveCall &&
        !(
          handler.safeFallback &&
          (parsed.data as { strategy?: string }).strategy ===
            "TEMPLATE_FALLBACK"
        )
      )
        throw new OrbitError("UNTRUSTED_EXECUTION");
      return parsed.data as Record<string, unknown>;
    };
    const output = await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new OrbitError("TIMEOUT", true));
        }, task.timeout_ms);
      }),
    ]);
    const stored = await blobs.put(jsonBytes(output));
    const rendered = getHandler(task.handler).renderArtifacts?.(output) ?? [];
    if (
      rendered.length > 5 ||
      rendered.some(
        (f) => !/^report_[a-z]+$/.test(f.kind) || f.bytes.length > 10000000,
      )
    )
      throw new OrbitError("INVALID_OUTPUT");
    const files = [];
    for (const f of rendered)
      files.push({ ...f, stored: await blobs.put(f.bytes) });
    await completeAttempt(claim, output, stored, cost, usage, files);
  } catch (error) {
    const code =
      error instanceof OrbitError
        ? error.code
        : error instanceof Error && error.name === "ZodError"
          ? "INVALID_OUTPUT"
          : "PROVIDER_FAILURE";
    if (code === "TIMEOUT" && run.mode === "LIVE" && !successfulLiveCall) {
      cost = attempt.reserved_cents;
      usage = { billing_state: "UNCERTAIN_RESERVED_CHARGED" };
    }
    await failAttempt(
      claim,
      code,
      error instanceof OrbitError ? error.retryable : false,
      cost,
      usage,
      typeof (error as { retryAfterMs?: unknown })?.retryAfterMs === "number"
        ? (error as { retryAfterMs: number }).retryAfterMs
        : 0,
    );
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}
async function completeAttempt(
  { task, attempt, run }: Claim,
  output: Record<string, unknown>,
  stored: { key: string; sha256: string; size: number },
  cost: number,
  usage: Record<string, unknown>,
  files: {
    name: string;
    kind: string;
    mediaType: string;
    stored: { key: string; sha256: string; size: number };
  }[] = [],
) {
  await transaction(async (c) => {
    const latest = (
      await c.query<Task>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [
        task.id,
      ])
    ).rows[0];
    const r = (
      await c.query<Run>("SELECT * FROM runs WHERE id=$1 FOR UPDATE", [run.id])
    ).rows[0];
    if (latest.active_attempt_id !== attempt.id || latest.status !== "RUNNING")
      return;
    if (r.status === "CANCELED") {
      await c.query(
        "UPDATE tasks SET status='CANCELED',lease_until=NULL WHERE id=$1",
        [task.id],
      );
      await c.query(
        "UPDATE attempts SET status='CANCELED',cost_cents=$2,usage=$3,finished_at=now() WHERE id=$1",
        [attempt.id, cost, usage],
      );
      await c.query(
        "UPDATE runs SET reserved_cents=reserved_cents-$2,spent_cents=spent_cents+$3 WHERE id=$1",
        [r.id, attempt.reserved_cents, cost],
      );
      return;
    }
    const sources = (
      await c.query(
        "SELECT a.id FROM task_dependencies d JOIN artifacts a ON a.task_id=d.depends_on_id AND a.kind=$2 WHERE d.task_id=$1",
        [task.id, "output"],
      )
    ).rows.map((x) => x.id);
    await c.query(
      "INSERT INTO artifacts(owner_id,run_id,task_id,attempt_id,name,kind,mode,media_type,size_bytes,sha256,blob_key,source_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        r.owner_id,
        r.id,
        task.id,
        attempt.id,
        task.key + ".json",
        "output",
        r.mode,
        "application/json",
        stored.size,
        stored.sha256,
        stored.key,
        JSON.stringify(sources),
      ],
    );
    for (const file of files)
      await c.query(
        "INSERT INTO artifacts(owner_id,run_id,task_id,attempt_id,name,kind,mode,media_type,size_bytes,sha256,blob_key,source_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          r.owner_id,
          r.id,
          task.id,
          attempt.id,
          file.name,
          file.kind,
          r.mode,
          file.mediaType,
          file.stored.size,
          file.stored.sha256,
          file.stored.key,
          JSON.stringify(sources),
        ],
      );
    await c.query(
      "UPDATE attempts SET status='COMPLETED',cost_cents=$2,usage=$3,finished_at=now() WHERE id=$1",
      [attempt.id, cost, usage],
    );
    await c.query(
      "UPDATE tasks SET status='COMPLETED',output=$2,lease_until=NULL,error_code=NULL,updated_at=now() WHERE id=$1",
      [task.id, output],
    );
    await c.query(
      "UPDATE runs SET reserved_cents=reserved_cents-$2,spent_cents=spent_cents+$3,updated_at=now() WHERE id=$1",
      [r.id, attempt.reserved_cents, cost],
    );
    await event(
      c,
      r.id,
      "TASK_COMPLETED",
      "Output đúng schema; đã lưu artifact và checksum.",
      task.id,
      attempt.id,
    );
    if (r.spent_cents + cost > r.budget_cents) {
      await c.query(
        "UPDATE runs SET status='FAILED',error_code='BUDGET_EXCEEDED',finished_at=now() WHERE id=$1",
        [r.id],
      );
    } else await finishState(c, r.id);
  });
}
const backoff = (number: number) => Math.min(30000, 250 * 2 ** (number - 1));
async function failAttempt(
  { task, attempt, run }: Claim,
  code: string,
  retryable: boolean,
  charged = 0,
  usage: Record<string, unknown> = {},
  retryAfterMs = 0,
) {
  await transaction(async (c) => {
    const t = (
      await c.query<Task>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [
        task.id,
      ])
    ).rows[0];
    const r = (
      await c.query<Run>("SELECT * FROM runs WHERE id=$1 FOR UPDATE", [run.id])
    ).rows[0];
    if (t.active_attempt_id !== attempt.id || t.status !== "RUNNING") return;
    await c.query(
      "UPDATE attempts SET status=$2,error_code=$3,cost_cents=$4,usage=$5,finished_at=now() WHERE id=$1",
      [
        attempt.id,
        code === "TIMEOUT" ? "TIMED_OUT" : "FAILED",
        code,
        charged,
        usage,
      ],
    );
    await c.query(
      "UPDATE runs SET reserved_cents=reserved_cents-$2,spent_cents=spent_cents+$3,updated_at=now() WHERE id=$1",
      [run.id, attempt.reserved_cents, charged],
    );
    if (r.status === "CANCELED") {
      await c.query(
        "UPDATE tasks SET status='CANCELED',lease_until=NULL WHERE id=$1",
        [task.id],
      );
      return;
    }
    if (retryable && t.attempt_count < t.max_attempts) {
      await c.query(
        "UPDATE tasks SET status='PENDING',lease_until=NULL,active_attempt_id=NULL,error_code=$2,next_attempt_at=now()+($3::integer*interval '1 millisecond') WHERE id=$1",
        [
          task.id,
          code,
          Math.max(backoff(t.attempt_count), Math.min(30000, retryAfterMs)),
        ],
      );
      await event(
        c,
        run.id,
        "RETRY_SCHEDULED",
        safeMessage[code] || "Đang thử lại có giới hạn.",
        task.id,
        attempt.id,
      );
    } else await fatal(c, t, r, code);
  });
}
export async function recoverExpired() {
  const expired = (
    await pool.query<Task>(
      "SELECT * FROM tasks WHERE status='RUNNING' AND lease_until<now()",
    )
  ).rows;
  for (const t of expired) {
    const a = (
      await pool.query<Attempt>("SELECT * FROM attempts WHERE id=$1", [
        t.active_attempt_id,
      ])
    ).rows[0];
    const r = (
      await pool.query<Run>("SELECT * FROM runs WHERE id=$1", [t.run_id])
    ).rows[0];
    if (a && r)
      await failAttempt(
        { task: t, attempt: a, run: r },
        "INTERRUPTED",
        true,
        r.mode === "LIVE" ? a.reserved_cents : 0,
        {
          billing_state:
            r.mode === "LIVE" ? "UNCERTAIN_RESERVED_CHARGED" : "MOCK",
        },
      );
  }
  return expired.length;
}
export async function tick(concurrency = 2) {
  await recoverExpired();
  const claims: Claim[] = [];
  for (let i = 0; i < Math.min(4, concurrency); i++) {
    const c = await claimTask();
    if (c) claims.push(c);
  }
  await Promise.all(claims.map(executeClaim));
  return claims.length;
}
export async function controlRun(
  owner: string,
  id: string,
  action: "pause" | "resume" | "cancel" | "retry",
) {
  return transaction(async (c) => {
    const r = await owned(c, id, owner);
    if (action === "cancel") {
      if (["COMPLETED", "CANCELED"].includes(r.status))
        throw new OrbitError("CONFLICT");
      await c.query(
        "UPDATE runs SET status='CANCELED',finished_at=now(),updated_at=now() WHERE id=$1",
        [id],
      );
      await c.query(
        "UPDATE tasks SET status='CANCELED' WHERE run_id=$1 AND status IN ('PENDING','WAITING_APPROVAL')",
        [id],
      );
      await c.query(
        "UPDATE approvals SET status='REJECTED',actor_id=$2,decided_at=now() WHERE run_id=$1 AND status='PENDING'",
        [id, owner],
      );
      await c.query(
        "UPDATE attempts SET status='CANCELED',finished_at=now() WHERE task_id IN (SELECT id FROM tasks WHERE run_id=$1) AND status='WAITING_APPROVAL'",
        [id],
      );
    } else if (action === "pause") {
      if (!["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(r.status))
        throw new OrbitError("CONFLICT");
      await c.query(
        "UPDATE runs SET status='PAUSED',updated_at=now() WHERE id=$1",
        [id],
      );
    } else if (action === "resume") {
      if (r.status !== "PAUSED") throw new OrbitError("CONFLICT");
      await c.query("UPDATE runs SET status='RUNNING' WHERE id=$1", [id]);
      await finishState(c, id);
    } else {
      if (r.status !== "FAILED") throw new OrbitError("CONFLICT");
      const t = (
        await c.query<Task>(
          "SELECT * FROM tasks WHERE run_id=$1 AND status='FAILED' ORDER BY created_at LIMIT 1",
          [id],
        )
      ).rows[0];
      if (!t || t.attempt_count >= t.max_attempts)
        throw new OrbitError("CONFLICT");
      await c.query(
        "UPDATE tasks SET status='PENDING',error_code=NULL,active_attempt_id=NULL,lease_until=NULL,next_attempt_at=now() WHERE id=$1",
        [t.id],
      );
      await c.query(
        "UPDATE runs SET status='RUNNING',error_code=NULL,finished_at=NULL WHERE id=$1",
        [id],
      );
    }
    await event(c, id, "CONTROL", `Yêu cầu ${action} đã lưu.`);
    return { ok: true };
  });
}
export async function decideApproval(
  owner: string,
  id: string,
  decision: "approve" | "reject",
  expectedHash: string,
) {
  return transaction(async (c) => {
    const a = (
      await c.query(
        "SELECT a.* FROM approvals a JOIN runs r ON r.id=a.run_id WHERE a.id=$1 AND r.owner_id=$2 FOR UPDATE OF a",
        [id, owner],
      )
    ).rows[0];
    if (!a) throw new OrbitError("NOT_FOUND");
    const r = await owned(c, a.run_id, owner);
    if (
      a.status !== "PENDING" ||
      r.status !== "WAITING_APPROVAL" ||
      a.output_hash !== expectedHash
    )
      throw new OrbitError("CONFLICT");
    const task = (
      await c.query<Task>("SELECT * FROM tasks WHERE id=$1", [a.task_id])
    ).rows[0];
    if (decision === "reject") {
      await c.query(
        "UPDATE approvals SET status='REJECTED',actor_id=$2,decided_at=now() WHERE id=$1",
        [id, owner],
      );
      await c.query(
        "UPDATE runs SET status='CANCELED',updated_at=now(),finished_at=now() WHERE id=$1",
        [r.id],
      );
      await c.query(
        "UPDATE tasks SET status='CANCELED' WHERE run_id=$1 AND status<>'COMPLETED'",
        [r.id],
      );
      await c.query(
        "UPDATE attempts SET status='CANCELED',finished_at=now() WHERE id=$1",
        [task.active_attempt_id],
      );
      await event(
        c,
        r.id,
        "REJECTED",
        "Người dùng từ chối. Không xuất báo cáo.",
        task.id,
      );
      return { ok: true };
    }
    const deps = (
      await c.query<Task>(
        "SELECT p.* FROM task_dependencies d JOIN tasks p ON p.id=d.depends_on_id WHERE d.task_id=$1",
        [task.id],
      )
    ).rows;
    const parent = deps[0];
    if (digest(jsonBytes(parent.output)) !== a.output_hash)
      throw new OrbitError("CONFLICT");
    const output = { approved: true, output_hash: a.output_hash, actor: owner };
    getHandler(task.handler).output.parse(output);
    const stored = await blobs.put(jsonBytes(output));
    const sourceArtifact = (
      await c.query("SELECT id FROM artifacts WHERE task_id=$1 AND kind=$2", [
        parent.id,
        "output",
      ])
    ).rows[0];
    await c.query(
      "UPDATE approvals SET status='APPROVED',actor_id=$2,decided_at=now() WHERE id=$1",
      [id, owner],
    );
    await c.query(
      "UPDATE tasks SET status='COMPLETED',output=$2,updated_at=now() WHERE id=$1",
      [task.id, output],
    );
    await c.query(
      "UPDATE attempts SET status='COMPLETED',finished_at=now() WHERE id=$1",
      [task.active_attempt_id],
    );
    await c.query(
      "INSERT INTO artifacts(owner_id,run_id,task_id,attempt_id,name,kind,mode,media_type,size_bytes,sha256,blob_key,source_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        owner,
        r.id,
        task.id,
        task.active_attempt_id,
        "approval.json",
        "output",
        r.mode,
        "application/json",
        stored.size,
        stored.sha256,
        stored.key,
        JSON.stringify(sourceArtifact ? [sourceArtifact.id] : []),
      ],
    );
    await c.query(
      "UPDATE runs SET status='RUNNING',updated_at=now() WHERE id=$1",
      [r.id],
    );
    await event(
      c,
      r.id,
      "APPROVED",
      "Người dùng phê duyệt đúng checksum của bảng việc.",
      task.id,
    );
    return { ok: true };
  });
}
