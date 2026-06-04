CREATE TABLE `spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `workspaces` (`id`, `name`) VALUES ('wsp_default', 'default') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO `spaces` (`id`, `workspace_id`, `name`) VALUES ('spc_00000000000000000000DEFAUL', 'wsp_default', 'General') ON CONFLICT DO NOTHING;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`space_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'unapproved' NOT NULL,
	`connect_token` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_threads`("id", "workspace_id", "space_id", "title", "description", "status", "connect_token", "created_at", "updated_at")
SELECT "id", "workspace_id", 'spc_00000000000000000000DEFAUL', "title", "description", "status", "connect_token", "created_at", "updated_at" FROM `threads`;--> statement-breakpoint
DROP TABLE `threads`;--> statement-breakpoint
ALTER TABLE `__new_threads` RENAME TO `threads`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
