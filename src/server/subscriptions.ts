import { pool } from "@/db/client";
import {
  cliDefinitions,
  subscriptionProviders,
  installedVersion,
  cliTag,
  type CliId,
} from "@orbit/providers/subscription-cli";
import { initializeSubscriptions } from "@orbit/database/subscriptions";
import { OrbitError } from "@orbit/shared/contracts";
import { configHash } from "@orbit/core/live-policy";
import { withCliLease } from "@orbit/core/cli-lease";
export async function subscriptionCatalog(owner: string) {
  if (process.env.ORBIT_SUBSCRIPTIONS_ENABLED !== "true") return [];
  const result = [];
  for (const d of cliDefinitions) {
    let status = "NOT_INSTALLED",
      code = "CLI_NOT_INSTALLED";
    try {
      await installedVersion(d.id);
      const probe = (
        await pool.query(
          "SELECT kind,status,error_code,created_at,credential_tag FROM provider_probes WHERE owner_id=$1 AND provider_id=$2 ORDER BY created_at DESC LIMIT 1",
          [owner, d.id],
        )
      ).rows[0];
      status = "NOT_VERIFIED";
      code = "CLI_VERIFICATION_REQUIRED";
      if (probe?.error_code === "CLI_LIMIT_REACHED") {
        status = "LIMIT_REACHED";
        code = probe.error_code;
      } else if (probe?.error_code === "CLI_NOT_SIGNED_IN") {
        status = "NOT_SIGNED_IN";
        code = probe.error_code;
      } else if (
        probe?.kind === "LIVE_CLI" &&
        probe.status === "VERIFIED" &&
        probe.credential_tag === cliTag(d.id) &&
        Date.parse(probe.created_at) > Date.now() - 15 * 60000
      ) {
        status = "CONNECTED";
        code = "LIVE_CLI_VERIFIED";
      }
    } catch {}
    result.push({
      id: d.id,
      name: d.name,
      vendor: d.vendor,
      method: d.login,
      version: d.version,
      status,
      code,
      remaining_quota: null,
      quota_notice:
        "CLI chưa cung cấp số hạn mức còn lại theo giao diện được tích hợp.",
      login_action: d.id === "codex-cli" ? "login-codex" : "login-gemini",
    });
  }
  result.push({
    id: "claude-code",
    name: "Claude Code",
    vendor: "anthropic",
    method: "Chưa xác minh quyền dùng qua orchestrator",
    status: "BLOCKED",
    code: "SUBSCRIPTION_ORCHESTRATOR_ELIGIBILITY_UNVERIFIED",
    remaining_quota: null,
  });
  result.push({
    id: "grok-subscription",
    name: "Grok",
    vendor: "xai",
    method: "Chưa có cơ chế thuê bao được hỗ trợ trong ORBIT",
    status: "UNSUPPORTED",
    code: "NO_VERIFIED_OFFICIAL_SUBSCRIPTION_INTERFACE",
    remaining_quota: null,
  });
  return result;
}
export async function probeSubscription(
  owner: string,
  id: CliId,
  signal: AbortSignal,
) {
  if (process.env.ORBIT_SUBSCRIPTIONS_ENABLED !== "true")
    throw new OrbitError("CLI_UNSUPPORTED");
  const adapter = subscriptionProviders.find((p) => p.descriptor.id === id);
  if (!adapter) throw new OrbitError("NOT_FOUND");
  await initializeSubscriptions(owner);
  const latest = (
    await pool.query(
      "SELECT id FROM provider_probes WHERE owner_id=$1 AND provider_id=$2 AND created_at>now()-interval '10 seconds'",
      [owner, id],
    )
  ).rowCount;
  if (latest) throw new OrbitError("PROBE_BUSY");
  const row = (
    await pool.query(
      "INSERT INTO provider_probes(owner_id,provider_id,model,kind,status,config_hash,credential_tag,capabilities) VALUES($1,$2,'default','UNVERIFIED','RUNNING',$3,$4,'[]') RETURNING id",
      [owner, id, configHash("default", null), cliTag(id)],
    )
  ).rows[0];
  const start = Date.now();
  try {
    const result = await withCliLease(id, signal, () =>
      adapter.invoke({
        capability: "probe",
        model: "default",
        data: { instruction: 'Return exactly {"ok":true}' },
        attempt: 1,
        scenario: "normal",
        signal,
      }),
    );
    if (result.evidence?.kind !== "LIVE_CLI")
      throw new OrbitError("UNTRUSTED_EXECUTION");
    await pool.query(
      "UPDATE provider_probes SET kind='LIVE_CLI',status='VERIFIED',latency_ms=$2,usage=$3,capabilities=$4,finished_at=now() WHERE id=$1",
      [
        row.id,
        Date.now() - start,
        result.usage,
        JSON.stringify(adapter.descriptor.capabilities),
      ],
    );
    return { status: "CONNECTED", kind: "LIVE_CLI", remaining_quota: null };
  } catch (e) {
    const code = e instanceof OrbitError ? e.code : "CLI_FAILED";
    await pool.query(
      "UPDATE provider_probes SET status='FAILED',error_code=$2,finished_at=now() WHERE id=$1",
      [row.id, code],
    );
    throw new OrbitError(code);
  }
}
