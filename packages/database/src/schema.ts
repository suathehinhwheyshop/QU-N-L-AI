import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  boolean,
  uniqueIndex,
  primaryKey,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
const id = () => uuid("id").defaultRandom().primaryKey();
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "string" });
export const users = pgTable("users", {
  id: id(),
  email: text().notNull().unique(),
  name: text().notNull(),
  created_at: time("created_at").defaultNow().notNull(),
});
export const workspaces = pgTable(
  "workspaces",
  {
    id: id(),
    owner_id: uuid()
      .notNull()
      .references(() => users.id),
    slug: text().notNull(),
    name: text().notNull(),
    kind: text().notNull(),
    created_at: time("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex().on(t.owner_id, t.slug)],
);
export const settings = pgTable(
  "settings",
  {
    owner_id: uuid()
      .primaryKey()
      .references(() => users.id),
    max_budget_cents: integer().default(100).notNull(),
    concurrency: integer().default(2).notNull(),
    data_policy: text().default("local-only").notNull(),
    read_only: boolean().default(true).notNull(),
    updated_at: time("updated_at").defaultNow().notNull(),
  },
  (t) => [
    check("settings_budget", sql`${t.max_budget_cents} >= 0`),
    check("settings_concurrency", sql`${t.concurrency} between 1 and 4`),
    check("mvp_read_only", sql`${t.read_only} = true`),
  ],
);
export const connections = pgTable("connections", {
  id: text().primaryKey(),
  name: text().notNull(),
  mode: text().notNull(),
  status: text().notNull(),
  capabilities: jsonb().$type<string[]>().notNull(),
  models: jsonb().$type<string[]>().notNull(),
  checked_at: time("checked_at"),
  health_code: text(),
  metadata: jsonb().$type<Record<string, unknown>>().notNull(),
});
export const runs = pgTable(
  "runs",
  {
    id: id(),
    owner_id: uuid()
      .notNull()
      .references(() => users.id),
    workspace_id: uuid()
      .notNull()
      .references(() => workspaces.id),
    request_key: uuid().notNull(),
    goal: text().notNull(),
    mode: text().notNull(),
    status: text().default("QUEUED").notNull(),
    config: jsonb().$type<Record<string, unknown>>().notNull(),
    plan: jsonb().$type<Record<string, unknown>>().notNull(),
    budget_cents: integer().notNull(),
    spent_cents: integer().default(0).notNull(),
    reserved_cents: integer().default(0).notNull(),
    error_code: text(),
    created_at: time("created_at").defaultNow().notNull(),
    updated_at: time("updated_at").defaultNow().notNull(),
    finished_at: time("finished_at"),
  },
  (t) => [
    uniqueIndex().on(t.owner_id, t.request_key),
    index().on(t.owner_id, t.created_at),
    check(
      "run_money",
      sql`${t.budget_cents} >= 0 and ${t.spent_cents} >= 0 and ${t.reserved_cents} >= 0`,
    ),
    check("run_mode", sql`${t.mode} in ('MOCK','LIVE')`),
    check(
      "run_status",
      sql`${t.status} in ('QUEUED','RUNNING','PAUSED','WAITING_APPROVAL','COMPLETED','FAILED','CANCELED')`,
    ),
  ],
);
export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    run_id: uuid()
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    key: text().notNull(),
    title: text().notNull(),
    handler: text().notNull(),
    kind: text().notNull(),
    capability: text().notNull(),
    effect: text().default("read").notNull(),
    priority: integer().default(1).notNull(),
    acceptance: text().notNull(),
    status: text().default("PENDING").notNull(),
    input: jsonb().$type<Record<string, unknown>>().notNull(),
    output: jsonb().$type<Record<string, unknown>>(),
    provider_id: text(),
    model: text(),
    attempt_count: integer().default(0).notNull(),
    max_attempts: integer().default(3).notNull(),
    timeout_ms: integer().default(10000).notNull(),
    next_attempt_at: time("next_attempt_at").defaultNow().notNull(),
    lease_until: time("lease_until"),
    active_attempt_id: uuid(),
    error_code: text(),
    created_at: time("created_at").defaultNow().notNull(),
    updated_at: time("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex().on(t.run_id, t.key),
    index().on(t.status, t.next_attempt_at),
    check(
      "task_status",
      sql`${t.status} in ('PENDING','RUNNING','WAITING_APPROVAL','COMPLETED','FAILED','CANCELED')`,
    ),
    check(
      "task_limits",
      sql`${t.max_attempts} between 1 and 5 and ${t.timeout_ms} between 100 and 120000`,
    ),
  ],
);
export const dependencies = pgTable(
  "task_dependencies",
  {
    task_id: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    depends_on_id: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.task_id, t.depends_on_id] }),
    check("no_self_dependency", sql`${t.task_id} <> ${t.depends_on_id}`),
  ],
);
export const attempts = pgTable(
  "attempts",
  {
    id: id(),
    task_id: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    status: text().notNull(),
    provider_id: text(),
    model: text(),
    provider_snapshot: jsonb().$type<Record<string, unknown>>(),
    reserved_cents: integer().default(0).notNull(),
    cost_cents: integer().default(0).notNull(),
    usage: jsonb().$type<Record<string, unknown>>(),
    error_code: text(),
    started_at: time("started_at").defaultNow().notNull(),
    finished_at: time("finished_at"),
  },
  (t) => [uniqueIndex().on(t.task_id, t.number)],
);
export const approvals = pgTable("approvals", {
  id: id(),
  run_id: uuid()
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  task_id: uuid()
    .notNull()
    .unique()
    .references(() => tasks.id, { onDelete: "cascade" }),
  output_hash: text().notNull(),
  status: text().default("PENDING").notNull(),
  actor_id: uuid().references(() => users.id),
  created_at: time("created_at").defaultNow().notNull(),
  decided_at: time("decided_at"),
});
export const artifacts = pgTable(
  "artifacts",
  {
    id: id(),
    owner_id: uuid()
      .notNull()
      .references(() => users.id),
    run_id: uuid().references(() => runs.id, { onDelete: "cascade" }),
    task_id: uuid().references(() => tasks.id, { onDelete: "cascade" }),
    attempt_id: uuid().references(() => attempts.id),
    name: text().notNull(),
    kind: text().notNull(),
    version: integer().default(1).notNull(),
    mode: text().notNull(),
    media_type: text().notNull(),
    size_bytes: integer().notNull(),
    sha256: text().notNull(),
    blob_key: text().notNull(),
    source_ids: jsonb().$type<string[]>().notNull(),
    created_at: time("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex().on(t.task_id, t.kind, t.version),
    index().on(t.owner_id, t.created_at),
  ],
);
export const events = pgTable(
  "events",
  {
    id: id(),
    run_id: uuid()
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    task_id: uuid().references(() => tasks.id, { onDelete: "cascade" }),
    attempt_id: uuid().references(() => attempts.id),
    type: text().notNull(),
    message: text().notNull(),
    created_at: time("created_at").defaultNow().notNull(),
  },
  (t) => [index().on(t.run_id, t.created_at)],
);
export const actionLedger = pgTable("action_ledger", {
  key: text().primaryKey(),
  task_id: uuid()
    .notNull()
    .references(() => tasks.id),
  status: text().notNull(),
  result: jsonb().$type<Record<string, unknown>>(),
  created_at: time("created_at").defaultNow().notNull(),
});
export type Run = typeof runs.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Attempt = typeof attempts.$inferSelect;

// Owner-specific model configuration; no credential values are stored here.
export const providerConfigs = pgTable(
  "provider_configs",
  {
    owner_id: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider_id: text()
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    enabled: boolean().default(true).notNull(),
    model: text().notNull(),
    model_config: jsonb().$type<Record<string, unknown>>(),
    updated_at: time("updated_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner_id, t.provider_id] })],
);

export const providerProbes = pgTable(
  "provider_probes",
  {
    id: id(),
    owner_id: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider_id: text()
      .notNull()
      .references(() => connections.id),
    model: text().notNull(),
    kind: text().notNull(),
    status: text().notNull(),
    config_hash: text().notNull(),
    credential_tag: text().notNull(),
    latency_ms: integer(),
    cost_cents: integer().default(0).notNull(),
    reserved_cents: integer().default(0).notNull(),
    usage: jsonb().$type<Record<string, unknown>>(),
    capabilities: jsonb().$type<string[]>().notNull(),
    error_code: text(),
    created_at: time("created_at").defaultNow().notNull(),
    finished_at: time("finished_at"),
  },
  (t) => [index().on(t.owner_id, t.provider_id, t.created_at)],
);

export const gscAccounts = pgTable("gsc_accounts", {
  owner_id: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text().notNull(),
  kind: text().notNull(),
  scope: text().notNull(),
  access_cipher: text(),
  refresh_cipher: text(),
  expires_at: time("expires_at"),
  properties: jsonb()
    .$type<{ siteUrl: string; permissionLevel: string }[]>()
    .default([])
    .notNull(),
  verified_at: time("verified_at"),
  error_code: text(),
  updated_at: time("updated_at").defaultNow().notNull(),
});
export const gscOAuthStates = pgTable("gsc_oauth_states", {
  state_hash: text().primaryKey(),
  owner_id: uuid()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  browser_hash: text().notNull(),
  verifier_cipher: text().notNull(),
  expires_at: time("expires_at").notNull(),
  consumed_at: time("consumed_at"),
});
export const gscJobs = pgTable(
  "gsc_jobs",
  {
    id: id(),
    owner_id: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    request_key: uuid().notNull(),
    run_id: uuid()
      .unique()
      .references(() => runs.id, { onDelete: "cascade" }),
    spec: jsonb().$type<Record<string, unknown>>().notNull(),
    checkpoint: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
    dataset_id: uuid(),
    created_at: time("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex().on(t.owner_id, t.request_key)],
);
export const seoDatasets = pgTable(
  "seo_datasets",
  {
    id: id(),
    owner_id: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    request_key: uuid().notNull(),
    request_hash: text().notNull(),
    job_id: uuid()
      .unique()
      .references(() => gscJobs.id),
    name: text().notNull(),
    kind: text().notNull(),
    spec: jsonb().$type<Record<string, unknown>>().notNull(),
    sha256: text().notNull(),
    blob_key: text().notNull(),
    raw_sha256: text(),
    raw_blob_key: text(),
    row_count: integer().notNull(),
    previous_row_count: integer().notNull(),
    warnings: jsonb().$type<string[]>().notNull(),
    created_at: time("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex().on(t.owner_id, t.request_key),
    index().on(t.owner_id, t.created_at),
  ],
);
