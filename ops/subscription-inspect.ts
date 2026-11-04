import { inspectCodexAccount } from "@orbit/providers/codex-account";
import { OrbitError } from "@orbit/shared/contracts";
try {
  console.log(JSON.stringify(await inspectCodexAccount(), null, 2));
} catch (e) {
  console.log(
    JSON.stringify({
      provider: "codex-cli",
      status: "BLOCKED",
      code: e instanceof OrbitError ? e.code : "CLI_ACCOUNT_UNAVAILABLE",
      live_execution_verified: false,
    }),
  );
  process.exitCode = 1;
}
