import { pool } from "@orbit/database/client";
try {
  const r = await pool.query(
    "SELECT id FROM users WHERE role='ADMIN' AND password_hash IS NOT NULL AND is_active",
  );
  if (r.rowCount !== 1) throw Error("SINGLE_OWNER_REQUIRED");
  console.log(r.rows[0].id);
} finally {
  await pool.end();
}
