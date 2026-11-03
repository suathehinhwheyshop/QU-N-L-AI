import { pool } from "@orbit/database/client";
import { seal, unseal } from "@orbit/integrations/token-crypto";
// Run with web/worker stopped, new active key + previous key mounted server-side.
export async function rotateTokens() {
  if (!process.env.ORBIT_TOKEN_ENCRYPTION_PREVIOUS_KEY)
    throw Error("PREVIOUS_KEY_REQUIRED");
  const client = await pool.connect();
  let count = 0;
  try {
    await client.query("BEGIN");
    for (const row of (
      await client.query(
        "SELECT owner_id,access_cipher,refresh_cipher FROM gsc_accounts FOR UPDATE",
      )
    ).rows) {
      const access = row.access_cipher
        ? seal(
            unseal(row.access_cipher, row.owner_id + ":access"),
            row.owner_id + ":access",
          )
        : null;
      const refresh = row.refresh_cipher
        ? seal(
            unseal(row.refresh_cipher, row.owner_id + ":refresh"),
            row.owner_id + ":refresh",
          )
        : null;
      await client.query(
        "UPDATE gsc_accounts SET access_cipher=$2,refresh_cipher=$3,updated_at=now() WHERE owner_id=$1",
        [row.owner_id, access, refresh],
      );
      count++;
    }
    // Pending PKCE flows are deliberately invalidated instead of carried across maintenance.
    await client.query("DELETE FROM gsc_oauth_states");
    await client.query(
      "INSERT INTO security_events(action,outcome) VALUES('TOKEN_KEY_ROTATION','SUCCESS')",
    );
    await client.query("COMMIT");
    return count;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
if (process.argv[1]?.endsWith("/rotate-tokens.ts")) {
  try {
    console.log(
      JSON.stringify({
        event: "token_key_rotation",
        accounts: await rotateTokens(),
      }),
    );
  } catch {
    console.error("TOKEN_ROTATION_FAILED");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
