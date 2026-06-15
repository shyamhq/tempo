CREATE TABLE "user_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "user_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "user_tokens_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "mcp_session_id" text;--> statement-breakpoint
CREATE INDEX "user_tokens_user" ON "user_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_tokens_lookup" ON "user_tokens" USING btree ("token_hash") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sessions_mcp_session_id" ON "sessions" USING btree ("mcp_session_id") WHERE "sessions"."mcp_session_id" IS NOT NULL;