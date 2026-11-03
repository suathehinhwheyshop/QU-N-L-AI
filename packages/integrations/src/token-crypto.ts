import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { OrbitError } from "@orbit/shared/contracts";
function key() {
  const raw = process.env.ORBIT_TOKEN_ENCRYPTION_KEY;
  if (!raw || !/^[A-Za-z0-9+/]{43}=$/.test(raw))
    throw new OrbitError("GSC_ENCRYPTION_REQUIRED");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new OrbitError("GSC_ENCRYPTION_REQUIRED");
  return k;
}
export function encryptionReady() {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}
export function seal(value: string, aad: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  c.setAAD(Buffer.from(aad));
  const bytes = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    c.getAuthTag().toString("base64url"),
    bytes.toString("base64url"),
  ].join(".");
}
export function unseal(value: string, aad: string) {
  try {
    const [v, iv, tag, body, ...extra] = value.split(".");
    if (v !== "v1" || extra.length || !body) throw Error();
    const d = createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(iv, "base64url"),
    );
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      d.update(Buffer.from(body, "base64url")),
      d.final(),
    ]).toString("utf8");
  } catch (e) {
    if (e instanceof OrbitError) throw e;
    throw new OrbitError("GSC_TOKEN_DECRYPT_FAILED");
  }
}
