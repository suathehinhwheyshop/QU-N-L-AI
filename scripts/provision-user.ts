import { readFile } from "node:fs/promises";
import { z } from "zod";
import { db, pool } from "@orbit/database/client";
import { hashPassword } from "@orbit/database/security";
import { initializeOwner } from "./seed";
export async function provisionUser(
  email: string,
  password: string,
  role = "ADMIN",
  adopt?: string,
) {
  email = z.email().max(254).parse(email.trim().toLowerCase());
  role = z.enum(["ADMIN", "OPERATOR", "VIEWER"]).parse(role);
  const hash = await hashPassword(password);
  const client = await pool.connect();
  let user;
  try {
    await client.query("BEGIN");
    if (adopt) {
      const old = (
        await client.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
          z.uuid().parse(adopt),
        ])
      ).rows[0];
      if (!old || old.password_hash)
        throw Error("ADOPTION_REQUIRES_UNPROVISIONED_LEGACY_USER");
      user = (
        await client.query(
          "UPDATE users SET email=$2,password_hash=$3,role=$4,is_active=true,auth_version=auth_version+1 WHERE id=$1 RETURNING id",
          [adopt, email, hash, role],
        )
      ).rows[0];
    } else
      user = (
        await client.query(
          "INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash,role=excluded.role,is_active=true,auth_version=users.auth_version+1 RETURNING id",
          [email, email.split("@")[0], hash, role],
        )
      ).rows[0];
    await client.query(
      "UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1",
      [user.id],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  await initializeOwner(user.id);
  return user.id as string;
}
if (process.argv[1]?.endsWith("provision-user.ts")) {
  try {
    const option = (n: string) =>
      process.argv
        .find((v) => v.startsWith("--" + n + "="))
        ?.slice(n.length + 3);
    const email = option("email");
    if (!email) throw Error("EXPLICIT_EMAIL_REQUIRED");
    const file = option("password-file");
    const password = (
      file ? await readFile(file, "utf8") : await readPasswordInput()
    ).replace(/\r?\n$/, "");
    await provisionUser(
      email,
      password,
      option("role") ?? "ADMIN",
      option("adopt-owner"),
    );
    console.log(
      "Account provisioned; old sessions revoked. Password is never printed.",
    );
  } catch (e) {
    console.error(
      e instanceof Error && /^[A-Z_]+$/.test(e.message)
        ? e.message
        : "PROVISION_FAILED",
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

async function readPasswordInput() {
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk.toString();
    if (Buffer.byteLength(text) > 2048) throw Error("PASSWORD_POLICY");
  }
  return text;
}
