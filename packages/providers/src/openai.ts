import { createMockAdapter, type VendorDefinition } from "./mock";
export const openai: VendorDefinition = {
  id: "openai",
  name: "GPT / OpenAI",
  mockId: "mock-openai",
  model: "mock-openai/structured-v1",
  capabilities: ["analysis", "review"],
  latencyMs: 60,
};
export const createOpenAIMock = () => createMockAdapter(openai);
