import { sessionCookieName } from "./cookie-names";
import { assertLocalOwner } from "./local-mode";
import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { pool } from "../db/client";
import { OrbitError } from "../core/contracts";
import {
  tokenHash,
  passwordMatches,
  hashPassword,
  rateLimit,
  securityEvent,
} from "@orbit/database/security";
import { validateServerConfig } from "@orbit/shared/server-env";
export const SESSION_MAX_AGE = 8 * 3600;
let dummy: Promise<string> | undefined;
export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.ORBIT_COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}
export function checkOrigin(req: NextRequest) {
  validateServerConfig();
  if (["GET", "HEAD"].includes(req.method)) return;
  const expected = process.env.ORBIT_BASE_URL;
  if (
    !expected ||
    req.headers.get("origin") !== new URL(expected).origin ||
    req.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new OrbitError("UNAUTHORIZED");
}
export async function issueSession(user: string) {
  const token = randomBytes(32).toString("base64url");
  const row = (
    await pool.query("SELECT auth_version,is_active FROM users WHERE id=$1", [
      user,
    ])
  ).rows[0];
  if (!row?.is_active) throw new OrbitError("UNAUTHORIZED");
  await pool.query(
    "INSERT INTO auth_sessions(token_hash,user_id,auth_version,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
    [tokenHash(token), user, row.auth_version],
  );
  return token;
}
export async function session(token: string | undefined) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return (
    (
      await pool.query(
        "UPDATE auth_sessions s SET last_seen=now() FROM users u WHERE s.token_hash=$1 AND u.id=s.user_id AND u.is_active=true AND u.auth_version=s.auth_version AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen>now()-interval '30 minutes' RETURNING s.user_id,s.token_hash,u.role,u.email,u.name",
        [tokenHash(token)],
      )
    ).rows[0] ?? null
  );
}
export async function revokeSession(token: string | undefined) {
  if (token)
    await pool.query(
      "UPDATE auth_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL",
      [tokenHash(token)],
    );
}
export async function actor(req: NextRequest) {
  validateServerConfig();
  const user = await session(req.cookies.get(sessionCookieName())?.value);
  if (!user) throw new OrbitError("UNAUTHORIZED");
  await assertLocalOwner(user.user_id);
  await rateLimit("api:" + user.user_id, 900, 60);
  return user.user_id as string;
}
export async function login(
  email: string,
  password: string,
  client = "direct",
) {
  const normalized = email.trim().toLowerCase();
  await rateLimit("login-client:" + client, 60, 60);
  await rateLimit("login-account:" + normalized, 10, 600);
  const row = (
    await pool.query(
      "SELECT id,password_hash,is_active FROM users WHERE lower(email)=$1",
      [normalized],
    )
  ).rows[0];
  dummy ??= hashPassword(randomBytes(32).toString("hex"));
  const hash = row?.password_hash ?? (await dummy);
  if (
    !(await passwordMatches(password, hash)) ||
    !row?.password_hash ||
    !row.is_active
  ) {
    await securityEvent(null, "LOGIN", "DENIED");
    throw new OrbitError("UNAUTHORIZED");
  }
  await assertLocalOwner(row.id);
  await securityEvent(row.id, "LOGIN", "SUCCESS");
  return row.id as string;
}
