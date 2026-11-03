import { OrbitError } from "@orbit/shared/contracts";
import {
  createHash,
  randomBytes,
  scrypt as derive,
  timingSafeEqual,
} from "node:crypto";
const db = async () => (await import("./client")).pool;
export const tokenHash = (v: string) =>
  createHash("sha256").update(v).digest("hex");
const scrypt = (p: string, s: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    derive(
      p,
      s,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (e, k) => (e ? reject(e) : resolve(k)),
    ),
  );
export async function hashPassword(password: string) {
  if (password.length < 16 || password.length > 512)
    throw new OrbitError("PASSWORD_POLICY");
  const salt = randomBytes(16);
  return [
    "scrypt",
    "32768",
    "8",
    "1",
    salt.toString("base64url"),
    (await scrypt(password, salt)).toString("base64url"),
  ].join("$");
}
export async function passwordMatches(password: string, encoded: string) {
  try {
    const [algorithm, n, r, p, salt, digest, ...extra] = encoded.split("$");
    if (
      extra.length ||
      algorithm !== "scrypt" ||
      n !== "32768" ||
      r !== "8" ||
      p !== "1" ||
      !salt ||
      !digest ||
      password.length > 512
    )
      return false;
    const expected = Buffer.from(digest, "base64url");
    if (expected.length !== 64 || Buffer.from(salt, "base64url").length !== 16)
      return false;
    return timingSafeEqual(
      expected,
      await scrypt(password, Buffer.from(salt, "base64url")),
    );
  } catch {
    return false;
  }
}
export type Access = "read" | "execute" | "approve" | "manage";
export async function assertRole(user: string, action: Access) {
  const row = (
    await (
      await db()
    ).query("SELECT role,is_active FROM users WHERE id=$1", [user])
  ).rows[0];
  if (
    !row?.is_active ||
    !(
      action === "read"
        ? ["ADMIN", "OPERATOR", "VIEWER"]
        : action === "execute"
          ? ["ADMIN", "OPERATOR"]
          : ["ADMIN"]
    ).includes(row.role)
  )
    throw new OrbitError("FORBIDDEN");
  return row;
}
export async function assertWorkspace(
  user: string,
  workspace: string,
  action: Access,
) {
  await assertRole(user, action);
  const row = (
    await (
      await db()
    ).query(
      "SELECT m.role FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id WHERE w.id=$1 AND w.owner_id=$2 AND m.user_id=$2",
      [workspace, user],
    )
  ).rows[0];
  if (
    !row ||
    !(
      action === "read"
        ? ["ADMIN", "EDITOR", "VIEWER"]
        : action === "execute"
          ? ["ADMIN", "EDITOR"]
          : ["ADMIN"]
    ).includes(row.role)
  )
    throw new OrbitError("FORBIDDEN");
}
export async function assertSeoWorkspace(user: string, action: Access) {
  const row = (
    await (
      await db()
    ).query("SELECT id FROM workspaces WHERE owner_id=$1 AND kind='seo'", [
      user,
    ])
  ).rows[0];
  if (!row) throw new OrbitError("FORBIDDEN");
  return assertWorkspace(user, row.id, action);
}
export async function rateLimit(key: string, limit: number, seconds: number) {
  const row = (
    await (
      await db()
    ).query(
      "INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,1,now()+($2::int*interval '1 second')) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.hits+1 END,expires_at=CASE WHEN rate_limits.expires_at<now() THEN excluded.expires_at ELSE rate_limits.expires_at END RETURNING hits",
      [tokenHash(key), seconds],
    )
  ).rows[0];
  if (row.hits > limit) throw new OrbitError("RATE_LIMIT");
}
export async function securityEvent(
  actor: string | null,
  action: string,
  outcome: string,
) {
  await (
    await db()
  ).query(
    "INSERT INTO security_events(actor_id,action,outcome) VALUES($1,$2,$3)",
    [actor, action.slice(0, 80), outcome.slice(0, 80)],
  );
}
