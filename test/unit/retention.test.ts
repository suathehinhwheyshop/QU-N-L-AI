import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, utimes, readdir, rm } from "node:fs/promises";
import { collectOrphans } from "@orbit/storage/retention";
test("retention preserves referenced and recent blobs; deletion requires explicit apply", async () => {
  const root = await mkdtemp("/tmp/orbit-retention-"),
    keep = "a".repeat(64),
    orphan = "b".repeat(64),
    recent = "c".repeat(64);
  try {
    for (const n of [keep, orphan, recent]) await writeFile(root + "/" + n, n);
    for (const n of [keep, orphan])
      await utimes(root + "/" + n, new Date(0), new Date(0));
    assert.deepEqual((await collectOrphans(root, new Set([keep]))).candidates, [
      orphan,
    ]);
    assert.equal((await readdir(root)).length, 3);
    await collectOrphans(root, new Set([keep]), true);
    assert.deepEqual((await readdir(root)).sort(), [keep, recent]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
