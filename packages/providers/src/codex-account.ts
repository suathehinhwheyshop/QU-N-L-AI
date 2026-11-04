import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { OrbitError } from "@orbit/shared/contracts";
import { codexIncludedOnlyEnforcement } from "@orbit/shared/subscription-policy";
import {
  childEnvironment,
  cliRoot,
  installedVersion,
} from "./subscription-cli";

export interface AccountTransport {
  kind: "OFFICIAL_CLI_ACCOUNT_READ" | "CLI_STUB";
  start(args: string[], cwd: string): ChildProcessWithoutNullStreams;
}
const officialTransport: AccountTransport = {
  kind: "OFFICIAL_CLI_ACCOUNT_READ",
  start(args, cwd) {
    return spawn(join(cliRoot(), "tools/node_modules/.bin/codex"), args, {
      cwd,
      env: childEnvironment("codex-cli"),
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
  },
};
const windowSchema = z.object({
  usedPercent: z.number().finite().min(0).max(10000),
  windowDurationMins: z.number().int().positive().nullable(),
  resetsAt: z.number().int().nonnegative().nullable(),
});
const bucketSchema = z.object({
  limitId: z
    .string()
    .regex(/^[a-zA-Z0-9._:-]{1,80}$/)
    .nullable(),
  primary: windowSchema.nullable(),
  secondary: windowSchema.nullable(),
});
const usageSchema = z.object({
  ordinaryUsageAllowed: z.boolean().nullable().optional(),
  rateLimits: bucketSchema,
  rateLimitsByLimitId: z.record(z.string(), bucketSchema).nullable().optional(),
});
const accountSchema = z.object({
  account: z.object({ type: z.string().max(40) }).nullable(),
});
export type CodexAccountSummary = {
  provider: "codex-cli";
  evidence_kind: AccountTransport["kind"];
  auth: "NOT_SIGNED_IN" | "CHATGPT_SIGNED_IN" | "UNSUPPORTED_AUTH";
  observed_at: string;
  usage: null | {
    ordinary_usage_allowed: boolean | null;
    windows: {
      limit_id: string | null;
      primary: z.infer<typeof windowSchema> | null;
      secondary: z.infer<typeof windowSchema> | null;
    }[];
  };
  included_only_enforcement: typeof codexIncludedOnlyEnforcement;
  execution_status: "BLOCKED";
  live_execution_verified: false;
};

// This narrow RPC client has no public send method and never creates a thread/turn.
// It cannot consume reset credits, send credit emails, change config, or execute commands.
export async function inspectCodexAccount({
  signal = AbortSignal.timeout(10000),
  transport = officialTransport,
}: { signal?: AbortSignal; transport?: AccountTransport } = {}) {
  if (signal.aborted) throw new OrbitError("CANCELED");
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  if (transport.kind !== "CLI_STUB")
    await installedVersion("codex-cli", undefined, bounded);
  const work = await mkdtemp(join(tmpdir(), "orbit-account-"));
  try {
    return await new Promise<CodexAccountSummary>((resolve, reject) => {
      const child = transport.start(
        [
          "app-server",
          "--listen",
          "stdio://",
          "-c",
          'forced_login_method="chatgpt"',
          "-c",
          'model_provider="openai"',
          "-c",
          "analytics.enabled=false",
          "-c",
          "feedback.enabled=false",
          "-c",
          'otel.metrics_exporter="none"',
          "--disable",
          "apps",
          "--disable",
          "enable_mcp_apps",
          "--disable",
          "multi_agent",
        ],
        work,
      );
      let buffer = "",
        bytes = 0,
        stage = 1,
        ended = false;
      let result: CodexAccountSummary | undefined;
      let failure: OrbitError | undefined;
      let killTimer: NodeJS.Timeout | undefined;
      const kill = (sig: NodeJS.Signals) => {
        try {
          if (process.platform === "win32") child.kill(sig);
          else process.kill(-child.pid!, sig);
        } catch {}
      };
      const finish = (error?: OrbitError) => {
        if (ended) return;
        ended = true;
        failure = error;
        child.stdin.end();
        kill("SIGTERM");
        killTimer = setTimeout(() => kill("SIGKILL"), 500).unref();
      };
      const abort = () =>
        finish(
          new OrbitError(signal.aborted ? "CANCELED" : "CLI_ACCOUNT_TIMEOUT"),
        );
      bounded.addEventListener("abort", abort, { once: true });
      const request = (id: number, method: string, params: object) => {
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
      };
      const summary = (
        auth: NonNullable<typeof result>["auth"],
        usage: NonNullable<typeof result>["usage"],
      ) => ({
        provider: "codex-cli" as const,
        evidence_kind: transport.kind,
        auth,
        observed_at: new Date().toISOString(),
        usage,
        included_only_enforcement: codexIncludedOnlyEnforcement,
        execution_status: "BLOCKED" as const,
        live_execution_verified: false as const,
      });
      child.stdin.on("error", () =>
        finish(new OrbitError("CLI_ACCOUNT_UNAVAILABLE")),
      );
      child.on("error", () => finish(new OrbitError("CLI_NOT_INSTALLED")));
      child.once("close", () => {
        bounded.removeEventListener("abort", abort);
        if (killTimer) clearTimeout(killTimer);
        if (failure) reject(failure);
        else if (result) resolve(result);
        else reject(new OrbitError("CLI_ACCOUNT_UNAVAILABLE"));
      });
      const count = (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 262144)
          finish(new OrbitError("CLI_ACCOUNT_OUTPUT_INVALID"));
      };
      child.stderr.on("data", count); // Never return or persist CLI stderr/identity/credentials.
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        count(Buffer.from(chunk));
        if (ended) return;
        buffer += chunk;
        while (buffer.includes("\n") && !ended) {
          const index = buffer.indexOf("\n"),
            line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line);
            // Server requests (including token refresh/approval) are never answered.
            if ("method" in message) {
              if ("id" in message) throw Error("UNEXPECTED_SERVER_REQUEST");
              continue;
            }
            if (
              message.id !== stage ||
              !("result" in message) ||
              "error" in message
            )
              throw Error("INVALID_RESPONSE");
            if (stage === 1) {
              child.stdin.write('{"method":"initialized"}\n');
              stage = 2;
              request(2, "account/read", { refreshToken: false });
            } else if (stage === 2) {
              const account = accountSchema.parse(message.result).account;
              if (!account || account.type !== "chatgpt") {
                result = summary(
                  account ? "UNSUPPORTED_AUTH" : "NOT_SIGNED_IN",
                  null,
                );
                finish();
              } else {
                stage = 3;
                request(3, "account/rateLimits/read", {
                  supportsLunaReserve: false,
                  excludeResetCreditDetails: true,
                });
              }
            } else {
              const usage = usageSchema.parse(message.result);
              const buckets = usage.rateLimitsByLimitId
                ? Object.values(usage.rateLimitsByLimitId)
                : [usage.rateLimits];
              if (buckets.length > 20) throw Error("TOO_MANY_BUCKETS");
              result = summary("CHATGPT_SIGNED_IN", {
                ordinary_usage_allowed: usage.ordinaryUsageAllowed ?? null,
                windows: buckets.map((b) => ({
                  limit_id: b.limitId,
                  primary: b.primary,
                  secondary: b.secondary,
                })),
              });
              finish();
            }
          } catch {
            finish(new OrbitError("CLI_ACCOUNT_OUTPUT_INVALID"));
          }
        }
      });
      request(1, "initialize", {
        clientInfo: {
          name: "orbit_local_account_reader",
          title: "ORBIT read-only account diagnostics",
          version: "1.4.0",
        },
        capabilities: null,
      });
      if (bounded.aborted) abort();
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
