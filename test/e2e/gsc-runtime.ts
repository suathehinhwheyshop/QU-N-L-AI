import { GscOAuth } from "@orbit/integrations/gsc-oauth";
import { GscClient } from "@orbit/integrations/gsc-client";
import { installGscClient } from "@orbit/integrations/gsc-runtime";
const base = process.env.ORBIT_TEST_GSC_URL;
if (!base || new URL(base).hostname !== "127.0.0.1")
  throw Error("LOCAL_HTTP_STUB_REQUIRED");
installGscClient(
  new GscClient(
    new GscOAuth({
      kind: "HTTP_STUB",
      api: base + "/api",
      token: base + "/token",
      revoke: base + "/revoke",
      authorize: base + "/authorize",
      fetch: (u, i) => fetch(u, i),
    }),
    2,
    50000,
  ),
);
