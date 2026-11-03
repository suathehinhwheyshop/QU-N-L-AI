// Trusted test composition only; never enabled from an HTTP request or production config.
import "../../src/server/runtime";
import { installRegistry } from "@orbit/core/registry";
import { createSubscriptionAdapter } from "@orbit/providers/subscription-cli";
import { stubCli } from "../cli-support";
import { workspaceHandlers } from "@orbit/workspaces/handlers";
import { integrations } from "@orbit/integrations/registry";
installRegistry({
  providers: [
    createSubscriptionAdapter(
      "codex-cli",
      stubCli(process.env.ORBIT_TEST_CLI_MODE),
    ),
    createSubscriptionAdapter(
      "gemini-cli",
      stubCli(process.env.ORBIT_TEST_CLI_MODE),
    ),
  ],
  handlers: workspaceHandlers,
  integrations,
});
