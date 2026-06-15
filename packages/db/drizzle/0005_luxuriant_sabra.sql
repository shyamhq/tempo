CREATE TABLE "mailbox_events" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"event_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vm_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"exit_reason" text,
	"cost_estimate_usd" double precision
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "hosted_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mailbox_events" ADD CONSTRAINT "mailbox_events_event_fk" FOREIGN KEY ("thread_id","event_id") REFERENCES "public"."events"("thread_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vm_runs" ADD CONSTRAINT "vm_runs_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_mailbox_events_thread_event" ON "mailbox_events" USING btree ("thread_id","event_id");--> statement-breakpoint
CREATE INDEX "idx_mailbox_events_pending" ON "mailbox_events" USING btree ("thread_id","created_at") WHERE "mailbox_events"."consumed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_vm_runs_thread_started" ON "vm_runs" USING btree ("thread_id","started_at");