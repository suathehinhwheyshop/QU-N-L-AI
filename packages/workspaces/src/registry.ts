import { OrbitError } from "@orbit/shared/contracts";
import { seoWorkspace } from "./seo";
import { videoWorkspace } from "./video";
import { researchWorkspace } from "./research";
import { developmentWorkspace } from "./development";
export const workspaceModules = [
  seoWorkspace,
  videoWorkspace,
  researchWorkspace,
  developmentWorkspace,
];
export function getWorkspace(kind: string) {
  const module = workspaceModules.find((w) => w.kind === kind);
  if (!module) throw new OrbitError("BAD_REQUEST");
  return module;
}
