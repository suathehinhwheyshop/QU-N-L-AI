import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, passwordMatches } from "@orbit/database/security";
import { validateServerConfig } from "@orbit/shared/server-env";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
test("password hashing uses salted scrypt and rejects malformed/short credentials", async () => {
  const password =
    "A private staging password " + randomBytes(8).toString("hex");
  const first = await hashPassword(password),
    second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.ok(!first.includes(password));
  assert.equal(await passwordMatches(password, first), true);
  assert.equal(await passwordMatches("incorrect", first), false);
  assert.equal(await passwordMatches(password, "scrypt$1$8$1$a$b"), false);
  await assert.rejects(() => hashPassword("short"), /PASSWORD_POLICY/);
});
test("staging fails closed without HTTPS, Secure cookies and encryption secrets", () => {
  const keys = [
    "ORBIT_ENV",
    "ORBIT_BASE_URL",
    "ORBIT_COOKIE_SECURE",
    "ORBIT_SESSION_SECRET",
    "ORBIT_TOKEN_ENCRYPTION_KEY",
  ];
  const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    Object.assign(process.env, {
      ORBIT_ENV: "staging",
      ORBIT_BASE_URL: "http://localhost:8443",
      ORBIT_COOKIE_SECURE: "true",
      ORBIT_SESSION_SECRET: "s".repeat(64),
      ORBIT_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    });
    assert.throws(() => validateServerConfig(), /HTTPS_CONFIG_REQUIRED/);
    process.env.ORBIT_BASE_URL = "https://localhost:8443";
    assert.equal(validateServerConfig().stage, true);
    process.env.ORBIT_COOKIE_SECURE = "false";
    assert.throws(() => validateServerConfig(), /HTTPS_CONFIG_REQUIRED/);
  } finally {
    for (const k of keys)
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
  }
});
test("frontend has no environment-password fallback or credential reader, CSP is nonce based", async () => {
  const login = await readFile("src/app/login/page.tsx", "utf8");
  assert.doesNotMatch(login, /ORBIT_ADMIN_PASSWORD|process\.env|database/);
  const auth = await readFile("src/server/auth.ts", "utf8");
  assert.doesNotMatch(auth, /process\.env\.ORBIT_ADMIN_PASSWORD/);
  const proxy = await readFile("src/proxy.ts", "utf8");
  assert.match(proxy, /nonce-\$\{nonce\}/);
  assert.match(proxy, /strict-dynamic/);
  const image = await readFile("Dockerfile", "utf8");
  assert.match(image, /USER node/);
  assert.doesNotMatch(image, /COPY.*\.env/);
});
