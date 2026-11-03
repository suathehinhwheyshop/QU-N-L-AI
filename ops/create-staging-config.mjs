import { randomBytes } from "node:crypto";
import { mkdir, writeFile, chmod, access } from "node:fs/promises";
import { resolve } from "node:path";
const dir = resolve(process.argv[2] ?? ".orbit/staging");
try {
  await access(dir + "/staging.env");
  throw Error("CONFIG_EXISTS");
} catch (e) {
  if (e.message === "CONFIG_EXISTS") throw e;
}
await mkdir(dir + "/secrets", { recursive: true, mode: 0o700 });
for (const name of [
  "db_password",
  "api_db_password",
  "worker_db_password",
  "session_secret",
  "token_key",
  "bootstrap_password",
  "backup_key",
]) {
  await writeFile(
    dir + "/secrets/" + name,
    randomBytes(32).toString("base64") + "\n",
    { mode: 0o600, flag: "wx" },
  );
}
await writeFile(
  dir + "/staging.env",
  `ORBIT_CONFIG_DIR=${dir}\nORBIT_BASE_URL=https://localhost:8443\nORBIT_HOSTNAME=localhost\nORBIT_HTTPS_PORT=8443\nORBIT_IMAGE=orbit:phase4-candidate\nORBIT_DATABASE_NAME=orbit\n`,
  { mode: 0o600, flag: "wx" },
);
await chmod(dir, 0o700);
console.log(
  "Local staging configuration created. Secrets were not printed; choose an admin email explicitly before provisioning.",
);
