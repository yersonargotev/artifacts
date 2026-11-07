ALTER TABLE `artifact` ADD `slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_owner_project_slug_idx` ON `artifact` (`owner_id`,coalesce(`project`, ''),`slug`) WHERE `slug` is not null;
