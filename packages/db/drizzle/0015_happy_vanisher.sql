ALTER TABLE "threads" ADD COLUMN "repos" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "vm_runs" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_vm_runs_thread_live" ON "vm_runs" USING btree ("thread_id") WHERE ended_at IS NULL;