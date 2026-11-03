import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { testDatabase } from "../support";
test("database cleanup detects leaked clients instead of terminating or hiding them", async () => {
  const original = process.env.DATABASE_URL!;
  const environment = await testDatabase();
  const leaked = new Pool({ connectionString: process.env.DATABASE_URL });
  let terminated = false;
  leaked.on("error", () => {
    terminated = true;
  });
  try {
    await leaked.query("SELECT 1");
    await assert.rejects(
      () => environment.cleanup(),
      /still has open connections/,
    );
    assert.equal(terminated, false);
    assert.equal(
      (await leaked.query("SELECT 1 AS healthy")).rows[0].healthy,
      1,
    );
  } finally {
    await leaked.end();
    const admin = new Pool({ connectionString: original });
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${environment.name}"`);
    } finally {
      await admin.end();
    }
    process.env.DATABASE_URL = original;
  }
});
