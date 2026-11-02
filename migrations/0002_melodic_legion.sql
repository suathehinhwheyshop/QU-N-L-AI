CREATE TABLE "provider_probes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"model" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"config_hash" text NOT NULL,
	"credential_tag" text NOT NULL,
	"latency_ms" integer,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"reserved_cents" integer DEFAULT 0 NOT NULL,
	"usage" jsonb,
	"capabilities" jsonb NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "provider_configs" ADD COLUMN "model_config" jsonb;--> statement-breakpoint
ALTER TABLE "provider_probes" ADD CONSTRAINT "provider_probes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_probes" ADD CONSTRAINT "provider_probes_provider_id_connections_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_probes_owner_id_provider_id_created_at_index" ON "provider_probes" USING btree ("owner_id","provider_id","created_at");