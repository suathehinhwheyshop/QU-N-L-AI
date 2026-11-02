import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { pool } from "../db/client";
import { OrbitError } from "../core/contracts";
const sign = (body: string) =>
  createHmac("sha256", secret()).update(body).digest("base64url");
function secret() {
  const value = process.env.ORBIT_SESSION_SECRET;
  if (!value || value.length < 32) throw new OrbitError("UNAUTHORIZED");
  return value;
}
function equal(a: string, b: string) {
  const x = createHash("sha256").update(a).digest(),
    y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}
export function issueSession(owner: string) {
  const body = Buffer.from(
    JSON.stringify({ sub: owner, exp: Date.now() + 8 * 3600000 }),
  ).toString("base64url");
  return body + "." + sign(body);
}
export function verifySession(token: string | undefined) {
  try {
    if (!token) return null;
    const [body, sig, ...rest] = token.split(".");
    if (rest.length || !sig || !equal(sign(body), sig)) return null;
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    return typeof data.sub === "string" &&
      /^[0-9a-f-]{36}$/.test(data.sub) &&
      data.exp > Date.now()
      ? data.sub
      : null;
  } catch {
    return null;
  }
}
export async function actor(req: NextRequest) {
  const id = verifySession(req.cookies.get("orbit_session")?.value);
  if (!id) throw new OrbitError("UNAUTHORIZED");
  if (!(await pool.query("SELECT id FROM users WHERE id=$1", [id])).rowCount)
    throw new OrbitError("UNAUTHORIZED");
  return id;
}
export function checkOrigin(req: NextRequest) {
  if (["GET", "HEAD"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  const expected = process.env.ORBIT_BASE_URL;
  if (!expected || origin !== new URL(expected).origin)
    throw new OrbitError("UNAUTHORIZED");
}
const failures = new Map<string, { count: number; until: number }>();
export async function login(password: string) {
  const key = "local-development-account";
  let f = failures.get(key);
  if (f && f.until < Date.now()) {
    failures.delete(key);
    f = undefined;
  }
  if (f && f.count >= 10) throw new OrbitError("UNAUTHORIZED");
  const expected = process.env.ORBIT_ADMIN_PASSWORD;
  if (!expected || expected.length < 16 || !equal(password, expected)) {
    failures.set(key, {
      count: (f?.count || 0) + 1,
      until: Date.now() + 60000,
    });
    throw new OrbitError("UNAUTHORIZED");
  }
  failures.delete(key);
  const owner = (
    await pool.query("SELECT id FROM users WHERE email=$1", [
      "owner@orbit.local",
    ])
  ).rows[0];
  if (!owner) throw new OrbitError("UNAUTHORIZED");
  return owner.id as string;
}
