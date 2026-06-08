ALTER TABLE `comments` DROP COLUMN `anchor_offset_hint`;--> statement-breakpoint
ALTER TABLE `comments` ADD `anchor_block_id` text;
