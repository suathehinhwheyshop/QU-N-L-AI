import type { PricingProfile } from "@orbit/shared/contracts";
import { OrbitError } from "@orbit/shared/contracts";
export interface Candidate {
  vendor?: string;
  execution?: "API" | "SUBSCRIPTION_CLI";
  models?: string[];
  profile?: PricingProfile;
  id: string;
  mode: "MOCK" | "LIVE";
  available: boolean;
  capabilities: string[];
  model: string;
  costCents: number;
  latencyMs: number;
  reliability: number;
  dataPolicy: "local-only" | "external";
}
export function routeModel(
  candidates: Candidate[],
  capability: string,
  mode: "MOCK" | "LIVE",
  policy: string,
  budget: number,
  avoid?: string,
) {
  const compatible = candidates.filter(
    (c) =>
      c.available &&
      c.mode === mode &&
      c.capabilities.includes(capability) &&
      c.id !== avoid &&
      (policy !== "local-only" || c.dataPolicy === "local-only"),
  );
  if (!compatible.length) throw new OrbitError("NO_PROVIDER");
  const affordable = compatible.filter((c) => c.costCents <= budget);
  if (!affordable.length) throw new OrbitError("BUDGET_EXCEEDED");
  return affordable.sort(
    (a, b) =>
      a.costCents * 10 +
        a.latencyMs / 100 +
        (1 - a.reliability) * 20 -
        (b.costCents * 10 + b.latencyMs / 100 + (1 - b.reliability) * 20) ||
      a.id.localeCompare(b.id),
  )[0];
}
