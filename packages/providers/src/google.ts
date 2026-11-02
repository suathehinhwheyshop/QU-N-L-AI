import { createMockAdapter, type VendorDefinition } from "./mock";
export const google: VendorDefinition = {
  id: "google",
  name: "Gemini / Google",
  mockId: "mock-google",
  model: "mock-google/structured-v1",
  capabilities: ["analysis", "review"],
  latencyMs: 80,
};
export const createGoogleMock = () => createMockAdapter(google);
