import {
  assertPaidApiAllowed,
  subscriptionOnly,
} from "@orbit/shared/execution-policy";
import { getGscClient } from "@orbit/integrations/gsc-runtime";
import { pool } from "@orbit/database/client";
import { ModelProfile, ProbeOutput, OrbitError } from "@orbit/shared/contracts";
import { liveProviders } from "@orbit/providers/live-registry";
import {
  credentialPresent,
  credentialFingerprint,
} from "@orbit/providers/transport";
import { configuredCandidates, configHash } from "@orbit/core/live-policy";
export async function connectionCatalog(owner: string) {
  const client = await pool.connect();
  try {
    const rows = (await client.query("SELECT * FROM connections")).rows;
    const gsc = await getGscClient().oauth.status(owner);
    const configs = (
      await client.query("SELECT * FROM provider_configs WHERE owner_id=$1", [
        owner,
      ])
    ).rows;
    const ready = await configuredCandidates(client, owner);
    const probes = (
      await client.query(
        "SELECT DISTINCT ON(provider_id) provider_id,model,kind,status,latency_ms,cost_cents,error_code,created_at,finished_at FROM provider_probes WHERE owner_id=$1 ORDER BY provider_id,created_at DESC",
        [owner],
      )
    ).rows;
    return rows
      .filter(
        (c) =>
          c.metadata.archived !== true &&
          c.metadata.kind !== "subscription" &&
          !(
            subscriptionOnly() &&
            c.mode === "LIVE" &&
            c.metadata.kind === "provider"
          ),
      )
      .map((c) => {
        const cfg = configs.find((x) => x.provider_id === c.id),
          candidate = ready.find((x) => x.id === c.id);
        const live = c.mode === "LIVE" && c.metadata.kind === "provider";
        return {
          ...c,
          ...(c.id === "gsc"
            ? {
                status: gsc.status,
                checked_at: gsc.verified_at ?? null,
                health_code: gsc.error_code ?? null,
                capabilities: gsc.status === "CONNECTED" ? ["gsc.read"] : [],
              }
            : {}),
          ...(live
            ? {
                status: candidate?.available ? "CONNECTED" : "DISCONNECTED",
                models: cfg ? [cfg.model] : [],
                capabilities: candidate?.available
                  ? candidate.capabilities
                  : [],
              }
            : {}),
          metadata: {
            ...c.metadata,
            ...(c.id === "gsc"
              ? {
                  implementation: "OAUTH_READONLY",
                  reason: gsc.configured
                    ? "OAUTH_AND_PROPERTY_VERIFICATION_REQUIRED"
                    : "GSC_CONFIG_REQUIRED",
                  source_kind: gsc.kind,
                }
              : {}),
            ...(cfg
              ? {
                  enabled: cfg.enabled,
                  selected_model: cfg.model,
                  model_config: cfg.model_config,
                }
              : {}),
            ...(live
              ? {
                  credential_present: credentialPresent(c.id),
                  implementation: "CODE_READY_UNVERIFIED",
                  declared_capabilities:
                    liveProviders.find((p) => p.descriptor.id === c.id)
                      ?.descriptor.capabilities ?? [],
                  last_probe:
                    probes.find((p) => p.provider_id === c.id) ?? null,
                  verification: candidate?.available
                    ? "LIVE_API"
                    : "NOT_VERIFIED",
                }
              : {}),
          },
        };
      });
  } finally {
    client.release();
  }
}
export async function probeLive(owner: string, providerId: string) {
  assertPaidApiAllowed();
  const adapter = liveProviders.find((p) => p.descriptor.id === providerId);
  if (!adapter) throw new OrbitError("NOT_FOUND");
  if (!credentialPresent(providerId))
    throw new OrbitError("MISSING_CREDENTIAL");
  const cfg = (
    await pool.query(
      "SELECT * FROM provider_configs WHERE owner_id=$1 AND provider_id=$2",
      [owner, providerId],
    )
  ).rows[0];
  const parsed = ModelProfile.safeParse(cfg?.model_config);
  if (!cfg || !parsed.success) throw new OrbitError("PRICING_REQUIRED");
  const setting = (
    await pool.query("SELECT * FROM settings WHERE owner_id=$1", [owner])
  ).rows[0];
  if (setting.data_policy !== "external")
    throw new OrbitError("EXTERNAL_POLICY");
  const profile = { ...parsed.data, max_output_tokens: 128 };
  const reserved = Math.ceil(
    (profile.max_input_tokens * profile.input_usd_per_million +
      profile.max_output_tokens * profile.output_usd_per_million) /
      10000,
  );
  if (reserved > setting.max_budget_cents)
    throw new OrbitError("BUDGET_EXCEEDED");
  const tag = credentialFingerprint(providerId)!;
  const client = await pool.connect();
  let row: { id: string };
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7493121)");
    // A crashed probe may have reached the provider: conservatively settle its reservation.
    await client.query(
      "UPDATE provider_probes SET status='FAILED',error_code='PROBE_INTERRUPTED',cost_cents=reserved_cents,reserved_cents=0,finished_at=now() WHERE owner_id=$1 AND status='RUNNING' AND created_at<now()-interval '1 minute'",
      [owner],
    );
    const history = (
      await client.query(
        "SELECT coalesce(sum(cost_cents+reserved_cents),0)::int AS used, count(*) FILTER (WHERE provider_id=$2 AND created_at>now()-interval '10 seconds')::int AS recent, count(*) FILTER (WHERE status='RUNNING')::int AS active FROM provider_probes WHERE owner_id=$1 AND created_at>now()-interval '24 hours'",
        [owner, providerId],
      )
    ).rows[0];
    if (history.recent || history.active) throw new OrbitError("PROBE_BUSY");
    if (history.used + reserved > setting.max_budget_cents)
      throw new OrbitError("BUDGET_EXCEEDED");
    row = (
      await client.query(
        "INSERT INTO provider_probes(owner_id,provider_id,model,kind,status,config_hash,credential_tag,reserved_cents,capabilities) VALUES($1,$2,$3,'UNVERIFIED','RUNNING',$4,$5,$6,'[]') RETURNING id",
        [
          owner,
          providerId,
          cfg.model,
          configHash(cfg.model, parsed.data),
          tag,
          reserved,
        ],
      )
    ).rows[0];
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const start = Date.now();
  let charged = 0,
    usage: Record<string, unknown> = {};
  try {
    const response = await adapter.invoke({
      model: cfg.model,
      profile,
      capability: "probe",
      data: {
        instruction:
          'Return {"ok":true} only; this is a structured generation probe.',
      },
      attempt: 1,
      scenario: "normal",
      signal: AbortSignal.timeout(20000),
    });
    charged = response.costCents;
    usage = response.usage;
    ProbeOutput.parse(response.output);
    if (response.evidence?.kind !== "LIVE_API")
      throw new OrbitError("UNTRUSTED_EXECUTION");
    await pool.query(
      "UPDATE provider_probes SET status='VERIFIED',kind='LIVE_API',latency_ms=$2,cost_cents=$3,reserved_cents=0,usage=$4,capabilities=$5,finished_at=now() WHERE id=$1",
      [
        row.id,
        Date.now() - start,
        charged,
        usage,
        JSON.stringify(adapter.descriptor.capabilities),
      ],
    );
    return {
      status: "CONNECTED",
      verification: "LIVE_API",
      probe_id: row.id,
      model: cfg.model,
      cost_cents: charged,
      latency_ms: Date.now() - start,
    };
  } catch (error) {
    const code =
      error instanceof OrbitError ? error.code : "API_RESPONSE_INVALID";
    if (error instanceof OrbitError && error.billingUncertain)
      charged = reserved;
    await pool.query(
      "UPDATE provider_probes SET status='FAILED',cost_cents=$2,reserved_cents=0,usage=$3,error_code=$4,finished_at=now() WHERE id=$1",
      [row.id, charged, usage, code],
    );
    throw new OrbitError(code);
  }
}
