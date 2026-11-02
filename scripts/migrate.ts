import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
try {
  await migrate(db, { migrationsFolder: "migrations" });
  console.log("Database migrations applied.");
} finally {
  await pool.end();
}
