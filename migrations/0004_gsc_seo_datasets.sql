CREATE TABLE "gsc_accounts" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"kind" text NOT NULL,
	"scope" text NOT NULL,
	"access_cipher" text,
	"refresh_cipher" text,
	"expires_at" timestamp with time zone,
	"properties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"error_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"run_id" uuid,
	"spec" jsonb NOT NULL,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dataset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gsc_jobs_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "gsc_oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"browser_hash" text NOT NULL,
	"verifier_cipher" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "seo_datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"job_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"spec" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"blob_key" text NOT NULL,
	"raw_sha256" text,
	"raw_blob_key" text,
	"row_count" integer NOT NULL,
	"previous_row_count" integer NOT NULL,
	"warnings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seo_datasets_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
ALTER TABLE "gsc_accounts" ADD CONSTRAINT "gsc_accounts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_jobs" ADD CONSTRAINT "gsc_jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_jobs" ADD CONSTRAINT "gsc_jobs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_oauth_states" ADD CONSTRAINT "gsc_oauth_states_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_datasets" ADD CONSTRAINT "seo_datasets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_datasets" ADD CONSTRAINT "seo_datasets_job_id_gsc_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."gsc_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_jobs_owner_id_request_key_index" ON "gsc_jobs" USING btree ("owner_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_datasets_owner_id_request_key_index" ON "seo_datasets" USING btree ("owner_id","request_key");--> statement-breakpoint
CREATE INDEX "seo_datasets_owner_id_created_at_index" ON "seo_datasets" USING btree ("owner_id","created_at");