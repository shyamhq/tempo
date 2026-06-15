ALTER TABLE "workspaces" ADD COLUMN "clerk_org_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "agent_api_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_clerk_org_id_unique" UNIQUE("clerk_org_id");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_agent_api_key_unique" UNIQUE("agent_api_key");