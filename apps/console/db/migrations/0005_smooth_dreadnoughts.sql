DROP TABLE `clarification_rounds`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_discussion_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`author` text NOT NULL,
	`text` text,
	`questions` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_discussion_messages`("id", "thread_id", "author", "text", "questions", "created_at") SELECT "id", "thread_id", "author", "text", NULL, "created_at" FROM `discussion_messages`;--> statement-breakpoint
DROP TABLE `discussion_messages`;--> statement-breakpoint
ALTER TABLE `__new_discussion_messages` RENAME TO `discussion_messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_discussion_messages_thread` ON `discussion_messages` (`thread_id`,`created_at`,`id`);