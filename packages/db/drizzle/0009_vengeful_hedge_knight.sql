ALTER TABLE "threads" ADD COLUMN "agent_type" text;--> statement-breakpoint
UPDATE "threads" SET "agent_type" = 'local' WHERE "agent_type" IS NULL;--> statement-breakpoint
ALTER TABLE "threads" ALTER COLUMN "agent_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" DROP COLUMN "hosted_enabled";
