import { config } from "dotenv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
config({ path: ".env.local", quiet: true });
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
