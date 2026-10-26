CREATE TABLE `artifact_share` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_share_value_idx` ON `artifact_share` (`artifact_id`,`kind`,`value`);--> statement-breakpoint
CREATE INDEX `artifact_share_recipient_idx` ON `artifact_share` (`kind`,`value`);