CREATE TABLE IF NOT EXISTS "applied_ops" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"target_run_id" text NOT NULL,
	"op_id" text NOT NULL,
	"kind" varchar(32) NOT NULL,
	"op_type" varchar(16) NOT NULL,
	"ok" boolean NOT NULL,
	"new_id" text,
	"error" text,
	"applied_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"target_run_id" text,
	"stage" varchar(32) NOT NULL,
	"ok" boolean NOT NULL,
	"actor" text NOT NULL,
	"ts" timestamp DEFAULT now() NOT NULL,
	"op_index" integer,
	"message" text,
	"payload_ref" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "env_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"base_url" text NOT NULL,
	"auth_mode" varchar(16) NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_checked_at" timestamp,
	"last_check_ok" boolean
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mapping_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"target_run_id" text NOT NULL,
	"kind" varchar(32) NOT NULL,
	"source_id" text NOT NULL,
	"target_id" text,
	"method" varchar(16) NOT NULL,
	"confidence" real NOT NULL,
	"reason" text NOT NULL,
	"accepted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"source_credential_id" text NOT NULL,
	"kinds" jsonb NOT NULL,
	"actor" text NOT NULL,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"target_run_id" text,
	"env" varchar(16) NOT NULL,
	"env_label" text NOT NULL,
	"base_url" text NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"kinds" jsonb NOT NULL,
	"entities" jsonb NOT NULL,
	"is_pre_apply" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"target_run_id" text NOT NULL,
	"ops" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "target_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"target_credential_id" text NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "applied_ops" ADD CONSTRAINT "applied_ops_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "applied_ops" ADD CONSTRAINT "applied_ops_target_run_id_target_runs_id_fk" FOREIGN KEY ("target_run_id") REFERENCES "public"."target_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_target_run_id_target_runs_id_fk" FOREIGN KEY ("target_run_id") REFERENCES "public"."target_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mapping_decisions" ADD CONSTRAINT "mapping_decisions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mapping_decisions" ADD CONSTRAINT "mapping_decisions_target_run_id_target_runs_id_fk" FOREIGN KEY ("target_run_id") REFERENCES "public"."target_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runs" ADD CONSTRAINT "runs_source_credential_id_env_credentials_id_fk" FOREIGN KEY ("source_credential_id") REFERENCES "public"."env_credentials"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_target_run_id_target_runs_id_fk" FOREIGN KEY ("target_run_id") REFERENCES "public"."target_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sync_plans" ADD CONSTRAINT "sync_plans_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sync_plans" ADD CONSTRAINT "sync_plans_target_run_id_target_runs_id_fk" FOREIGN KEY ("target_run_id") REFERENCES "public"."target_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "target_runs" ADD CONSTRAINT "target_runs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "target_runs" ADD CONSTRAINT "target_runs_target_credential_id_env_credentials_id_fk" FOREIGN KEY ("target_credential_id") REFERENCES "public"."env_credentials"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applied_ops_target_idx" ON "applied_ops" USING btree ("run_id","target_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_entries_run_idx" ON "audit_entries" USING btree ("run_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "env_credentials_label_idx" ON "env_credentials" USING btree ("label");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mapping_decisions_source_idx" ON "mapping_decisions" USING btree ("run_id","target_run_id","kind","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshots_run_idx" ON "snapshots" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sync_plans_target_idx" ON "sync_plans" USING btree ("run_id","target_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "target_runs_run_idx" ON "target_runs" USING btree ("run_id");