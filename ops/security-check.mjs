import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
const paths = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n");
const prohibited =
  /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-|ant-api\d+-)[A-Za-z0-9_-]{30,}|\bAIza[A-Za-z0-9_-]{30,})/;
let files = 0;
for (const path of paths) {
  if (/\.(png|jpg|jpeg|lock)$/.test(path) || path === "ops/security-check.mjs")
    continue;
  const text = await readFile(path, "utf8");
  if (prohibited.test(text))
    throw Error("SECRET_PATTERN_FOUND_IN_FILE:" + path);
  files++;
}
const login = await readFile("src/server/auth.ts", "utf8");
if (login.includes("process.env.ORBIT_ADMIN_PASSWORD"))
  throw Error("AUTH_BACKDOOR");
const clientFiles = (await readdir("src/components")).filter((p) =>
  p.endsWith(".tsx"),
);
for (const p of clientFiles) {
  const s = await readFile("src/components/" + p, "utf8");
  if (/process\.env|TOKEN_ENCRYPTION_KEY|SESSION_SECRET|_API_KEY/.test(s))
    throw Error("CLIENT_SECRET_REFERENCE:" + p);
}
console.log(
  JSON.stringify({
    status: "PASS",
    files,
    checks: [
      "secret patterns",
      "no env password backdoor",
      "no client secret readers",
    ],
    notice: "Focused automated check, not an independent security audit",
  }),
);
