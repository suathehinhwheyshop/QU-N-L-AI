// Product preference and supported adapters are separate; the core router stays generic.
export const preferredSubscriptionProviders = [
  "claude-code",
  "codex-cli",
  "grokbot",
] as const;
export function subscriptionCliEnabled(id: string) {
  return (
    id === "codex-cli" ||
    (id === "gemini-cli" && process.env.ORBIT_ENABLE_OPTIONAL_GEMINI === "true")
  );
}

// No invented CLI flag or operator boolean may turn an unverified billing policy into proof.
export const codexIncludedOnlyEnforcement = "UNVERIFIED" as const;
