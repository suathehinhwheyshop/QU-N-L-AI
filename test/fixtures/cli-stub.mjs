// Protocol fixture only. Never an official CLI/login or LIVE proof.
import { readFileSync, writeFileSync } from "node:fs";
const id = process.argv[2],
  args = process.argv.slice(3),
  mode = process.env.ORBIT_CLI_STUB_MODE;
if (args.includes("--version")) {
  console.log(id === "codex-cli" ? "codex-cli 0.166.0" : "0.66.0");
  process.exit(0);
}
if (args.includes("status")) {
  console.error("Logged in using ChatGPT [CLI_STUB]");
  process.exit(0);
}
if (mode === "quota") {
  console.error("RESOURCE_EXHAUSTED: quota limit reached");
  process.exit(1);
}
if (mode === "auth") {
  console.error("Not signed in, OAuth authentication required");
  process.exit(1);
}
if (mode === "hang") {
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
const text = readFileSync(0, "utf8"),
  request = JSON.parse(text),
  cap = request.capability,
  data = request.data;
const output =
  cap === "probe"
    ? { ok: true }
    : (data.structured_fixture ??
      (cap === "review"
        ? {
            ...data.analysis,
            reviewed: true,
            review_notes: [
              "[CLI_STUB] independently received structured analysis",
            ],
          }
        : (data.fixture ?? data.planning_fixture)));
if (id === "codex-cli") {
  writeFileSync(
    args[args.indexOf("--output-last-message") + 1],
    mode === "invalid" ? "not json" : JSON.stringify(output),
  );
  console.log(
    JSON.stringify({ type: "item.completed", item: { type: "agent_message" } }),
  );
  console.log(
    JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 11, output_tokens: 12, cached_input_tokens: 0 },
    }),
  );
} else
  console.log(
    JSON.stringify({
      response: mode === "invalid" ? "not json" : JSON.stringify(output),
      stats: {
        models: {
          fixture: { tokens: { prompt: 11, candidates: 12, total: 23 } },
        },
      },
    }),
  );
