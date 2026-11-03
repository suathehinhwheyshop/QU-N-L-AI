import { readFile } from "node:fs/promises";
import { pool } from "@orbit/database/client";
try {
  for (const [name, file] of [
    ["orbit_app", "api_db_password"],
    ["orbit_worker", "worker_db_password"],
  ]) {
    const password = (
      await readFile(
        (process.env.ORBIT_DB_SECRETS_DIR ?? "/run/secrets") + "/" + file,
        "utf8",
      )
    ).trim();
    if (password.length < 32) throw Error("DB_PASSWORD_POLICY");
    const exists = (
      await pool.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [name])
    ).rowCount;
    const statement = (
      await pool.query(
        exists
          ? "SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', $1::text,$2::text) AS sql"
          : "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', $1::text,$2::text) AS sql",
        [name, password],
      )
    ).rows[0].sql;
    await pool.query(statement);
    await pool.query(
      `GRANT CONNECT ON DATABASE "${process.env.ORBIT_DATABASE_NAME ?? "orbit"}" TO ${name}`,
    );
    await pool.query(`GRANT USAGE ON SCHEMA public,drizzle TO ${name}`);
    await pool.query(
      `GRANT SELECT ON ALL TABLES IN SCHEMA public,drizzle TO ${name}`,
    );
    await pool.query(
      `GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${name}`,
    );
  }
  await pool.query(
    "GRANT INSERT,UPDATE,DELETE ON auth_sessions,rate_limits,security_events TO orbit_app",
  );
  await pool.query(
    "GRANT INSERT,UPDATE,DELETE ON runs,tasks,task_dependencies,attempts,approvals,artifacts,events,action_ledger,provider_configs,provider_probes,settings,gsc_accounts,gsc_oauth_states,gsc_jobs,seo_datasets TO orbit_app",
  );
  await pool.query(
    "GRANT INSERT,UPDATE,DELETE ON runs,tasks,attempts,approvals,artifacts,events,action_ledger,provider_probes,gsc_accounts,gsc_jobs,seo_datasets,worker_heartbeats TO orbit_worker",
  );
  await pool.query("REVOKE ALL ON auth_sessions,rate_limits FROM orbit_worker");
  await pool.query(
    "GRANT UPDATE(status,checked_at,health_code) ON connections TO orbit_app",
  );
  await pool.query("REVOKE UPDATE,DELETE ON security_events FROM orbit_app");
  await pool.query(
    "REVOKE ALL ON auth_sessions,rate_limits,security_events,gsc_oauth_states FROM orbit_worker",
  );
  await pool.query("REVOKE SELECT ON users FROM orbit_worker");
  await pool.query(
    "GRANT SELECT(id,role,is_active,auth_version) ON users TO orbit_worker",
  );
  console.log(
    "Database roles granted; web/worker cannot create databases, roles or authentication principals.",
  );
} catch {
  console.error("DB_GRANTS_FAILED");
  process.exitCode = 1;
} finally {
  await pool.end();
}
