CREATE TABLE `artifact` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`head_revision_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`id`,`head_revision_id`) REFERENCES `artifact_revision`(`artifact_id`,`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE INDEX `artifact_owner_idx` ON `artifact` (`owner_id`,`id`);--> statement-breakpoint
CREATE TABLE `artifact_command` (
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`result` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `request_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `artifact_publication` (
	`artifact_id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`version` integer NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`,`revision_id`) REFERENCES `artifact_revision`(`artifact_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `artifact_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`parent_revision_id` text,
	`sequence` integer NOT NULL,
	`author_user_id` text NOT NULL,
	`author_client_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`sha256` text NOT NULL,
	`snapshot` text NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artifact_id`,`parent_revision_id`) REFERENCES `artifact_revision`(`artifact_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_revision_membership_idx` ON `artifact_revision` (`artifact_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_revision_sequence_idx` ON `artifact_revision` (`artifact_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `publication_grant` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`artifact_id` text NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`callback` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `oidc_transaction` ADD `return_path` text DEFAULT '/' NOT NULL;
--> statement-breakpoint
CREATE TRIGGER artifact_revision_immutable
BEFORE UPDATE ON artifact_revision
BEGIN
  SELECT RAISE(ABORT, 'Artifact revisions are immutable');
END;
