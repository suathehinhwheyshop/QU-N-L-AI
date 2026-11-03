import { OrbitError } from "./contracts";
export const localMode = () => process.env.ORBIT_LOCAL_MODE === "true";
export const subscriptionOnly = () =>
  localMode() || process.env.ORBIT_AI_POLICY === "subscription-only";
export function assertPaidApiAllowed() {
  if (subscriptionOnly()) throw new OrbitError("PAID_API_DISABLED");
}
