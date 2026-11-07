CREATE VIRTUAL TABLE `artifact_search` USING fts5(`artifact_id` UNINDEXED, `title`, `description`, `body`, tokenize='unicode61 remove_diacritics 2');--> statement-breakpoint
CREATE TRIGGER `artifact_search_delete` AFTER DELETE ON `artifact` BEGIN DELETE FROM `artifact_search` WHERE `artifact_id` = old.`id`; END;--> statement-breakpoint
INSERT INTO `artifact_search` (`artifact_id`, `title`, `description`, `body`)
SELECT a.`id`, json_extract(r.`snapshot`, '$.metadata.title'), coalesce(json_extract(r.`snapshot`, '$.metadata.description'), ''), json_extract(r.`snapshot`, '$.content.text')
FROM `artifact` a JOIN `artifact_revision` r ON r.`artifact_id` = a.`id` AND r.`id` = a.`head_revision_id`
WHERE json_extract(r.`snapshot`, '$.content.kind') IN ('markdown', 'text');
