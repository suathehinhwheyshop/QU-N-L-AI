import { resolve, join } from "node:path";
export const codexInstance = {
  id: "codex",
  port: 3211,
  dbPort: 55435,
  profile: ".orbit/codex",
  testProfile: ".orbit/codex-test",
  projectPrefix: "orbit-codex-",
  database: "orbit_codex",
  opsImage: "orbit-ops:codex-local",
};
export function localDirectory(root, override) {
  return resolve(override ?? join(root, codexInstance.profile));
}
export function validateCodexConfig(c) {
  if (
    c.instance !== "codex" ||
    !/^orbit-codex-[a-f0-9]{8}$/.test(c.project ?? "") ||
    !/^orbit_codex$|^orbit_restore_[a-z0-9_]+$/.test(c.database ?? "") ||
    c.port !== 3211 ||
    c.dbPort !== 55435
  )
    throw Error("CODEX_PROFILE_REQUIRED_3211_LEGACY_PROFILE_PRESERVED");
  return c;
}
