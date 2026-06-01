ALTER TABLE `threads` DROP COLUMN `connect_token_hash`;--> statement-breakpoint
ALTER TABLE `threads` ADD `connect_token` text NOT NULL DEFAULT '';
