-- Multi-user attribution: drop binary 'dev'|'agent' enum, replace with
-- author_user_id (NULL = Agent, non-NULL = Clerk user id). Add `mentions`
-- JSONB sidecar to discussion_messages + replies for @mention extraction.
-- (Manually written; regenerate meta/0011_snapshot.json via `bun run db:generate`.)

-- discussion_messages -----------------------------------------------------
ALTER TABLE "discussion_messages" ADD COLUMN "author_user_id" text;--> statement-breakpoint
ALTER TABLE "discussion_messages" ADD COLUMN "mentions" jsonb;--> statement-breakpoint
-- Backfill: agent rows -> NULL; dev rows -> workspace's first registered Dev
-- (best effort; pre-multi-user threads only had one Dev anyway).
UPDATE "discussion_messages" dm
   SET "author_user_id" = (
     SELECT u.user_id
       FROM "user_tokens" u
      WHERE u.revoked_at IS NULL
      ORDER BY u.created_at ASC
      LIMIT 1
   )
 WHERE dm."author" = 'dev';--> statement-breakpoint
ALTER TABLE "discussion_messages" DROP COLUMN "author";--> statement-breakpoint

-- replies ------------------------------------------------------------------
ALTER TABLE "replies" ADD COLUMN "author_user_id" text;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "mentions" jsonb;--> statement-breakpoint
UPDATE "replies" r
   SET "author_user_id" = (
     SELECT u.user_id
       FROM "user_tokens" u
      WHERE u.revoked_at IS NULL
      ORDER BY u.created_at ASC
      LIMIT 1
   )
 WHERE r."author" = 'dev';--> statement-breakpoint
ALTER TABLE "replies" DROP COLUMN "author";--> statement-breakpoint

-- comments -----------------------------------------------------------------
ALTER TABLE "comments" ADD COLUMN "author_user_id" text;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "resolved_by_user_id" text;--> statement-breakpoint
UPDATE "comments"
   SET "author_user_id" = (
     SELECT u.user_id FROM "user_tokens" u
      WHERE u.revoked_at IS NULL
      ORDER BY u.created_at ASC LIMIT 1
   );--> statement-breakpoint
UPDATE "comments"
   SET "resolved_by_user_id" = (
     SELECT u.user_id FROM "user_tokens" u
      WHERE u.revoked_at IS NULL
      ORDER BY u.created_at ASC LIMIT 1
   )
 WHERE "resolved_by" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" DROP COLUMN "resolved_by";--> statement-breakpoint

-- plans --------------------------------------------------------------------
ALTER TABLE "plans" ADD COLUMN "updated_by_user_id" text;--> statement-breakpoint
UPDATE "plans" p
   SET "updated_by_user_id" = (
     SELECT u.user_id
       FROM "user_tokens" u
      WHERE u.revoked_at IS NULL
      ORDER BY u.created_at ASC
      LIMIT 1
   )
 WHERE p."updated_by" = 'dev';--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN "updated_by";
