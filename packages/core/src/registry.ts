import type { z } from "zod";
import { OrbitError } from "@orbit/shared/contracts";
import type { PricingProfile, Evidence } from "@orbit/shared/contracts";
import type { Candidate } from "./router";
export type InvokeInput = {
  capability: string;
  data: Record<string, unknown>;
  attempt: number;
  scenario: string;
  signal: AbortSignal;
  model?: string;
  profile?: PricingProfile;
};
export interface ProviderAdapter {
  descriptor: Candidate;
  credentialTag?: () => string | null;
  health(): Promise<{
    status: "MOCK" | "CONNECTED" | "DISCONNECTED";
    code: string;
  }>;
  invoke(input: InvokeInput): Promise<{
    output: unknown;
    costCents: number;
    usage: Record<string, unknown>;
    evidence?: Evidence;
  }>;
}
export type HandlerContext = {
  execution: {
    ownerId: string;
    runId: string;
    taskId: string;
    attemptId: string;
  };
  signal: AbortSignal;
  input: Record<string, unknown>;
  inputs: Record<string, Record<string, unknown>>;
  hashes: Record<string, string>;
  invoke: (data: Record<string, unknown>) => Promise<{
    output: unknown;
    costCents: number;
    usage: Record<string, unknown>;
    evidence?: Evidence;
  }>;
};
export type Handler = {
  input: z.ZodType;
  output: z.ZodType;
  execute: (ctx: HandlerContext) => Promise<unknown>;
  safeFallback?: boolean;
  invokeTimeoutMs?: number;
  renderArtifacts?: (
    output: Record<string, unknown>,
  ) => { name: string; kind: string; mediaType: string; bytes: Buffer }[];
};
export interface IntegrationAdapter {
  id: string;
  name: string;
  mode: "MOCK" | "LIVE";
  scopes: string[];
  input: z.ZodType;
  output: z.ZodType;
  health(): Promise<{
    status: "MOCK" | "CONNECTED" | "DISCONNECTED";
    code: string;
  }>;
  execute(input: unknown, signal: AbortSignal): Promise<unknown>;
}
let registry: {
  providers: ProviderAdapter[];
  handlers: Record<string, Handler>;
  integrations: IntegrationAdapter[];
} = { providers: [], handlers: {}, integrations: [] };
export function installRegistry(value: typeof registry) {
  registry = value;
}
export function candidates() {
  return registry.providers.map((p) => p.descriptor);
}
export function getProvider(id: string) {
  const p = registry.providers.find((p) => p.descriptor.id === id);
  if (!p) throw new OrbitError("NO_PROVIDER");
  return p;
}
export function getHandler(id: string) {
  const h = registry.handlers[id];
  if (!h) throw new OrbitError("BAD_REQUEST");
  return h;
}
export function getIntegration(id: string) {
  const adapter = registry.integrations.find((tool) => tool.id === id);
  if (!adapter) throw new OrbitError("NO_PROVIDER");
  return adapter;
}
