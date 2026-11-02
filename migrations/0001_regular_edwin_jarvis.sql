CREATE TABLE "provider_configs" (
	"owner_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"model" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_configs_owner_id_provider_id_pk" PRIMARY KEY("owner_id","provider_id")
);
--> statement-breakpoint
ALTER TABLE "provider_configs" ADD CONSTRAINT "provider_configs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_configs" ADD CONSTRAINT "provider_configs_provider_id_connections_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;