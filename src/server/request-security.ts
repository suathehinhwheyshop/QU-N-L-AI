import type { NextRequest } from "next/server";
import {
  assertRole,
  assertWorkspace,
  assertSeoWorkspace,
} from "@orbit/database/security";
import { pool } from "@/db/client";
import { OrbitError } from "@orbit/shared/contracts";
export async function authorizeRequest(
  owner: string,
  req: NextRequest,
  path: string[],
) {
  const p = path.join("/");
  if (["GET", "HEAD"].includes(req.method)) {
    await assertRole(owner, "read");
    return;
  }
  if (p === "auth/logout") return;
  if (
    p.startsWith("connections/") ||
    p === "settings" ||
    p.startsWith("admin/")
  ) {
    await assertRole(owner, "manage");
    return;
  }
  if (p === "plans" || p === "runs") {
    await assertRole(owner, "execute");
    return;
  }
  if (path[0] === "approvals") {
    const row = (
      await pool.query(
        "SELECT r.workspace_id FROM approvals a JOIN runs r ON r.id=a.run_id WHERE a.id=$1 AND r.owner_id=$2",
        [path[1], owner],
      )
    ).rows[0];
    if (!row) throw new OrbitError("NOT_FOUND");
    await assertWorkspace(owner, row.workspace_id, "approve");
    return;
  }
  await assertRole(owner, "execute");
}
export async function authorizeGsc(owner: string, req: NextRequest, p: string) {
  await assertSeoWorkspace(
    owner,
    req.method === "GET"
      ? "read"
      : ["import", "sync"].includes(p)
        ? "execute"
        : "manage",
  );
}
export function clientIdentity(req: NextRequest) {
  return process.env.ORBIT_TRUST_PROXY === "true"
    ? (req.headers.get("x-orbit-client-ip") ?? "unknown-proxy").slice(0, 80)
    : "direct";
}
