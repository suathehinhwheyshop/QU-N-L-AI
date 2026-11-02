import { createMockAdapter, type VendorDefinition } from "./mock";
export const anthropic: VendorDefinition = {
  id: "anthropic",
  name: "Claude / Anthropic",
  mockId: "mock-anthropic",
  model: "mock-anthropic/structured-v1",
  capabilities: ["analysis", "review"],
  latencyMs: 40,
};
export const createAnthropicMock = () => createMockAdapter(anthropic);
