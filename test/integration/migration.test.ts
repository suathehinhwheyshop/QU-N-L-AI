import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { config } from "dotenv";
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
config({ path: ".env.local", quiet: true });
test("Phase 3 database upgrades in place preserving owner, workspace and history; migration is repeatable", async () => {
  const uri = new URL(process.env.DATABASE_URL!);
  const admin = new Pool({ connectionString: uri.href });
  const name = "orbit_test_upgrade_" + randomUUID().replaceAll("-", "");
  const dir = await mkdtemp("/tmp/orbit-migrations-");
  let pool: Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    uri.pathname = "/" + name;
    pool = new Pool({ connectionString: uri.href });
    await mkdir(dir + "/meta");
    const journal = JSON.parse(
      await readFile("migrations/meta/_journal.json", "utf8"),
    );
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 5);
    await writeFile(dir + "/meta/_journal.json", JSON.stringify(journal));
    for (const e of journal.entries)
      await cp("migrations/" + e.tag + ".sql", dir + "/" + e.tag + ".sql");
    await migrate(drizzle(pool), { migrationsFolder: dir });
    const owner = randomUUID(),
      workspace = randomUUID();
    await pool.query(
      "INSERT INTO users(id,email,name) VALUES($1,'legacy@upgrade.test','Legacy owner')",
      [owner],
    );
    await pool.query(
      "INSERT INTO workspaces(id,owner_id,slug,kind,name) VALUES($1,$2,'legacy-seo','seo','Legacy SEO')",
      [workspace, owner],
    );
    const run = randomUUID(),
      task = randomUUID(),
      approval = randomUUID(),
      hash = "a".repeat(64);
    await pool.query(
      "INSERT INTO runs(id,owner_id,workspace_id,request_key,goal,mode,config,plan,budget_cents,status) VALUES($1,$2,$3,$4,'Legacy SEO review','MOCK','{}','{}',0,'WAITING_APPROVAL')",
      [run, owner, workspace, randomUUID()],
    );
    await pool.query(
      "INSERT INTO tasks(id,run_id,key,title,handler,kind,capability,acceptance,input,output,status) VALUES($1,$2,'gate','Review','approval','approval','review','Preserve output','{}','{\"clicks\":55}','WAITING_APPROVAL')",
      [task, run],
    );
    await pool.query(
      "INSERT INTO approvals(id,run_id,task_id,output_hash) VALUES($1,$2,$3,$4)",
      [approval, run, task, hash],
    );
    await pool.query(
      "INSERT INTO events(run_id,type,message) VALUES($1,'CHECKPOINT','Phase 3 checkpoint history')",
      [run],
    );
    await migrate(drizzle(pool), { migrationsFolder: "migrations" });
    await migrate(drizzle(pool), { migrationsFolder: "migrations" });
    const row = (
      await pool.query(
        "SELECT u.id,u.password_hash,w.id AS workspace,m.role FROM users u JOIN workspaces w ON w.owner_id=u.id JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=u.id WHERE u.id=$1",
        [owner],
      )
    ).rows[0];
    assert.deepEqual(row, {
      id: owner,
      password_hash: null,
      workspace,
      role: "ADMIN",
    });
    const checkpoint = (
      await pool.query(
        "SELECT r.status,t.output,a.output_hash,a.status AS approval_status,e.message FROM runs r JOIN tasks t ON t.run_id=r.id JOIN approvals a ON a.task_id=t.id JOIN events e ON e.run_id=r.id WHERE r.id=$1",
        [run],
      )
    ).rows[0];
    assert.deepEqual(checkpoint, {
      status: "WAITING_APPROVAL",
      output: { clicks: 55 },
      output_hash: hash,
      approval_status: "PENDING",
      message: "Phase 3 checkpoint history",
    });
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM drizzle.__drizzle_migrations",
        )
      ).rows[0].n,
      6,
    );
  } finally {
    await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
    await rm(dir, { recursive: true, force: true });
  }
});
