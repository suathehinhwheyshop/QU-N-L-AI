import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
const [mode, transcript] = process.argv.slice(2);
const lines = createInterface({ input: process.stdin });
const secret = "fixture-private-identity-never-return";
if (mode === "hang") {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
}
const reply = (id, result) => {
  const text = JSON.stringify({ id, result }) + "\n";
  process.stdout.write(text.slice(0, 11));
  setImmediate(() => process.stdout.write(text.slice(11)));
};
lines.on("line", (line) => {
  const message = JSON.parse(line);
  appendFileSync(transcript, line + "\n");
  if (mode === "hang") return;
  if (
    ![
      "initialize",
      "initialized",
      "account/read",
      "account/rateLimits/read",
    ].includes(message.method)
  )
    process.exit(70);
  if (message.method === "initialize") {
    if (mode === "early-exit") return process.exit(0);
    if (mode === "bad-json") return process.stdout.write(secret + "\n");
    if (mode === "oversize") return process.stdout.write(secret.repeat(30000));
    if (mode === "server-request")
      return process.stdout.write(
        JSON.stringify({
          id: 90,
          method: "account/chatgptAuthTokens/refresh",
          params: { secret },
        }) + "\n",
      );
    reply(message.id, { userAgent: "stub", secret });
  } else if (message.method === "account/read") {
    reply(message.id, {
      account:
        mode === "signed-out"
          ? null
          : {
              type: mode === "api-key" ? "apiKey" : "chatgpt",
              email: secret,
              accountId: secret,
            },
      requiresOpenaiAuth: true,
    });
  } else if (message.method === "account/rateLimits/read") {
    if (mode === "rpc-error")
      return process.stdout.write(
        JSON.stringify({
          id: message.id,
          error: { code: -32000, message: secret },
        }) + "\n",
      );
    const bucket = {
      limitId: "codex",
      primary: {
        usedPercent: mode === "invalid-window" ? -1 : 27,
        windowDurationMins: 300,
        resetsAt: 1800000000,
      },
      secondary: null,
      credits: { hasCredits: true, unlimited: false, balance: secret },
    };
    reply(message.id, {
      ordinaryUsageAllowed: mode === "exhausted" ? false : true,
      rateLimits: bucket,
      rateLimitsByLimitId: { codex: bucket },
      accountId: secret,
      rateLimitUpsell: { secret },
    });
  }
});
