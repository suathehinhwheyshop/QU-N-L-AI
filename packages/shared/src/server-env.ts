import { readFileSync, existsSync } from "node:fs";
export function loadServerSecrets() {
  if (typeof window !== "undefined") throw Error("SERVER_ONLY");
  for (const name of [
    "ORBIT_SESSION_SECRET",
    "ORBIT_TOKEN_ENCRYPTION_KEY",
    "ORBIT_TOKEN_ENCRYPTION_PREVIOUS_KEY",
    "ORBIT_OPENAI_API_KEY",
    "ORBIT_ANTHROPIC_API_KEY",
    "ORBIT_GOOGLE_API_KEY",
    "ORBIT_XAI_API_KEY",
    "ORBIT_GSC_CLIENT_SECRET",
  ]) {
    const optional = process.env.ORBIT_INTEGRATIONS_DIR + "/" + name;
    if (
      process.env.ORBIT_INTEGRATIONS_DIR &&
      existsSync(optional) &&
      !process.env[name + "_FILE"]
    )
      process.env[name + "_FILE"] = optional;
    if (process.env[name + "_FILE"])
      process.env[name] = readFileSync(
        process.env[name + "_FILE"]!,
        "utf8",
      ).trim();
  }
  if (!process.env.DATABASE_URL && process.env.ORBIT_DATABASE_PASSWORD_FILE) {
    const password = readFileSync(
      process.env.ORBIT_DATABASE_PASSWORD_FILE,
      "utf8",
    ).trim();
    const url = new URL(
      "postgresql://" +
        (process.env.ORBIT_DATABASE_HOST ?? "db") +
        ":" +
        (process.env.ORBIT_DATABASE_PORT ?? "5432") +
        "/" +
        (process.env.ORBIT_DATABASE_NAME ?? "orbit"),
    );
    url.username = process.env.ORBIT_DATABASE_USER ?? "orbit_app";
    url.password = password;
    process.env.DATABASE_URL = url.href;
  }
}
export function validateServerConfig() {
  loadServerSecrets();
  if (process.env.ORBIT_LOCAL_MODE === "true") {
    const origin = new URL(process.env.ORBIT_BASE_URL ?? "http://invalid");
    if (
      origin.hostname !== "127.0.0.1" ||
      origin.protocol !== "http:" ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      throw Error("LOCAL_LOOPBACK_REQUIRED");
    if (
      process.env.ORBIT_AI_POLICY !== "subscription-only" ||
      !process.env.ORBIT_OWNER_ID
    )
      throw Error("LOCAL_OWNER_POLICY_REQUIRED");
  }
  const stage = ["staging", "production"].includes(process.env.ORBIT_ENV ?? "");
  if (stage) {
    const base = new URL(process.env.ORBIT_BASE_URL ?? "http://invalid");
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      base.pathname !== "/" ||
      base.search ||
      base.hash ||
      process.env.ORBIT_COOKIE_SECURE !== "true"
    )
      throw Error("HTTPS_CONFIG_REQUIRED");
    if (
      !process.env.ORBIT_SESSION_SECRET ||
      process.env.ORBIT_SESSION_SECRET.length < 32 ||
      !process.env.ORBIT_TOKEN_ENCRYPTION_KEY ||
      Buffer.from(process.env.ORBIT_TOKEN_ENCRYPTION_KEY, "base64").length !==
        32
    )
      throw Error("SERVER_SECRETS_REQUIRED");
  }
  return { stage };
}
