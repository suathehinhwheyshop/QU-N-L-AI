import { subscriptionOnly } from "@orbit/shared/execution-policy";
import type { PoolClient } from "pg";
import { pool } from "@orbit/database/client";
import { ModelProfile, OrbitError, type Goal } from "@orbit/shared/contracts";
import { digest, jsonBytes } from "@orbit/storage/store";
import { candidates, getProvider } from "./registry";
import type { Candidate } from "./router";
export const configHash = (model: string, profile: unknown) =>
  digest(jsonBytes({ model, profile }));
export async function configuredCandidates(
  client: PoolClient,
  owner: string,
): Promise<Candidate[]> {
  const configs = (
    await client.query("SELECT * FROM provider_configs WHERE owner_id=$1", [
      owner,
    ])
  ).rows;
  const probes = (
    await client.query(
      "SELECT DISTINCT ON(provider_id) * FROM provider_probes WHERE owner_id=$1 ORDER BY provider_id,created_at DESC",
      [owner],
    )
  ).rows;
  return candidates().map((candidate) => {
    const config = configs.find((c) => c.provider_id === candidate.id);
    if (candidate.mode === "MOCK")
      return {
        ...candidate,
        available:
          candidate.available &&
          !!config?.enabled &&
          !!candidate.models?.includes(config.model),
        model: config?.model ?? candidate.model,
      };
    if (candidate.execution === "SUBSCRIPTION_CLI") {
      const probe = probes.find((p) => p.provider_id === candidate.id),
        tag = getProvider(candidate.id).credentialTag?.();
      const ready =
        candidate.available &&
        config?.enabled &&
        config.model === "default" &&
        probe?.kind === "LIVE_CLI" &&
        probe.status === "VERIFIED" &&
        probe.credential_tag === tag &&
        probe.config_hash === configHash("default", null) &&
        Date.parse(probe.created_at) > Date.now() - 15 * 60000;
      return {
        ...candidate,
        available: !!ready,
        model: "default",
        costCents: 0,
        latencyMs: probe?.latency_ms ?? candidate.latencyMs,
      };
    }
    if (subscriptionOnly())
      return { ...candidate, available: false, capabilities: [] };
    const profile = ModelProfile.safeParse(config?.model_config),
      tag = getProvider(candidate.id).credentialTag?.(),
      probe = probes.find((p) => p.provider_id === candidate.id);
    const ready =
      !!config?.enabled &&
      profile.success &&
      !!tag &&
      !!probe &&
      probe.status === "VERIFIED" &&
      probe.kind === "LIVE_API" &&
      probe.model === config.model &&
      probe.credential_tag === tag &&
      probe.config_hash === configHash(config.model, profile.data) &&
      Date.parse(probe.created_at) > Date.now() - 15 * 60 * 1000;
    const cost = profile.success
      ? Math.ceil(
          (profile.data.max_input_tokens * profile.data.input_usd_per_million +
            profile.data.max_output_tokens *
              profile.data.output_usd_per_million) /
            10000,
        )
      : 0;
    return {
      ...candidate,
      available: candidate.available && ready,
      model: config?.model ?? "",
      models: config ? [config.model] : [],
      profile: profile.success ? profile.data : undefined,
      costCents: cost,
      latencyMs: probe?.latency_ms ?? candidate.latencyMs,
      capabilities: ready
        ? candidate.capabilities.filter((c) => probe.capabilities.includes(c))
        : [],
    };
  });
}
export async function admitLive(
  owner: string,
  goal: Goal,
  required: string[] = ["analysis", "review"],
) {
  const client = await pool.connect();
  try {
    const setting = (
      await client.query("SELECT * FROM settings WHERE owner_id=$1", [owner])
    ).rows[0];
    if (setting?.data_policy !== "external" || !goal.live_data_consent)
      throw new OrbitError("EXTERNAL_POLICY");
    if (goal.scenario !== "normal") throw new OrbitError("BAD_REQUEST");
    const available = (await configuredCandidates(client, owner)).filter(
      (c) =>
        c.mode === "LIVE" &&
        c.available &&
        required.every((capability) => c.capabilities.includes(capability)),
    );
    if (new Set(available.map((c) => c.vendor ?? c.id)).size < 2)
      throw new OrbitError("LIVE_NOT_READY");
    const ordered = available.sort(
      (a, b) => a.costCents - b.costCents || a.latencyMs - b.latencyMs,
    );
    const minimum =
      ordered[0].costCents +
      ordered[1].costCents +
      (goal.planning_strategy === "AI_WITH_FALLBACK"
        ? ordered[0].costCents
        : 0);
    if (minimum > goal.budget_cents) throw new OrbitError("BUDGET_EXCEEDED");
    return {
      estimate: minimum * 3,
      notice: subscriptionOnly()
        ? "Dùng hạn mức CLI thuê bao, không chuyển sang REST API; không có số quota còn lại chính thức."
        : "Worst-case happy-path input/output caps × 3 attempts; rounded up cents. Probes billed separately. Not a provider invoice.",
    };
  } finally {
    client.release();
  }
}
