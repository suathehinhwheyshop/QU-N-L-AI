CREATE TABLE "action_ledger" (
	"key" text PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"output_hash" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "approvals_task_id_unique" UNIQUE("task_id")
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"run_id" uuid,
	"task_id" uuid,
	"attempt_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"mode" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"blob_key" text NOT NULL,
	"source_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" text NOT NULL,
	"provider_id" text,
	"model" text,
	"reserved_cents" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"usage" jsonb,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"models" jsonb NOT NULL,
	"checked_at" timestamp with time zone,
	"health_code" text,
	"metadata" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"task_id" uuid NOT NULL,
	"depends_on_id" uuid NOT NULL,
	CONSTRAINT "task_dependencies_task_id_depends_on_id_pk" PRIMARY KEY("task_id","depends_on_id"),
	CONSTRAINT "no_self_dependency" CHECK ("task_dependencies"."task_id" <> "task_dependencies"."depends_on_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"task_id" uuid,
	"attempt_id" uuid,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"goal" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"config" jsonb NOT NULL,
	"plan" jsonb NOT NULL,
	"budget_cents" integer NOT NULL,
	"spent_cents" integer DEFAULT 0 NOT NULL,
	"reserved_cents" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "run_money" CHECK ("runs"."budget_cents" >= 0 and "runs"."spent_cents" >= 0 and "runs"."reserved_cents" >= 0),
	CONSTRAINT "run_mode" CHECK ("runs"."mode" in ('MOCK','LIVE')),
	CONSTRAINT "run_status" CHECK ("runs"."status" in ('QUEUED','RUNNING','PAUSED','WAITING_APPROVAL','COMPLETED','FAILED','CANCELED'))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"max_budget_cents" integer DEFAULT 100 NOT NULL,
	"concurrency" integer DEFAULT 2 NOT NULL,
	"data_policy" text DEFAULT 'local-only' NOT NULL,
	"read_only" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_budget" CHECK ("settings"."max_budget_cents" >= 0),
	CONSTRAINT "settings_concurrency" CHECK ("settings"."concurrency" between 1 and 4),
	CONSTRAINT "mvp_read_only" CHECK ("settings"."read_only" = true)
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"handler" text NOT NULL,
	"kind" text NOT NULL,
	"capability" text NOT NULL,
	"effect" text DEFAULT 'read' NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	"acceptance" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"provider_id" text,
	"model" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"active_attempt_id" uuid,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_status" CHECK ("tasks"."status" in ('PENDING','RUNNING','WAITING_APPROVAL','COMPLETED','FAILED','CANCELED')),
	CONSTRAINT "task_limits" CHECK ("tasks"."max_attempts" between 1 and 5 and "tasks"."timeout_ms" between 100 and 120000)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_ledger" ADD CONSTRAINT "action_ledger_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_id_tasks_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_task_id_kind_version_index" ON "artifacts" USING btree ("task_id","kind","version");--> statement-breakpoint
CREATE INDEX "artifacts_owner_id_created_at_index" ON "artifacts" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_task_id_number_index" ON "attempts" USING btree ("task_id","number");--> statement-breakpoint
CREATE INDEX "events_run_id_created_at_index" ON "events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_owner_id_request_key_index" ON "runs" USING btree ("owner_id","request_key");--> statement-breakpoint
CREATE INDEX "runs_owner_id_created_at_index" ON "runs" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_run_id_key_index" ON "tasks" USING btree ("run_id","key");--> statement-breakpoint
CREATE INDEX "tasks_status_next_attempt_at_index" ON "tasks" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_owner_id_slug_index" ON "workspaces" USING btree ("owner_id","slug");