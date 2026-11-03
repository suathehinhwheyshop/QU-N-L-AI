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
      // pg-pool removes clients before Client.end's socket callback finishes.
      // Force-terminating those backends races graceful shutdown and creates
      // unhandled FATAL errors. Wait for actual disconnect; do not hide leaks.
      try {
        const deadline = Date.now() + 3000;
        while (true) {
          const {
            rows: [row],
          } = await admin.query(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1",
            [name],
          );
          if (!row.n) break;
          if (Date.now() >= deadline)
            throw Error(
              "Test database still has open connections after shutdown",
            );
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        await admin.query(`DROP DATABASE "${name}"`);
      } finally {
        await admin.end();
      }
    },
  };
}
