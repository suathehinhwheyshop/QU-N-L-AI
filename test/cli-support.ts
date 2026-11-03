import { resolve } from "node:path";
import { spawnCli, type CliRunner } from "@orbit/providers/subscription-cli";
export function stubCli(mode = "normal"): CliRunner {
  return {
    kind: "CLI_STUB",
    run(id, args, options) {
      return spawnCli(
        process.execPath,
        [resolve("test/fixtures/cli-stub.mjs"), id, ...args],
        { ...options, env: { ...options.env, ORBIT_CLI_STUB_MODE: mode } },
      );
    },
  };
}
