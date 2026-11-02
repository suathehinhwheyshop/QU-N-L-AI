import "@/server/runtime";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { db, pool } from "@/db/client";
import {
  workspaces,
  runs,
  connections,
  settings,
  artifacts,
  providerConfigs,
} from "@/db/schema";
import { GoalInput, OrbitError, safeMessage } from "@/core/contracts";
import {
  createWorkflow,
  previewGoal,
  controlRun,
  decideApproval,
  blobs,
} from "@/core/engine";
import { actor, checkOrigin, login, issueSession } from "@/server/auth";
import { providers } from "@/providers/registry";
import { integrations } from "@/integrations/registry";
import { basename } from "node:path";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
async function body(req: NextRequest) {
  if (Number(req.headers.get("content-length") || 0) > 100000)
    throw new OrbitError("BAD_REQUEST");
  return JSON.parse((await req.text()).slice(0, 100001));
}
const uuid = (s: string) => z.uuid().parse(s);
async function endpoint(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await params,
      p = path.join("/");
    checkOrigin(req);
    if (p === "auth/login" && req.method === "POST") {
      const nativeForm = !req.headers
        .get("content-type")
        ?.includes("application/json");
      const input = nativeForm
        ? Object.fromEntries(await req.formData())
        : await body(req);
      const data = z.object({ password: z.string().max(512) }).parse(input);
      const owner = await login(data.password);
      const response = nativeForm
        ? NextResponse.redirect(new URL("/", req.url), 303)
        : json({ ok: true });
      response.cookies.set("orbit_session", issueSession(owner), {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.ORBIT_COOKIE_SECURE === "true",
        path: "/",
        maxAge: 8 * 3600,
      });
      return response;
    }
    const owner = await actor(req);
    if (p === "auth/logout" && req.method === "POST") {
      const res = json({ ok: true });
      res.cookies.delete("orbit_session");
      return res;
    }
    if (p === "bootstrap" && req.method === "GET") {
      const ws = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.owner_id, owner));
      const recent = await db
        .select()
        .from(runs)
        .where(eq(runs.owner_id, owner))
        .orderBy(desc(runs.created_at))
        .limit(50);
      const config = await db
        .select()
        .from(providerConfigs)
        .where(eq(providerConfigs.owner_id, owner));
      const con = (await db.select().from(connections))
        .filter((c) => c.metadata.archived !== true)
        .map((c) => {
          const setting = config.find((p) => p.provider_id === c.id);
          return {
            ...c,
            metadata: {
              ...c.metadata,
              ...(setting
                ? { enabled: setting.enabled, selected_model: setting.model }
                : {}),
            },
          };
        });
      const [setting] = await db
        .select()
        .from(settings)
        .where(eq(settings.owner_id, owner));
      const stats = (
        await pool.query(
          "SELECT count(*) FILTER (WHERE t.status='COMPLETED')::int AS completed_tasks, count(*) FILTER (WHERE t.status='WAITING_APPROVAL')::int AS waiting_approvals FROM tasks t JOIN runs r ON r.id=t.run_id WHERE r.owner_id=$1",
          [owner],
        )
      ).rows[0];
      const activity = (
        await pool.query(
          "SELECT e.* FROM events e JOIN runs r ON r.id=e.run_id WHERE r.owner_id=$1 ORDER BY e.created_at DESC LIMIT 8",
          [owner],
        )
      ).rows;
      return json({
        workspaces: ws,
        runs: recent,
        connections: con,
        settings: setting,
        stats,
        activity,
        mode: "FOUNDATION",
        permissions: { read: true, report: true, website_write: false },
        storage: "PostgreSQL + local artifacts",
      });
    }
    if (p === "plans" && req.method === "POST")
      return json(await previewGoal(owner, GoalInput.parse(await body(req))));
    if (p === "runs" && req.method === "POST")
      return json(
        await createWorkflow(owner, GoalInput.parse(await body(req))),
        201,
      );
    if (path[0] === "runs" && path.length >= 2) {
      const id = uuid(path[1]);
      const [run] = await db
        .select()
        .from(runs)
        .where(and(eq(runs.id, id), eq(runs.owner_id, owner)));
      if (!run) throw new OrbitError("NOT_FOUND");
      if (path.length === 2 && req.method === "GET") {
        const tasks = (
          await pool.query(
            "SELECT * FROM tasks WHERE run_id=$1 ORDER BY created_at,key",
            [id],
          )
        ).rows;
        const dependencies = (
          await pool.query(
            "SELECT d.* FROM task_dependencies d JOIN tasks t ON t.id=d.task_id WHERE t.run_id=$1",
            [id],
          )
        ).rows;
        const attempts = (
          await pool.query(
            "SELECT a.* FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE t.run_id=$1 ORDER BY a.started_at",
            [id],
          )
        ).rows;
        const approvals = (
          await pool.query("SELECT * FROM approvals WHERE run_id=$1", [id])
        ).rows;
        const logs = (
          await pool.query(
            "SELECT * FROM events WHERE run_id=$1 ORDER BY created_at,id",
            [id],
          )
        ).rows;
        const files = await db
          .select({
            id: artifacts.id,
            name: artifacts.name,
            kind: artifacts.kind,
            version: artifacts.version,
            sha256: artifacts.sha256,
            size_bytes: artifacts.size_bytes,
            created_at: artifacts.created_at,
            mode: artifacts.mode,
            task_id: artifacts.task_id,
            source_ids: artifacts.source_ids,
          })
          .from(artifacts)
          .where(eq(artifacts.run_id, id));
        return json({
          run,
          tasks,
          dependencies,
          attempts,
          approvals,
          logs,
          artifacts: files,
        });
      }
      if (path.length === 3 && req.method === "POST") {
        const action = z
          .enum(["pause", "resume", "cancel", "retry"])
          .parse(path[2]);
        return json(await controlRun(owner, id, action));
      }
    }
    if (path[0] === "approvals" && path.length === 2 && req.method === "POST") {
      const data = z
        .object({
          decision: z.enum(["approve", "reject"]),
          output_hash: z.string().length(64),
        })
        .strict()
        .parse(await body(req));
      return json(
        await decideApproval(
          owner,
          uuid(path[1]),
          data.decision,
          data.output_hash,
        ),
      );
    }
    if (p === "connections" && req.method === "GET")
      return json(
        (await db.select().from(connections)).filter(
          (c) => c.metadata.archived !== true,
        ),
      );
    if (
      path[0] === "connections" &&
      path.length === 3 &&
      path[2] === "test" &&
      req.method === "POST"
    ) {
      const provider =
        providers.find((a) => a.descriptor.id === path[1]) ??
        integrations.find((a) => a.id === path[1]);
      if (!provider)
        return json(
          {
            code: "NOT_IMPLEMENTED",
            message:
              "Adapter API thật chưa được triển khai. Không thể đánh dấu Connected.",
          },
          409,
        );
      const health = await provider.health();
      await db
        .update(connections)
        .set({
          status: health.status,
          health_code: health.code,
          checked_at: new Date().toISOString(),
        })
        .where(eq(connections.id, path[1]));
      return json(health);
    }
    if (
      path[0] === "connections" &&
      path.length === 3 &&
      path[2] === "config" &&
      req.method === "PATCH"
    ) {
      const adapter = providers.find((p) => p.descriptor.id === path[1]);
      if (!adapter) throw new OrbitError("LIVE_UNAVAILABLE");
      const data = z
        .object({ enabled: z.boolean(), model: z.string().min(1).max(150) })
        .strict()
        .parse(await body(req));
      if (!adapter.descriptor.models?.includes(data.model))
        throw new OrbitError("BAD_REQUEST");
      const [saved] = await db
        .insert(providerConfigs)
        .values({
          owner_id: owner,
          provider_id: adapter.descriptor.id,
          ...data,
        })
        .onConflictDoUpdate({
          target: [providerConfigs.owner_id, providerConfigs.provider_id],
          set: { ...data, updated_at: new Date().toISOString() },
        })
        .returning();
      return json(saved);
    }
    if (p === "settings" && req.method === "PATCH") {
      const data = z
        .object({
          max_budget_cents: z.number().int().min(0).max(100000),
          concurrency: z.number().int().min(1).max(4),
          data_policy: z.literal("local-only"),
        })
        .strict()
        .parse(await body(req));
      const [saved] = await db
        .update(settings)
        .set({ ...data, updated_at: new Date().toISOString() })
        .where(eq(settings.owner_id, owner))
        .returning();
      return json(saved);
    }
    if (p === "artifacts" && req.method === "GET")
      return json(
        await db
          .select({
            id: artifacts.id,
            run_id: artifacts.run_id,
            name: artifacts.name,
            kind: artifacts.kind,
            version: artifacts.version,
            mode: artifacts.mode,
            sha256: artifacts.sha256,
            media_type: artifacts.media_type,
            size_bytes: artifacts.size_bytes,
            source_ids: artifacts.source_ids,
            created_at: artifacts.created_at,
          })
          .from(artifacts)
          .where(eq(artifacts.owner_id, owner))
          .orderBy(desc(artifacts.created_at))
          .limit(100),
      );
    if (p === "uploads" && req.method === "POST") {
      if (Number(req.headers.get("content-length") || 0) > 2100000)
        throw new OrbitError("BAD_REQUEST");
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size > 2000000 || !file.size)
        throw new OrbitError("BAD_REQUEST");
      const ext = file.name.split(".").at(-1)?.toLowerCase();
      if (!["json", "csv", "txt"].includes(ext || ""))
        throw new OrbitError("BAD_REQUEST");
      const bytes = Buffer.from(await file.arrayBuffer());
      const stored = await blobs.put(bytes);
      const [a] = await db
        .insert(artifacts)
        .values({
          owner_id: owner,
          name: basename(file.name).slice(0, 150),
          kind: "upload",
          mode: "MOCK",
          media_type: "text/plain",
          size_bytes: bytes.length,
          sha256: stored.sha256,
          blob_key: stored.key,
          source_ids: [],
        })
        .returning({ id: artifacts.id, name: artifacts.name });
      return json(a, 201);
    }
    if (path[0] === "artifacts" && path.length === 2 && req.method === "GET") {
      const [a] = await db
        .select()
        .from(artifacts)
        .where(
          and(eq(artifacts.id, uuid(path[1])), eq(artifacts.owner_id, owner)),
        );
      if (!a) throw new OrbitError("NOT_FOUND");
      const bytes = await blobs.read(a.blob_key, a.sha256);
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": a.media_type,
          "Content-Disposition": `attachment; filename="orbit-${a.id}.${a.kind === "upload" ? "txt" : "json"}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    throw new OrbitError("NOT_FOUND");
  } catch (e) {
    const code =
      e instanceof OrbitError
        ? e.code
        : e instanceof z.ZodError || e instanceof SyntaxError
          ? "BAD_REQUEST"
          : "INTERNAL_ERROR";
    return json(
      {
        code,
        message:
          safeMessage[code] ||
          "Không xử lý được yêu cầu. Không có thông tin bí mật trong phản hồi.",
      },
      code === "UNAUTHORIZED"
        ? 401
        : code === "NOT_FOUND"
          ? 404
          : code === "INTERNAL_ERROR"
            ? 500
            : 409,
    );
  }
}
export const GET = endpoint,
  POST = endpoint,
  PATCH = endpoint;
