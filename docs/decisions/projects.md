# Projects as derived artifact labels

## Problem and decision

Owners need to group related artifacts and browse one group at a time from MCP, the CLI, and the panel. An artifact carries an optional project name in a nullable `project` column on its `artifact` row. A project exists while at least one of the owner's artifacts carries its name. `projects_list`, `GET /v1/projects`, and the panel sidebar group the owner's artifacts by that column. MCP, REST, and the CLI move one artifact through the public store command. The panel uses a private batch command over the same project column. There is no project table, no command that creates or deletes a project, and no empty project.

## Derived label instead of a project table

A `project` table referenced by a foreign key would give each project its own identity. That identity would allow a rename in one write, project metadata, and empty projects. None of these is a known requirement. A table would also add lifecycle commands, an orphan policy, and a join on every list.

The derived label makes creation free, because the first create or move with a new name brings the project into existence. Removal is also free, because moving or deleting the last member makes the project disappear. The `artifact_owner_project_idx` index on `(owner_id, project)` serves both the grouping and the equality filter.

If renaming, metadata, or empty projects become requirements, a migration can create one table row per distinct `(owner_id, project)` pair and point artifacts at it.

## Name rules

`projectNameSchema` normalizes names to NFC and trims them. A name contains 1 to 80 characters and no control characters. Grouping ignores letter case. Inside the create or move transaction, the store compares the requested name with the owner's existing project names using `toLowerCase()`. On a match it adopts the stored spelling. Otherwise it stores the requested spelling. List and library filters resolve their name the same way and then match the stored spelling exactly, which uses the index.

The comparison runs in the store rather than in SQL because SQLite `lower()` folds only ASCII. A SQL comparison would keep `Éxito` and `éxito` apart. Each owner has few distinct project names, so reading them for the comparison is cheap. Projects are listed in English collation order with an exact tie-break, which ignores letter case and places accented names beside their base letters.

## Not part of the revision snapshot

A project is mutable artifact-level organization. A snapshot is the immutable content of a revision. A project inside the snapshot would make every move create a revision and change its digest. It would also appear in revision comparisons, exports, and publications. Instead, `artifacts_move`, `PUT /v1/artifacts/:id/project`, and the panel's move form update only the artifact row. A move never creates a revision and never changes the publication. Exports and published pages do not contain the project.

Move is a command with an owner-scoped receipt like the other mutations. An exact retry returns the original result, and a changed command under the same request ID fails with `request_conflict`. The panel move form carries its request ID like the deletion form, so a resubmitted form replays the receipt instead of moving the artifact again. Moving to the current project succeeds without change. Deleting the artifact invalidates its public single-artifact move receipts along with its other content-bearing receipts.

The private `panel_move` command accepts up to 25 unique IDs. It validates every ID, deduplicates and sorts the selection, and normalizes the submitted project name before hashing. Stored canonical spelling is resolved once inside the transaction after receipt lookup. This keeps the request hash independent of later membership changes. One owner-authorized transaction reads the selection, updates the changing owned rows once, and persists one receipt. Missing or foreign IDs appear only as submitted IDs in `missing`; no foreign title or project is returned.

A panel receipt records `{ project, moved, unchanged, missing }` as a historical result. Later deletion or reassignment does not rewrite it or make a replay move the survivors again. The deletion scrub targets a top-level `artifactId`, which this batch result deliberately lacks. A partial result means some submitted IDs were unavailable, not that a transaction partly committed. A changed selection, destination, or command kind under the same request ID conflicts. Forms opened before the route migration can therefore receive 409 when an existing public `move` receipt meets `panel_move`.

The native `/move` page preserves submitted fields and the request ID for invalid or uncertain outcomes. Uncertain retries preserve the original move or remove intent. Once a non-redirect POST outcome exists, a non-domain failure while reading optional titles or workspace data cannot replace that outcome. Authorization errors still terminate the request. A successful move redirects to the receipt's project; removal redirects to `/?unfiled=1`. Legacy single-artifact move URLs redirect with 308 for both GET and POST.

## Compatibility and rollout

Migration `0002` adds the nullable column and its index without rewriting rows. Existing artifacts have no project. Create and list inputs without `project` keep their receipt fingerprints. Create and update receipts committed before this change lack the field. The store replays them with `project: null`, which matches those artifacts when the receipt was written.

Every `ArtifactRead` and artifact summary now includes `project`. The contract schemas are strict. Published client `0.1.0-beta.3`, and the CLI built on it, parse artifact responses strictly and will reject the new `project` field with `invalid_response`. A new client and CLI beta must ship together with the server. The publication Worker also parses the panel's internal read strictly, so the panel and publication Workers must be released together, after the migration is applied.
