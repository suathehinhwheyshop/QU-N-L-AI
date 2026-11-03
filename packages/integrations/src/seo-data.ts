import { getGscClient } from "./gsc-runtime";
import { z } from "zod";
import {
  Dataset,
  SearchRequest,
  SearchRow,
  assertRows,
  type SeoDataset,
  type SearchSpec,
  type Row,
} from "@orbit/shared/seo";
import { OrbitError, GoalInput, type Plan } from "@orbit/shared/contracts";
import { digest, jsonBytes, LocalArtifactStore } from "@orbit/storage/store";
import type { HandlerContext } from "@orbit/core/registry";
import { GscClient } from "./gsc-client";
const db = async () => (await import("@orbit/database/client")).pool;
const store = () => new LocalArtifactStore();
export const commonWarnings = [
  "GSC chỉ trả các dòng hàng đầu, có thể ẩn truy vấn ẩn danh; tổng của các dòng không phải tổng toàn property.",
  "Ngày GSC theo America/Los_Angeles; final data không bảo đảm bao phủ mọi truy vấn.",
];
function canonical(data: SeoDataset) {
  assertRows(data.spec, data.current, data.previous);
  for (const rows of [data.current, data.previous])
    rows.sort(
      (a, b) => a.page.localeCompare(b.page) || a.query.localeCompare(b.query),
    );
  return data;
}
async function saveDataset(
  owner: string,
  key: string,
  requestHash: string,
  name: string,
  data: SeoDataset,
  raw?: Buffer,
  jobId?: string,
) {
  data = canonical(Dataset.parse(data));
  const bytes = jsonBytes(data);
  if (bytes.length > 20_000_000) throw new OrbitError("GSC_INVALID_DATA");
  const blob = await store().put(bytes),
    source = raw ? await store().put(raw) : null;
  const pool = await db();
  const row =
    (
      await pool.query(
        "INSERT INTO seo_datasets(owner_id,request_key,request_hash,job_id,name,kind,spec,sha256,blob_key,raw_sha256,raw_blob_key,row_count,previous_row_count,warnings) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(owner_id,request_key) DO NOTHING RETURNING *",
        [
          owner,
          key,
          requestHash,
          jobId ?? null,
          name.slice(0, 160),
          data.provenance.kind,
          data.spec,
          blob.sha256,
          blob.key,
          source?.sha256 ?? null,
          source?.key ?? null,
          data.current.length,
          data.previous.length,
          JSON.stringify(data.provenance.warnings),
        ],
      )
    ).rows[0] ??
    (
      await pool.query(
        "SELECT * FROM seo_datasets WHERE owner_id=$1 AND request_key=$2",
        [owner, key],
      )
    ).rows[0];
  if (row.request_hash !== requestHash) throw new OrbitError("CONFLICT");
  return publicDataset(row);
}
function publicDataset(row: Record<string, unknown>) {
  const { blob_key, raw_blob_key, request_hash, ...dto } = row;
  void blob_key;
  void raw_blob_key;
  void request_hash;
  return dto;
}
export async function datasets(owner: string) {
  return (
    await (
      await db()
    ).query(
      "SELECT * FROM seo_datasets WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100",
      [owner],
    )
  ).rows.map(publicDataset);
}
export async function loadDataset(owner: string, id: string) {
  const row = (
    await (
      await db()
    ).query("SELECT * FROM seo_datasets WHERE id=$1 AND owner_id=$2", [
      id,
      owner,
    ])
  ).rows[0];
  if (!row) throw new OrbitError("NOT_FOUND");
  const bytes = await store().read(row.blob_key, row.sha256);
  const data = canonical(Dataset.parse(JSON.parse(bytes.toString())));
  if (digest(jsonBytes(data)) !== row.sha256)
    throw new OrbitError("GSC_SOURCE_MISMATCH");
  return { row, data };
}
export function parseCsv(text: string) {
  const records: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false,
    closed = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += ch;
      continue;
    }
    if (ch === '"') {
      if (value || closed) throw new OrbitError("GSC_INVALID_DATA");
      quoted = true;
      continue;
    }
    if (ch === "," || ch === "\n" || ch === "\r") {
      row.push(value);
      value = "";
      closed = false;
      if (ch !== ",") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        if (row.some((x) => x.length)) records.push(row);
        row = [];
      }
      continue;
    }
    if (closed) throw new OrbitError("GSC_INVALID_DATA");
    value += ch;
  }
  if (quoted) throw new OrbitError("GSC_INVALID_DATA");
  if (value || row.length) {
    row.push(value);
    records.push(row);
  }
  const header = records.shift()?.map((h) => h.trim().toLowerCase());
  const required = [
    "period",
    "page",
    "query",
    "clicks",
    "impressions",
    "position",
  ];
  if (
    !header ||
    header.length !== required.length ||
    new Set(header).size !== required.length ||
    required.some((h) => !header.includes(h))
  )
    throw new OrbitError("GSC_INVALID_DATA");
  const result: { current: Row[]; previous: Row[] } = {
    current: [],
    previous: [],
  };
  for (const r of records) {
    if (r.length !== header.length) throw new OrbitError("GSC_INVALID_DATA");
    const o = Object.fromEntries(header.map((h, i) => [h, r[i]]));
    if (o.period !== "current" && o.period !== "previous")
      throw new OrbitError("GSC_INVALID_DATA");
    if (["clicks", "impressions", "position"].some((k) => !o[k].trim()))
      throw new OrbitError("GSC_INVALID_DATA");
    result[o.period].push(
      SearchRow.parse({
        page: o.page,
        query: o.query,
        clicks: Number(o.clicks),
        impressions: Number(o.impressions),
        position: Number(o.position),
      }),
    );
  }
  return result;
}
export async function importDataset(
  owner: string,
  requestKey: string,
  spec: SearchSpec,
  name: string,
  bytes: Buffer,
  format: "csv" | "json",
) {
  if (!bytes.length || bytes.length > 5_000_000)
    throw new OrbitError("GSC_INVALID_DATA");
  spec = SearchRequest.parse(spec);
  const requestHash = digest(
    jsonBytes({ spec, raw_sha256: digest(bytes), format }),
  );
  const existing = (
    await (
      await db()
    ).query("SELECT * FROM seo_datasets WHERE owner_id=$1 AND request_key=$2", [
      owner,
      requestKey,
    ])
  ).rows[0];
  if (existing) {
    if (existing.request_hash !== requestHash) throw new OrbitError("CONFLICT");
    return publicDataset(existing);
  }
  const parsed =
    format === "csv"
      ? parseCsv(bytes.toString("utf8"))
      : z
          .object({
            current: z.array(SearchRow).max(50000),
            previous: z.array(SearchRow).max(50000).default([]),
          })
          .strict()
          .parse(JSON.parse(bytes.toString("utf8")));
  return saveDataset(
    owner,
    requestKey,
    requestHash,
    name,
    {
      version: 1,
      spec,
      ...parsed,
      provenance: {
        kind: "IMPORT",
        captured_at: new Date().toISOString(),
        source_hashes: [digest(bytes)],
        warnings: [
          ...commonWarnings,
          "USER_SUPPLIED: file import chưa được xác minh là bản xuất GSC đầy đủ hoặc chính xác.",
        ],
        permission: "read-only",
        timezone: "America/Los_Angeles",
      },
    },
    bytes,
  );
}
type Checkpoint = {
  period: "current" | "previous" | "done";
  start: number;
  count: number;
  pages: { period: "current" | "previous"; key: string; sha256: string }[];
  warnings: string[];
  kind: "GSC_API" | "HTTP_STUB";
};
export async function beginSync(
  owner: string,
  requestKey: string,
  spec: SearchSpec,
  client = getGscClient(),
) {
  spec = SearchRequest.parse(spec);
  const status = await client.oauth.status(owner);
  if (
    !["CONNECTED", "HTTP_STUB"].includes(status.status) ||
    status.kind !== client.oauth.transport.kind ||
    !status.properties.some(
      (p: { siteUrl: string }) => p.siteUrl === spec.property,
    )
  )
    throw new OrbitError("GSC_FORBIDDEN");
  const pool = await db();
  await pool.query(
    "INSERT INTO gsc_jobs(owner_id,request_key,spec) VALUES($1,$2,$3) ON CONFLICT(owner_id,request_key) DO NOTHING",
    [owner, requestKey, spec],
  );
  const job = (
    await pool.query(
      "SELECT * FROM gsc_jobs WHERE owner_id=$1 AND request_key=$2",
      [owner, requestKey],
    )
  ).rows[0];
  if (digest(jsonBytes(job.spec)) !== digest(jsonBytes(spec)))
    throw new OrbitError("CONFLICT");
  const workspace = (
    await pool.query(
      "SELECT id FROM workspaces WHERE owner_id=$1 AND kind='seo'",
      [owner],
    )
  ).rows[0];
  if (!workspace) throw new OrbitError("NOT_FOUND");
  const goal = GoalInput.parse({
    goal: "Đọc snapshot GSC read-only: " + spec.property,
    workspace_id: workspace.id,
    request_key: requestKey,
  });
  const { planGoal } = await import("@orbit/core/planner");
  const { NodeSchema } = await import("@orbit/shared/contracts");
  const plan: Plan = {
    ...planGoal(goal, "seo"),
    template: "gsc-ingestion-v1",
    nodes: [
      NodeSchema.parse({
        key: "collect",
        title: "GSC read-only → dataset có checksum",
        kind: "tool",
        handler: "gsc.collect",
        capability: "read",
        depends_on: [],
        acceptance:
          "Nguồn có provenance riêng, pagination checkpoint và checksum; không gọi AI.",
        timeout_ms: 120000,
        input: { job_id: job.id },
      }),
    ],
  };
  const run = await (
    await import("@orbit/core/engine")
  ).createFromPlan(owner, goal, plan);
  await pool.query(
    "UPDATE gsc_jobs SET run_id=$2 WHERE id=$1 AND (run_id IS NULL OR run_id=$2)",
    [job.id, run.id],
  );
  return {
    job_id: job.id,
    run_id: run.id,
    source_kind: client.oauth.transport.kind,
    ai_execution: "NONE",
  };
}
export async function syncJobs(owner: string) {
  return (
    await (
      await db()
    ).query(
      "SELECT j.id,j.run_id,j.spec,j.dataset_id,j.created_at,r.status,r.error_code FROM gsc_jobs j LEFT JOIN runs r ON r.id=j.run_id WHERE j.owner_id=$1 ORDER BY j.created_at DESC LIMIT 30",
      [owner],
    )
  ).rows;
}
export async function collectDataset(
  ctx: HandlerContext,
  client = getGscClient(),
) {
  const { ownerId, runId, taskId, attemptId } = ctx.execution;
  const pool = await db();
  let job = (
    await pool.query("SELECT * FROM gsc_jobs WHERE id=$1 AND owner_id=$2", [
      ctx.input.job_id,
      ownerId,
    ])
  ).rows[0];
  if (!job) throw new OrbitError("NOT_FOUND");
  if (job.run_id && job.run_id !== runId) throw new OrbitError("CONFLICT");
  await pool.query(
    "UPDATE gsc_jobs SET run_id=$2 WHERE id=$1 AND run_id IS NULL",
    [job.id, runId],
  );
  if (job.dataset_id) {
    const { row } = await loadDataset(ownerId, job.dataset_id);
    return { dataset_id: row.id, sha256: row.sha256, kind: row.kind };
  }
  const spec = SearchRequest.parse(job.spec);
  let cp: Checkpoint = Object.keys(job.checkpoint).length
    ? job.checkpoint
    : {
        period: "current",
        start: 0,
        count: 0,
        pages: [],
        warnings: [...commonWarnings],
        kind: client.oauth.transport.kind,
      };
  if (cp.kind !== client.oauth.transport.kind)
    throw new OrbitError("GSC_SOURCE_MISMATCH");
  async function fenced<T>(fn: (c: import("pg").PoolClient) => Promise<T>) {
    ctx.signal.throwIfAborted();
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(7493121)");
      const task = (
        await c.query(
          "SELECT t.active_attempt_id,t.status,r.status AS run_status FROM tasks t JOIN runs r ON r.id=t.run_id WHERE t.id=$1 FOR UPDATE OF t",
          [taskId],
        )
      ).rows[0];
      if (
        task?.active_attempt_id !== attemptId ||
        task.status !== "RUNNING" ||
        task.run_status === "CANCELED"
      )
        throw new OrbitError("CONFLICT");
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  while (cp.period !== "done") {
    ctx.signal.throwIfAborted();
    const period = cp.period;
    const rows = await client.page(ownerId, spec, period, cp.start, ctx.signal);
    const envelope = {
      spec,
      period,
      start_row: cp.start,
      rows,
      kind: cp.kind,
      captured_at: new Date().toISOString(),
    };
    const blob = await store().put(jsonBytes(envelope));
    const next: Checkpoint = {
      ...cp,
      pages: [...cp.pages, { period, key: blob.key, sha256: blob.sha256 }],
      start: cp.start + rows.length,
      count: cp.count + rows.length,
    };
    if (rows.length < client.pageSize || next.start >= client.maxRows) {
      if (next.start >= client.maxRows)
        next.warnings = [
          ...next.warnings,
          `ROW_CAP: ${period} dừng tại ${client.maxRows} dòng; dataset có thể không đầy đủ.`,
        ];
      next.period = period === "current" && spec.previous ? "previous" : "done";
      next.start = 0;
    }
    if (next.pages.length > 202) throw new OrbitError("GSC_INVALID_DATA");
    await fenced(async (c) => {
      await c.query("UPDATE gsc_jobs SET checkpoint=$2 WHERE id=$1", [
        job.id,
        next,
      ]);
    });
    cp = next;
  }
  const current: Row[] = [],
    previous: Row[] = [];
  for (const p of cp.pages) {
    const raw = JSON.parse((await store().read(p.key, p.sha256)).toString());
    (p.period === "current" ? current : previous).push(
      ...z.array(SearchRow).parse(raw.rows),
    );
  }
  const data: SeoDataset = {
    version: 1,
    spec,
    current,
    previous,
    provenance: {
      kind: cp.kind,
      captured_at: new Date().toISOString(),
      source_hashes: cp.pages.map((p) => p.sha256),
      warnings: [...new Set(cp.warnings)],
      permission: "read-only",
      timezone: "America/Los_Angeles",
    },
  };
  // Finalization holds the engine task fence. Reads may repeat after a crash;
  // dataset key/unique constraints return the same immutable dataset.
  return fenced(async (c) => {
    const dto = await saveDataset(
      ownerId,
      job.request_key,
      digest(jsonBytes({ spec, job: job.id })),
      spec.property,
      data,
      undefined,
      job.id,
    );
    await c.query("UPDATE gsc_jobs SET dataset_id=$2 WHERE id=$1", [
      job.id,
      dto.id,
    ]);
    return {
      dataset_id: String(dto.id),
      sha256: String(dto.sha256),
      kind: String(dto.kind),
    };
  });
}
