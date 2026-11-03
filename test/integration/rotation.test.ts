import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { testDatabase } from "../support";
import { seal, unseal } from "@orbit/integrations/token-crypto";
test("token rotation rewraps persisted ciphertext, rejects wrong owner/key/tampering and rolls back on corrupt row", async () => {
  const database = await testDatabase();
  const { pool } = await import("@orbit/database/client");
  const { rotateTokens } = await import("../../ops/rotate-tokens");
  const old = randomBytes(32).toString("base64"),
    current = randomBytes(32).toString("base64"),
    owner = randomUUID();
  try {
    await pool.query(
      "INSERT INTO users(id,email,name) VALUES($1,'rotation@test.invalid','Rotation')",
      [owner],
    );
    process.env.ORBIT_TOKEN_ENCRYPTION_KEY = old;
    const cipher = seal("fixture-token-only", owner + ":access");
    await pool.query(
      "INSERT INTO gsc_accounts(owner_id,status,kind,scope,access_cipher) VALUES($1,'AUTHORIZED','HTTP_STUB','https://www.googleapis.com/auth/webmasters.readonly',$2)",
      [owner, cipher],
    );
    process.env.ORBIT_TOKEN_ENCRYPTION_KEY = current;
    assert.throws(() => unseal(cipher, owner + ":access"), /DECRYPT_FAILED/);
    process.env.ORBIT_TOKEN_ENCRYPTION_PREVIOUS_KEY = old;
    assert.equal(unseal(cipher, owner + ":access"), "fixture-token-only");
    assert.throws(
      () => unseal(cipher, randomUUID() + ":access"),
      /DECRYPT_FAILED/,
    );
    assert.equal(await rotateTokens(), 1);
    delete process.env.ORBIT_TOKEN_ENCRYPTION_PREVIOUS_KEY;
    const next = (
      await pool.query(
        "SELECT access_cipher FROM gsc_accounts WHERE owner_id=$1",
        [owner],
      )
    ).rows[0].access_cipher;
    assert.notEqual(next, cipher);
    assert.equal(unseal(next, owner + ":access"), "fixture-token-only");
    process.env.ORBIT_TOKEN_ENCRYPTION_PREVIOUS_KEY = old;
    await pool.query(
      "UPDATE gsc_accounts SET refresh_cipher='v1.bad.bad.bad' WHERE owner_id=$1",
      [owner],
    );
    await assert.rejects(() => rotateTokens(), /DECRYPT_FAILED/);
    assert.equal(
      (
        await pool.query(
          "SELECT access_cipher FROM gsc_accounts WHERE owner_id=$1",
          [owner],
        )
      ).rows[0].access_cipher,
      next,
    );
  } finally {
    await pool.end();
    await database.cleanup();
    delete process.env.ORBIT_TOKEN_ENCRYPTION_PREVIOUS_KEY;
  }
});
