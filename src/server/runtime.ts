import { localMode } from "@orbit/shared/execution-policy";
import { subscriptionCliEnabled } from "@orbit/shared/subscription-policy";
import { activeSubscriptionProviders } from "@orbit/providers/subscription-cli";
import { subscriptionOnly } from "@orbit/shared/execution-policy";
import { validateSeoGoal } from "@orbit/workspaces/seo-template";
import { installRegistry } from "../core/registry";
import { registerTemplate, registerGoalPolicy } from "@orbit/core/planner";
import { registerGoalProfile } from "@orbit/core/interpreter";
import { workspaceModules } from "@orbit/workspaces/registry";
import { providers } from "../providers/registry";
import { liveProviders } from "@orbit/providers/live-registry";
import { workspaceHandlers } from "../workspaces/handlers";
import { reviewedTemplate } from "../workspaces/templates";
import { integrations } from "../integrations/registry";
installRegistry({
  providers: [
    ...providers.filter(
      (p) =>
        !(
          localMode() &&
          p.descriptor.vendor === "google" &&
          !subscriptionCliEnabled("gemini-cli")
        ),
    ),
    ...(subscriptionOnly() ? [] : liveProviders),
    ...(process.env.ORBIT_SUBSCRIPTIONS_ENABLED === "true"
      ? activeSubscriptionProviders()
      : []),
  ],
  handlers: workspaceHandlers,
  integrations,
});
for (const module of workspaceModules) {
  registerGoalProfile(module);
  registerTemplate(module.kind, reviewedTemplate);
}

registerGoalPolicy("seo", validateSeoGoal);
