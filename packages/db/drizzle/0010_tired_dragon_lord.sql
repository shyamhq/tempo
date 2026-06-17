DROP TABLE "sessions" CASCADE;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "agent_last_seen_at" timestamp with time zone;