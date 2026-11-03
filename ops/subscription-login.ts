import { spawn } from "node:child_process";
import {
  cliRoot,
  prepareCliProfiles,
  childEnvironment,
  enabledCliDefinitions,
} from "@orbit/providers/subscription-cli";
import { join } from "node:path";
const action = process.argv[2];
const id = action === "login-gemini" ? "gemini-cli" : "codex-cli";
if (!["install-cli", "login-codex", "login-gemini"].includes(action ?? ""))
  throw Error("UNKNOWN_CLI_ACTION");
if (!enabledCliDefinitions().some((d) => d.id === id))
  throw Error("CLI_OPTIONAL_DISABLED");
await prepareCliProfiles(id);
// Credentials and OAuth URLs remain within the user's official interactive CLI terminal.
const child =
  action === "install-cli"
    ? spawn(
        "npm",
        [
          "install",
          "--prefix",
          join(cliRoot(), "tools"),
          "--no-save",
          ...enabledCliDefinitions().map((d) => d.package + "@" + d.version),
        ],
        { stdio: "inherit", shell: false },
      )
    : spawn(
        join(
          cliRoot(),
          "tools/node_modules/.bin",
          id === "codex-cli" ? "codex" : "gemini",
        ),
        id === "codex-cli"
          ? ["login", "-c", 'forced_login_method="chatgpt"']
          : [],
        {
          env: { ...childEnvironment(id), CI: "" },
          stdio: "inherit",
          shell: false,
        },
      );
child.on("error", () => {
  console.error("CLI_NOT_INSTALLED");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
