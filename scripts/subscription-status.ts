import { writeFile, mkdir } from "node:fs/promises";
import {
  cliDefinitions,
  installedVersion,
  officialCliRunner,
  childEnvironment,
  cliRoot,
} from "@orbit/providers/subscription-cli";
const observations = [];
for (const d of cliDefinitions) {
  let installed = false,
    auth = "NOT_VERIFIED";
  try {
    await installedVersion(d.id);
    installed = true;
    if (d.id === "codex-cli") {
      const r = await officialCliRunner.run(
        d.id,
        ["login", "status", "-c", 'forced_login_method="chatgpt"'],
        {
          cwd: process.cwd(),
          env: childEnvironment(d.id),
          signal: AbortSignal.timeout(10000),
        },
      );
      auth =
        r.code === 0 && /logged in using chatgpt/i.test(r.stdout + r.stderr)
          ? "CHATGPT_SIGNED_IN_NOT_EXECUTION_VERIFIED"
          : "NOT_SIGNED_IN";
    }
  } catch {}
  observations.push({
    provider: d.id,
    version: installed ? d.version : null,
    installed,
    auth,
    status: "BLOCKED",
    reason: installed
      ? "USER_LOGIN_AND_EXPLICIT_EXECUTION_CONSENT_REQUIRED"
      : "CLI_NOT_INSTALLED",
    live_verified: false,
  });
}
await mkdir("docs/evidence", { recursive: true });
const result = {
  at: new Date().toISOString(),
  status: "BLOCKED",
  mode: "OFFLINE_OFFICIAL_CLI_INTERFACE_CHECK_ONLY",
  observations,
  inference_calls: 0,
  paid_api_calls: 0,
  credential_files_read_by_orbit: false,
  claude_code: "BLOCKED_ELIGIBILITY_UNVERIFIED",
  grok: "UNSUPPORTED_NO_VERIFIED_SUBSCRIPTION_INTERFACE",
  windows10_verified: false,
};
await writeFile(
  "docs/evidence/subscription-live.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
void cliRoot;
