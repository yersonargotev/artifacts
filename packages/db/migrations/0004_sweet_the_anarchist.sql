CREATE TABLE `artifact_invitation_budget` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`used` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
