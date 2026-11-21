-- A rebuild instead of ALTER TABLE ADD places the metadata before the snapshot, so a list reads it without walking the snapshot's overflow pages. The migrator turns foreign keys off, so dropping the old table cascades to nothing.
CREATE TABLE `__new_artifact_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`parent_revision_id` text,
	`sequence` integer NOT NULL,
	`author_user_id` text NOT NULL,
	`author_client_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`sha256` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT '' NOT NULL,
	`snapshot` text NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artifact_id`,`parent_revision_id`) REFERENCES `artifact_revision`(`artifact_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_artifact_revision` (`id`, `artifact_id`, `parent_revision_id`, `sequence`, `author_user_id`, `author_client_id`, `created_at`, `sha256`, `title`, `description`, `kind`, `snapshot`)
SELECT `id`, `artifact_id`, `parent_revision_id`, `sequence`, `author_user_id`, `author_client_id`, `created_at`, `sha256`, json_extract(`snapshot`, '$.metadata.title'), coalesce(json_extract(`snapshot`, '$.metadata.description'), ''), json_extract(`snapshot`, '$.content.kind'), `snapshot`
FROM `artifact_revision`;
--> statement-breakpoint
DROP TABLE `artifact_revision`;--> statement-breakpoint
ALTER TABLE `__new_artifact_revision` RENAME TO `artifact_revision`;--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_revision_membership_idx` ON `artifact_revision` (`artifact_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_revision_sequence_idx` ON `artifact_revision` (`artifact_id`,`sequence`);--> statement-breakpoint
CREATE TRIGGER artifact_revision_immutable
BEFORE UPDATE ON artifact_revision
BEGIN
  SELECT RAISE(ABORT, 'Artifact revisions are immutable');
END;
