ALTER TABLE `plans` DROP COLUMN `body_blocks`;--> statement-breakpoint
ALTER TABLE `plans` ADD `body_pm_json` text;
