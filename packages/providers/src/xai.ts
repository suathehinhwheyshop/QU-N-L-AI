import { createMockAdapter, type VendorDefinition } from "./mock";
export const xai: VendorDefinition = {
  id: "xai",
  name: "Grok / xAI",
  mockId: "mock-xai",
  model: "mock-xai/structured-v1",
  capabilities: ["analysis", "review"],
  latencyMs: 100,
};
export const createXAIMock = () => createMockAdapter(xai);
