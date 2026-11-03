import { OrbitError } from "@orbit/shared/contracts";
export async function limitedBody(req: Request, limit: number) {
  if (Number(req.headers.get("content-length") ?? 0) > limit)
    throw new OrbitError("BAD_REQUEST");
  const reader = req.body?.getReader();
  if (!reader) throw new OrbitError("BAD_REQUEST");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const p = await reader.read();
    if (p.done) break;
    size += p.value.length;
    if (size > limit) {
      await reader.cancel();
      throw new OrbitError("BAD_REQUEST");
    }
    chunks.push(p.value);
  }
  return Buffer.concat(chunks);
}
