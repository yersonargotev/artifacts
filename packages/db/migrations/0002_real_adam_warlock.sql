ALTER TABLE `artifact` ADD `project` text;--> statement-breakpoint
CREATE INDEX `artifact_owner_project_idx` ON `artifact` (`owner_id`,`project`);