import { installRegistry } from "../core/registry";
import { registerTemplate } from "@orbit/core/planner";
import { registerGoalProfile } from "@orbit/core/interpreter";
import { workspaceModules } from "@orbit/workspaces/registry";
import { providers } from "../providers/registry";
import { workspaceHandlers } from "../workspaces/handlers";
import { reviewedTemplate } from "../workspaces/templates";
import { integrations } from "../integrations/registry";
installRegistry({ providers, handlers: workspaceHandlers, integrations });
for (const module of workspaceModules) {
  registerGoalProfile(module);
  registerTemplate(module.kind, reviewedTemplate);
}
