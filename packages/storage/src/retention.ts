import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
// Administrator maintenance only. Referenced content is never deleted by age.
export async function collectOrphans(
  root: string,
  referenced: Set<string>,
  apply = false,
  now = Date.now(),
) {
  const candidates: string[] = [];
  for (const name of await readdir(root)) {
    if (
      !/^(?:[a-f0-9]{64}|\.pending-[a-f0-9-]+)$/.test(name) ||
      referenced.has(name)
    )
      continue;
    const info = await stat(join(root, name));
    if (!info.isFile() || now - info.mtimeMs < 7 * 24 * 3600_000) continue;
    candidates.push(name);
    if (apply) await unlink(join(root, name));
  }
  return { mode: apply ? "APPLY" : "DRY_RUN", candidates };
}
