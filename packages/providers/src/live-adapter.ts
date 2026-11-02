import { z } from "zod";
import {
  Analysis,
  Review,
  ProposedPlan,
  ProbeOutput,
  ModelProfile,
  OrbitError,
} from "@orbit/shared/contracts";
import type { ProviderAdapter } from "@orbit/core/registry";
import {
  structuredCall,
  officialTransport,
  credentialPresent,
  credentialFingerprint,
  type Transport,
  type Wire,
} from "./transport";
export const outputSchemas = {
  analysis: Analysis,
  review: Review,
  planning: ProposedPlan,
  probe: ProbeOutput,
};
export function outputSchema(capability: string) {
  const schema = outputSchemas[capability as keyof typeof outputSchemas];
  if (!schema) throw new OrbitError("NO_PROVIDER");
  return z.toJSONSchema(schema) as Record<string, unknown>;
}
export function createLiveAdapter(
  wire: Wire,
  transport: Transport = officialTransport,
  getKey?: () => string | undefined,
): ProviderAdapter {
  return {
    descriptor: {
      id: transport.kind === "LIVE_API" ? wire.id : "stub-" + wire.id,
      vendor: wire.id,
      mode: transport.kind === "LIVE_API" ? "LIVE" : "MOCK",
      models: [],
      model: "",
      capabilities: ["analysis", "review", "planning"],
      available: true,
      costCents: 0,
      latencyMs: 9999,
      reliability: 1,
      dataPolicy: transport.kind === "LIVE_API" ? "external" : "local-only",
    },
    credentialTag: () =>
      transport.kind === "LIVE_API"
        ? credentialFingerprint(wire.id)
        : "HTTP_STUB",
    async health() {
      return {
        status: "DISCONNECTED",
        code: credentialPresent(wire.id)
          ? "PROBE_REQUIRED"
          : "MISSING_CREDENTIAL",
      };
    },
    async invoke(input) {
      if (!input.model) throw new OrbitError("UNVERIFIED_MODEL");
      const profile = ModelProfile.parse(input.profile);
      return structuredCall(
        wire,
        transport,
        input.model,
        { ...input.data, capability: input.capability },
        outputSchema(input.capability),
        profile,
        input.signal,
        getKey,
      );
    },
  };
}
