import { Pool } from "pg";
import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
config({ path: ".env.local", quiet: true });
export async function testDatabase() {
  const current = new URL(process.env.DATABASE_URL!);
  const admin = new Pool({ connectionString: current.href });
  const name = "orbit_test_" + randomBytes(6).toString("hex");
  await admin.query(`CREATE DATABASE "${name}"`);
  current.pathname = "/" + name;
  process.env.DATABASE_URL = current.href;
  process.env.ORBIT_STORAGE_DIR = ".orbit/test-artifacts/" + name;
  const pool = new Pool({ connectionString: current.href });
  await migrate(drizzle(pool), { migrationsFolder: "migrations" });
  await pool.end();
  return {
    name,
    async cleanup() {
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",
        [name],
      );
      await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
    },
  };
}
