ALTER TABLE `spaces` ADD `sort_order` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `threads` ADD `sort_order` real DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `spaces` SET `sort_order` = CAST(strftime('%s', `created_at`) AS REAL);--> statement-breakpoint
UPDATE `threads` SET `sort_order` = CAST(strftime('%s', `created_at`) AS REAL);
