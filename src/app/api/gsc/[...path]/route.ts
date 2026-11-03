import { sessionCookieName, gscCookieName } from "@/server/cookie-names";
import { observed } from "@/server/observability";
import { authorizeGsc } from "@/server/request-security";
import { tokenHash } from "@orbit/database/security";
import { getGscClient } from "@orbit/integrations/gsc-runtime";
import "@/server/runtime";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, checkOrigin } from "@/server/auth";
import { OrbitError, safeMessage } from "@orbit/shared/contracts";
import { SearchRequest } from "@orbit/shared/seo";
import { GscOAuth } from "@orbit/integrations/gsc-oauth";
import { GscClient } from "@orbit/integrations/gsc-client";
import {
  datasets,
  loadDataset,
  importDataset,
  beginSync,
  syncJobs,
} from "@orbit/integrations/seo-data";
import { computeFacts } from "@orbit/workspaces/seo-insights";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
async function bounded(req: NextRequest, max: number) {
  if (Number(req.headers.get("content-length") ?? 0) > max)
    throw new OrbitError("BAD_REQUEST");
  const reader = req.body?.getReader();
  if (!reader) throw new OrbitError("BAD_REQUEST");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const x = await reader.read();
    if (x.done) break;
    size += x.value.length;
    if (size > max) {
      await reader.cancel();
      throw new OrbitError("BAD_REQUEST");
    }
    chunks.push(x.value);
  }
  return Buffer.concat(chunks);
}
async function endpoint(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const path = (await params).path;
  const p = path.join("/");
  const client = getGscClient();
  const oauth = client.oauth;
  try {
    checkOrigin(req);
    if (p === "oauth/callback" && req.method === "GET") {
      const state = req.nextUrl.searchParams.get("state") ?? "",
        code = req.nextUrl.searchParams.get("code") ?? "",
        browser = req.cookies.get(gscCookieName())?.value ?? "";
      await oauth.callback(state, browser, code, req.signal);
      const response = NextResponse.redirect(
        new URL("/?gsc=authorized#seo", process.env.ORBIT_BASE_URL!),
        303,
      );
      response.cookies.set(gscCookieName(), "", {
        path: "/api/gsc/oauth/callback",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.ORBIT_COOKIE_SECURE === "true",
        maxAge: 0,
      });
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    }
    const owner = await actor(req);
    await authorizeGsc(owner, req, p);
    if (p === "status" && req.method === "GET")
      return json(await oauth.status(owner));
    if (p === "oauth/start" && req.method === "POST") {
      const result = await oauth.begin(
        owner,
        tokenHash(req.cookies.get(sessionCookieName())!.value),
      );
      const response = json({ url: result.url });
      response.cookies.set(gscCookieName(), result.browser, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.ORBIT_COOKIE_SECURE === "true",
        path: "/api/gsc/oauth/callback",
        maxAge: 600,
      });
      return response;
    }
    if (p === "refresh" && req.method === "POST") {
      await oauth.access(owner, req.signal, true);
      return json(await oauth.status(owner));
    }
    if (p === "revoke" && req.method === "POST")
      return json(await oauth.revoke(owner, req.signal));
    if (p === "properties" && req.method === "POST")
      return json(await client.discover(owner, req.signal));
    if (p === "template" && req.method === "GET")
      return new NextResponse(
        "period,page,query,clicks,impressions,position\r\n",
        {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": 'attachment; filename="gsc-template.csv"',
            "Cache-Control": "no-store",
          },
        },
      );
    if (p === "datasets" && req.method === "GET")
      return json(await datasets(owner));
    if (p === "jobs" && req.method === "GET")
      return json(await syncJobs(owner));
    if (p === "sync" && req.method === "POST") {
      const raw = JSON.parse((await bounded(req, 20000)).toString());
      const body = z
        .object({ request_key: z.uuid(), spec: SearchRequest })
        .strict()
        .parse(raw);
      return json(await beginSync(owner, body.request_key, body.spec), 202);
    }
    if (p === "import" && req.method === "POST") {
      const bytes = await bounded(req, 5_100_000);
      const form = await new Response(bytes, {
        headers: { "content-type": req.headers.get("content-type") ?? "" },
      }).formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new OrbitError("BAD_REQUEST");
      const format = z
        .enum(["csv", "json"])
        .parse(file.name.split(".").at(-1)?.toLowerCase());
      const spec = SearchRequest.parse(JSON.parse(String(form.get("spec"))));
      const key = z.uuid().parse(form.get("request_key"));
      return json(
        await importDataset(
          owner,
          key,
          spec,
          file.name,
          Buffer.from(await file.arrayBuffer()),
          format,
        ),
        201,
      );
    }
    if (path[0] === "datasets" && path.length === 2 && req.method === "GET") {
      const id = z.uuid().parse(path[1]);
      const { row, data } = await loadDataset(owner, id);
      return json({
        id,
        sha256: row.sha256,
        spec: data.spec,
        provenance: data.provenance,
        facts: computeFacts(data, row.sha256),
      });
    }
    throw new OrbitError("NOT_FOUND");
  } catch (e) {
    const code =
      e instanceof OrbitError
        ? e.code
        : e instanceof Error && safeMessage[e.message]
          ? e.message
          : e instanceof z.ZodError || e instanceof SyntaxError
            ? "GSC_INVALID_DATA"
            : "INTERNAL_ERROR";
    if (p === "oauth/callback") {
      const response = NextResponse.redirect(
        new URL(
          "/?gsc=" + encodeURIComponent(code) + "#seo",
          process.env.ORBIT_BASE_URL ?? req.url,
        ),
        303,
      );
      response.cookies.set(gscCookieName(), "", {
        path: "/api/gsc/oauth/callback",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.ORBIT_COOKIE_SECURE === "true",
        maxAge: 0,
      });
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    }
    return json(
      {
        code,
        message:
          safeMessage[code] ??
          "Không hoàn tất thao tác GSC. Thông tin bí mật không được trả về.",
      },
      code === "FORBIDDEN"
        ? 403
        : code === "RATE_LIMIT"
          ? 429
          : code === "UNAUTHORIZED"
            ? 401
            : code === "NOT_FOUND"
              ? 404
              : code === "INTERNAL_ERROR"
                ? 500
                : 409,
    );
  }
}
export const GET = observed(endpoint),
  POST = observed(endpoint);
