import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, link, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { OrbitError } from "@orbit/shared/contracts";
export const digest = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
export const jsonBytes = (value: unknown) =>
  Buffer.from(JSON.stringify(canonical(value)));
export interface ArtifactStore {
  put(
    bytes: Uint8Array,
  ): Promise<{ key: string; sha256: string; size: number }>;
  read(key: string, sha256: string): Promise<Buffer>;
}
export class LocalArtifactStore implements ArtifactStore {
  constructor(
    private root = resolve(process.env.ORBIT_STORAGE_DIR || ".orbit/artifacts"),
  ) {}
  async put(bytes: Uint8Array) {
    const hash = digest(bytes);
    await mkdir(this.root, { recursive: true });
    const key = hash;
    // Publish only complete files. Concurrent writers of the same hash must
    // never observe a partially written artifact at its final object key.
    const temporary = join(this.root, `.pending-${randomUUID()}`);
    try {
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      try {
        await link(temporary, join(this.root, key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await this.read(key, hash);
      }
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    return { key, sha256: hash, size: bytes.length };
  }
  async read(key: string, sha256: string) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new OrbitError("ARTIFACT_CORRUPT");
    let bytes: Buffer;
    try {
      bytes = await readFile(join(this.root, key));
    } catch {
      throw new OrbitError("ARTIFACT_CORRUPT");
    }
    if (digest(bytes) !== sha256) throw new OrbitError("ARTIFACT_CORRUPT");
    return bytes;
  }
}
