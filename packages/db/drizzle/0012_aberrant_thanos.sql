CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"request_summary" text,
	"response_summary" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_connectors" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"tier" text NOT NULL,
	"config" jsonb,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected_by" text
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_connectors" ADD CONSTRAINT "workspace_connectors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_log_workspace_created" ON "audit_log" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workspace_connectors" ON "workspace_connectors" USING btree ("workspace_id","connector_id");