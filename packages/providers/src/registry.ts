import { OrbitError } from "@orbit/shared/contracts";
import { anthropic, createAnthropicMock } from "./anthropic";
import { openai, createOpenAIMock } from "./openai";
import { google, createGoogleMock } from "./google";
import { xai, createXAIMock } from "./xai";
export const definitions = [anthropic, openai, google, xai];
export const providers = [
  createAnthropicMock(),
  createOpenAIMock(),
  createGoogleMock(),
  createXAIMock(),
];
export const realProviders = definitions.map((d) => ({
  id: d.id,
  name: d.name,
}));
export function getProvider(id: string) {
  const adapter = providers.find((p) => p.descriptor.id === id);
  if (!adapter) throw new OrbitError("NO_PROVIDER");
  return adapter;
}
export function describeLiveProvider(id: string) {
  const d = definitions.find((d) => d.id === id);
  if (!d) throw new OrbitError("NOT_FOUND");
  return {
    id: d.id,
    name: d.name,
    status: "DISCONNECTED" as const,
    implementation: "CODE_READY_UNVERIFIED" as const,
    capabilities_verified: false,
    model_configuration: { selected_model: null, verified: false },
    notice:
      "API adapter đã có code, chưa xác minh khi thiếu credential/model probe. MOCK không phải kết nối thật.",
  };
}
