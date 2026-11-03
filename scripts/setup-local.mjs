import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
  chmodSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
mkdirSync(".orbit", { recursive: true });
if (!existsSync(".env.local")) {
  const password = randomBytes(24).toString("hex");
  writeFileSync(
    ".orbit/postgres.env",
    `POSTGRES_USER=orbit\nPOSTGRES_DB=orbit\nPOSTGRES_PASSWORD=${password}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    ".env.local",
    `DATABASE_URL=postgresql://orbit:${password}@127.0.0.1:55432/orbit\nORBIT_SESSION_SECRET=${randomBytes(32).toString("hex")}\nORBIT_ADMIN_PASSWORD=${randomBytes(24).toString("base64url")}\nORBIT_BASE_URL=http://127.0.0.1:3200\nORBIT_COOKIE_SECURE=false\nORBIT_STORAGE_DIR=.orbit/artifacts\n`,
    { mode: 0o600 },
  );
  console.log(
    "Created ignored local development configuration. Secrets are not printed.",
  );
} else console.log("Preserving .env.local.");
// Dedicated local encryption key; never derive it from the session password.
const localConfiguration = readFileSync(".env.local", "utf8");
if (!/^ORBIT_TOKEN_ENCRYPTION_KEY=.+$/m.test(localConfiguration)) {
  appendFileSync(
    ".env.local",
    `\nORBIT_TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}\n`,
  );
  chmodSync(".env.local", 0o600);
  console.log(
    "Created a dedicated local token encryption key; value is not printed.",
  );
}
if (!existsSync(".orbit/postgres.env")) {
  console.log(
    "No local database env file: use the existing DATABASE_URL and start that database separately.",
  );
  process.exit(0);
}
const dockerEnv = { ...process.env };
for (const key of [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
])
  delete dockerEnv[key];
const docker = (args, quiet = false) =>
  spawnSync("docker", ["--host=unix:///var/run/docker.sock", ...args], {
    env: dockerEnv,
    stdio: quiet ? "pipe" : "inherit",
    encoding: "utf8",
  });
if (docker(["info", "--format", "{{.ServerVersion}}"], true).status !== 0) {
  console.error(
    "Local Docker daemon unavailable. Start it through the environment; credentials/configuration preserved.",
  );
  process.exit(1);
}
const state = docker(
  ["inspect", "--format", "{{.State.Running}}", "orbit-phase1-postgres"],
  true,
);
if (state.status === 0) {
  if (
    state.stdout.trim() !== "true" &&
    docker(["start", "orbit-phase1-postgres"]).status !== 0
  )
    process.exit(1);
} else if (
  docker([
    "run",
    "-d",
    "--name",
    "orbit-phase1-postgres",
    "--env-file",
    ".orbit/postgres.env",
    "-p",
    "127.0.0.1:55432:5432",
    "-v",
    "orbit-phase1-pg:/var/lib/postgresql/data",
    "postgres:17-bookworm@sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5",
  ]).status !== 0
)
  process.exit(1);
for (let i = 0; i < 30; i++) {
  if (
    docker(
      [
        "exec",
        "orbit-phase1-postgres",
        "pg_isready",
        "-U",
        "orbit",
        "-d",
        "orbit",
      ],
      true,
    ).status === 0
  ) {
    console.log("PostgreSQL ready. Run migrations and seed next.");
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 500));
}
console.error(
  "PostgreSQL did not become ready. Inspect this container without dumping its environment.",
);
process.exit(1);
