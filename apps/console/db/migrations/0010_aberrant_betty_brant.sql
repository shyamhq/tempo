CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`message_id` text,
	`reply_id` text,
	`mime` text NOT NULL,
	`byte_len` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `discussion_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reply_id`) REFERENCES `replies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "one_parent" CHECK(("attachments"."message_id" IS NULL) <> ("attachments"."reply_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_att_message` ON `attachments` (`message_id`);--> statement-breakpoint
CREATE INDEX `idx_att_reply` ON `attachments` (`reply_id`);