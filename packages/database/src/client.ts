import { loadServerSecrets } from "@orbit/shared/server-env";
import { config } from "dotenv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
config({ path: ".env.local", quiet: true });
loadServerSecrets();
const globalDb = globalThis as unknown as { orbitPool?: Pool };
export const pool =
  globalDb.orbitPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 8,
    connectionTimeoutMillis: 5000,
  });
if (process.env.NODE_ENV !== "production") globalDb.orbitPool = pool;
export const db = drizzle(pool, { schema });
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

if (pool.listenerCount("error") === 0)
  pool.on("error", () =>
    console.error(
      JSON.stringify({
        event: "DATABASE_IDLE_CONNECTION_ERROR",
        code: "DATABASE_UNAVAILABLE",
      }),
    ),
  );
