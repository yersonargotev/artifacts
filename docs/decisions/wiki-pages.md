# Wiki pages: stable slugs, search, and batch commands

Status: accepted, 2026-11-07 (proposed 2026-11-06). Spec [#87](https://github.com/yersonargotev/artifacts/issues/87) implemented this decision through its tickets, and every one has landed. The public packages ship it from 0.1.0-beta.11: slugs [#88](https://github.com/yersonargotev/artifacts/issues/88) (create and read, shipped) and [#89](https://github.com/yersonargotev/artifacts/issues/89) (move, shipped), links [#90](https://github.com/yersonargotev/artifacts/issues/90) (shipped), search [#91](https://github.com/yersonargotev/artifacts/issues/91) (FTS5 spike, done), [#92](https://github.com/yersonargotev/artifacts/issues/92) (Markdown and text, shipped), and [#93](https://github.com/yersonargotev/artifacts/issues/93) (HTML and design, shipped), and batch [#94](https://github.com/yersonargotev/artifacts/issues/94) (payload spike, done), [#95](https://github.com/yersonargotev/artifacts/issues/95) (create and update, shipped), [#96](https://github.com/yersonargotev/artifacts/issues/96) (move, shipped), and [#97](https://github.com/yersonargotev/artifacts/issues/97) (edit, shipped).

## Problem and decision

An owner wants to keep an LLM-maintained wiki (Karpathy's pattern: an index, a log, and many small cross-linked Markdown pages) in Artifacts, so that any agent with the MCP connection or the CLI can read and maintain it without a Git checkout. One artifact per page and one project per wiki already give per-page history, grouping, sharing, and OAuth access from Claude, Codex, and the CLI.

Three operations that a file-system wiki gets for free are missing:

1. **Addressing a page by name.** Pages link to each other by path (`../concepts/rag.md`). Artifacts only offers opaque IDs, so an agent must list the project to find a page and cannot write a link before the target exists.
2. **Finding pages by content.** A wiki query starts by searching (the agent equivalent of `grep`). Without search, an agent must list and fully read every page, and the cost grows with the wiki.
3. **Changing several pages together.** One ingest updates the source page, three to ten concept and entity pages, the index, and the log. Today that is one command per page. A failure in the middle leaves the index pointing at pages that were never written.

The decision adds three capabilities to the store, exposed through MCP, REST, and the CLI. The store keeps owning authorization, receipts, and concurrency:

- an optional **slug** per artifact, unique within the owner's project, with reads and links resolved by `(project, slug)`;
- a **full-text index** of each artifact's head revision and an `artifacts_search` command;
- an **`artifacts_batch` command** that applies up to 25 create, update, edit, and move operations in one transaction under one receipt.

No wiki-specific content kind is added. A wiki is a convention over these primitives: a project, a page with slug `index`, a page with slug `log`, and Markdown pages whose relative links name slugs.

## Stable slugs

A slug is mutable artifact-level organization, like the project label, so it lives in a nullable `slug` column on the `artifact` row and not in the revision snapshot. A rename never creates a revision, never changes a digest, and never appears in exports or publications. This follows the same reasoning as [projects](projects.md).

Rules:

- A slug is 1 to 160 characters of lowercase ASCII kebab-case segments separated by `/`, for example `concepts/rag` or `index`. A trailing `.md` is rejected on input. It is not part of the name.
- The pair `(owner_id, project, slug)` is unique when `slug` is not null. Artifacts without a project share one unfiled namespace. A unique index on `(owner_id, coalesce(project, ''), slug)` enforces this. The project component uses the stored canonical spelling the store already resolves.
- `create` and `move` accept an optional `slug`. Moving to another project keeps the slug and fails with `slug_conflict` if the destination already uses it. `move --no-slug` clears it. Both commands keep their existing receipts. Inputs without `slug` keep their current receipt fingerprints.
- `artifacts_read`, REST, and `artifacts read` also accept a locator `{ project, slug }` in place of the ID. Summaries and `ArtifactRead` gain a `slug` field.

What shipped in [#88](https://github.com/yersonargotev/artifacts/issues/88):

- `slugSchema` validates the rule above without normalizing, and a trailing `.md` gets its own message that suggests removing it. `create` accepts an optional `slug`, and `ArtifactRead` and `ArtifactSummary` carry `slug: string | null` for the owner. Shared reads, the shared-with-me list, publications, exports, and digests never carry it.
- Migration `0005` adds the nullable `slug` column and the partial unique index `artifact_owner_project_slug_idx`. drizzle-kit 0.31 splits the `coalesce` expression on its comma, so the generated SQL is hand-corrected and the snapshot matches the schema.
- The store checks the slug inside the create transaction and fails with `slug_conflict`, whose details name the `slug`, the stored `project`, and the holder's `artifactId`. The index is the backstop, not the reported error. Because the slug moves with its artifact, the existing project move and the panel's bulk move run the same check against the destination and fail with `slug_conflict` instead of reaching the index. REST maps the code to 409.
- `readSchema` is one strict object with an `artifactId`, `project`, and `slug` plus a refinement: exactly one of `artifactId` or `slug`, and `project` only with `slug`. MCP needs a top-level object schema, so a union is not used. An omitted `project` reads the unfiled namespace. The project resolves to its stored spelling, and the locator matches only the caller's owned artifacts, so an unknown locator and an unknown ID both fail with `not_found`. Publication reads keep a separate ID-only `readByIdSchema`.
- REST reads a locator at `GET /v1/lookup?project=NAME&slug=SLUG`, with the same optional `revisionId` and `response` as `GET /v1/artifacts/:id`. `GET /v1/artifacts/:id` cannot take the locator because IDs are arbitrary strings and a slug may contain `/` or equal a subroute such as `history`. A query on the collection would overload `GET /v1/artifacts`, which lists. A separate collection keeps both routes unambiguous. The typed client's `read()` picks the route from its input.
- The CLI adds `create --slug SLUG` and `read --slug SLUG [--project NAME]`, which takes exactly one of an ID or `--slug`. The panel shows the slug on library cards and under Información.
- Create inputs without a slug keep their receipt fingerprints, and receipts written before slugs replay with `slug: null`.

What shipped in [#89](https://github.com/yersonargotev/artifacts/issues/89):

- `moveSchema` makes `project` optional and adds an optional, nullable `slug`. A refinement requires at least one of them, so the schema stays one top-level object for MCP. An absent field keeps its value, `null` clears it, and a value sets it. `move ID --slug x` renames without restating the project. Move inputs without a slug keep their receipt fingerprints because the parsed input never gains defaults.
- The store resolves the target project and slug, runs the same `slug_conflict` check against the target pair, and updates both columns. A slug change creates no revision and leaves the publication alone.
- The panel's bulk move checks every selected artifact before it fails. Its single `slug_conflict` names the destination `project` and lists `conflicts: [{ artifactId, slug }]`: both members of a duplicate inside the selection and each mover whose slug the destination already holds. Nothing moves, and no receipt is written, so the same request ID can retry another destination.
- The panel's move page answers that error with 409 and an alert that names the destination and lists each conflicting artifact by title and slug, then shows the move form again. The single-artifact move reaches the same page and no longer shows the generic 409 error page.
- REST keeps `PUT /v1/artifacts/:id/project` for the slug change. `artifacts_move` and the typed client take the same input. The CLI adds `move ID [--project NAME | --no-project] [--slug SLUG | --no-slug]`, which needs at least one option and rejects both options of a pair.
- The move result stays `{ artifactId, project }`. Published clients up to `0.1.0-beta.8` parse it strictly, so an unchanged result keeps them working. Callers read the artifact to see its new slug.

What shipped in [#90](https://github.com/yersonargotev/artifacts/issues/90):

- The panel detail of a Markdown revision carries `links`: each relative link once, by href, in document order with its first text. Other content kinds carry `null`. The `marked` lexer finds the links, so code spans, fenced code, and images are skipped and reference-style links count. Raw HTML `<a>` is not parsed.
- Links with a scheme (`https:`, `mailto:`), protocol-relative links, and pure fragments are not listed. The path before `?` or `#` resolves against the page slug's directory, or the project root when it starts with `/`. `.` and empty segments are skipped, and `..` above the root is broken as `outside`. A relative link from a page without a slug is broken as `unslugged`. The `.md` suffix is dropped and the path is percent-decoded and checked with `slugSchema`. A path that fails is broken as `missing`.
- One query inside the detail transaction looks up every candidate slug among the owner's artifacts in the same project, with the head revision's title. An unmatched slug is broken as `missing`. Links resolve against current slugs even when an older revision is selected.
- The detail's `Vista previa` tab showed an `Enlaces` section under the preview with every relative link. [#117](https://github.com/yersonargotev/artifacts/issues/117) narrowed it to broken links.
- This is panel-only: MCP, REST, the CLI, `ArtifactRead`, and the typed client are unchanged.

What shipped in [#117](https://github.com/yersonargotev/artifacts/issues/117), decided in [#98](https://github.com/yersonargotev/artifacts/issues/98):

- The panel preview renders the owner's Markdown with `marked`. Headings, lists, tables, code, and emphasis render. Raw HTML tokens, block and inline, render as escaped text, so a `<script>`, `<a>`, or `<img onerror>` in the page is shown, not interpreted.
- Each link token is looked up by href in the same `links` the detail resolves, so the render and `Enlaces` share one resolution. A resolved relative link becomes `<a href="/artifacts/ID" target="_top">`. A broken one is a marked `<span>` whose title names the reason, not a link. `http:` and `https:` open in a new tab with `rel="noopener noreferrer"`. `mailto:` and pure fragments stay plain links. Any other scheme, and a protocol-relative link, render as text only. Only `data:image/` images render, because the frame's CSP allows only `data:` images. Others show their alt text.
- The panel store's `preview` read authorizes `artifacts:read`, checks the owner, and returns the selected revision with its `links`, without the history or workspace the detail loads. The preview route uses it for every content kind.
- The Markdown frame's CSP keeps `script-src 'none'` and adds exactly `allow-top-navigation-by-user-activation allow-popups allow-popups-to-escape-sandbox` to its `sandbox` directive. The iframe's `sandbox` attribute adds the same tokens. Neither grants scripts or `allow-same-origin`. The Markdown response omits `Connection-Allowlist: ()`, because Chrome counts the frame's link navigations as its connections and fails them with `ERR_NETWORK_ACCESS_REVOKED`. The frame cannot run scripts, so the header has no other connection to block. HTML, text, and design previews keep their documents, policies, and empty allowlist.
- `Enlaces` lists only broken links and is absent when there are none.
- Publication is unchanged. A published Markdown page still shows its source as inert text.

Link resolution: in a Markdown page, a relative link without a scheme (`../concepts/rag.md`, `rag.md#history`) is resolved against the page's own slug as a path, its `.md` suffix is dropped, and it is looked up in the same project. The owner panel's rendered preview turns a resolved link into a navigation to the target artifact, and an unresolved link into marked plain text. This keeps the same link syntax valid in a Git checkout of the wiki and in Artifacts, which is what makes two-way sync possible. Publication keeps its current inert rendering in this decision. Rendering links for viewers requires deciding what a viewer sees when the target is unpublished or not shared, which is out of scope.

## Full-text search

The store maintains one FTS5 row per artifact for its **head revision only**. History stays reachable through `artifacts_history`. Indexing every revision would multiply the index without serving the query use case.

- Table: `artifact_search(artifact_id UNINDEXED, title, description, body)` with `tokenize='unicode61 remove_diacritics 2'`, so `busqueda` matches `búsqueda`.
- `body` holds the content text for `markdown` and `text`, and the text content with tags removed for `html`. `design` indexes only its metadata. Attachments are not indexed.
- The store writes the row inside the same transaction as every command that changes a head snapshot: `create`, `update`, `edit`, and `batch`. The row holds no owner, project, or slug, so `move` writes nothing to the index. One `AFTER DELETE` trigger on `artifact` removes the row. The HTML text extraction stays store logic.
- `artifacts_search { query, project?, limit (1–25, default 10), cursor? }`, `GET /v1/search`, and `artifacts search QUERY [--project NAME]` return `{ artifactId, project, slug, title, snippet, rank }` items ordered by `bm25` with an ID tie-break. The command authorizes `artifacts:read` and the live session, and it searches only the caller's owned artifacts. Shared-with-me artifacts are excluded until a separate decision covers search over shared publications.
- The query is plain text. The store tokenizes it and quotes each term, so FTS5 operators in user input cannot cause syntax errors or unbounded queries. All terms must match. Advanced syntax is deferred until a need appears.
- A migration creates the table and backfills it from current head revisions. drizzle-kit does not model virtual tables, so the migration is hand-written. `drizzle-kit generate --custom --name=artifact_search` adds the journal entry, a snapshot equal to the previous one, and an empty SQL file. The file then holds the `CREATE VIRTUAL TABLE` and the backfill `INSERT ... SELECT` from `artifact` joined to its head `artifact_revision`, reading `json_extract(snapshot, '$.metadata.title')`, `'$.metadata.description'`, and `'$.content.text'`, with statements separated by `--> statement-breakpoint`. Later `generate` runs ignore the table, because drizzle-kit diffs `schema.ts` against the last snapshot and never introspects the database. Never apply `drizzle-kit push` or `pull` to this database, because both introspect it and would see the FTS5 table and its shadow tables. The SQL file must not stay empty. `migrate()` sends a comment-only file as an empty statement, Turso rejects the batch with `SQL_PARSE_ERROR`, and the deploy's migrations roll back.

FTS5 was validated on 2026-11-07 against a throwaway Turso database (`fts5-spike`, SQLite 3.47.0, since destroyed) through the `@libsql/client` 0.18.0 web client that the Workers load. The database reports `ENABLE_FTS5`. It accepts the table above with `unicode61 remove_diacritics 2`, inside `transaction('write')` and `batch(..., 'write')`. `bm25` ranks and `snippet` highlights, `busqueda` matches `Búsqueda`, an `owner_id` filter excludes other owners, and quoted terms make operator text such as `NEAR(` match nothing instead of failing with `fts5: syntax error`. drizzle `migrate()` applied migrations `0000` to `0006` with the hand-written FTS5 migration, and a second run was a no-op. A later schema change generated only its own `ALTER TABLE`. The `instr` fallback is therefore not needed. The record is in [#91](https://github.com/yersonargotev/artifacts/issues/91).

What shipped in [#92](https://github.com/yersonargotev/artifacts/issues/92):

- Migration `0006` is the hand-written FTS5 migration: `CREATE VIRTUAL TABLE artifact_search`, the trigger, and the backfill from Markdown and text heads. The table is declared for drizzle in the store module, not in `schema.ts`, so `generate` never sees it.
- The table holds `artifact_id`, `title`, `description`, and `body`, but no `owner_id`, `project`, or `slug`. Search joins `artifact` on `artifact.id = artifact_search.artifact_id` and reads the owner, project, and slug from that row. `move` and the panel's bulk move therefore need no index write, and the index cannot drift from a move. The first draft of this decision stored those columns in the row.
- `create` and `update` call one store helper inside their transaction. It deletes the artifact's row and inserts the new head's title, description, and content when the kind is `markdown` or `text`. An update to another kind leaves no row. HTML and design are not indexed until [#93](https://github.com/yersonargotev/artifacts/issues/93).
- `artifact_search_delete AFTER DELETE ON artifact` deletes the row for store `delete` and for owner foreign-key cascades. This decision had ruled out triggers because HTML extraction and move rules are store logic. This trigger carries neither: deletion needs no store rule, and the join removed the move rule. A trigger also covers cascades, which never pass through the store.
- `artifact_id` is `UNINDEXED`, so deleting by it scans the whole FTS5 table. Each create, update, and delete pays that scan once. It is acceptable at the current scale. A large index would key the row by the FTS5 `rowid` instead.
- `searchSchema` is strict: `query` trimmed to 1 to 256 characters, optional `project`, `limit` from 1 to 25 with default 10, and `cursor`. The store splits the query on whitespace, wraps each chunk in double quotes with inner quotes doubled, and joins the phrases, so FTS5 reads them as an implicit AND. `"foo" OR NEAR(` becomes the three plain terms `foo`, `or`, and `near`, and punctuation-only chunks match nothing, with no syntax error. The spike's note that `NEAR(` matches nothing is narrower than this: quoted, it matches the word `near`.
- The cursor is the decimal offset of the next page, at most six digits. A page reads `limit + 1` rows ordered by `bm25(artifact_search)` and then `artifact.id`, and `nextCursor` is the next offset or null. An offset cursor can skip or repeat a row when the index changes between pages, which is acceptable for search.
- Items use `artifactId` instead of the `id` drafted above, to match every other contract. `rank` is the raw `bm25` score, where lower is more relevant, and `snippet` is `snippet(artifact_search, -1, '**', '**', '…', 16)`.
- `bm25` statistics, such as document count and average column length, span the whole table and therefore every owner. Another owner's pages can shift a caller's ranks but never appear in the results, because the join filters on `artifact.owner_id`.
- Search runs inside the store transaction after `authorize(connection, actor, 'artifacts:read')`, like `list`, and writes no receipt. The project filter resolves to its stored spelling with the same helper as `list`. Shared-with-me artifacts never appear.
- MCP adds `artifacts_search`, REST adds `GET /v1/search?query=&project=&limit=&cursor=`, the typed client adds `search()`, and the CLI adds `artifacts search QUERY [--project NAME] [--limit N] [--cursor CURSOR]`.
- The identity copy (`scripts/migrate-identity.ts`) now lists tables through `pragma_table_list`, keeps `table` and `virtual` entries, and skips FTS5 shadow tables. It copies the index by inserting into the virtual table, which rebuilds the target's index. Copying the shadow tables directly would corrupt it.

What shipped in [#93](https://github.com/yersonargotev/artifacts/issues/93):

- Every head now has a row. The store maps each content kind to its indexed body in one table typed as a record over the kind, so a new kind fails to compile until it chooses a body. Markdown and text index their content, HTML indexes its visible text, and design indexes an empty body.
- HTML text comes from `htmlparser2` callbacks in the store module. Text inside `script` and `style` is skipped, and every open and close tag adds a space, so `<p>a</p><p>b</p>` yields two words. Entities are decoded, whitespace collapses, and the result is trimmed. Tag names, attribute names, and attribute values never reach the index, and the snippet therefore holds no markup. The library is pure JavaScript and bundles into the Workers.
- A design is found by its title and description only. Its canvas JSON is layout, not prose, and its boards are attachments.
- Attachments are never read for any kind.
- No migration backfills HTML and design. SQL cannot remove HTML markup without duplicating the extraction rule, and a migration that ran before the new code deployed would be undone, because the old code drops the row of an HTML head on every update. Instead `reindexSearch(db)` rebuilds the index from the store's own rule, and an operator runs it with `pnpm search:reindex` after the deploy.
- `reindexSearch` pages over artifact IDs in order and rewrites each artifact's row in its own write transaction, rereading the head inside it. A crash leaves every finished artifact indexed, a rerun converges to one row per artifact, and a concurrent update is never overwritten with a stale head. It reindexes every kind, so it also repairs any drifted row, and it returns the number of artifacts it indexed.

## Batch commands

`artifacts_batch { requestId, operations[1..25] }` (`POST /v1/batch`, `artifacts batch --command FILE`) runs every operation in one owner-authorized transaction and persists one receipt. The `panel_move` command already uses this shape.

The writes travel as one libSQL `batch(..., 'write')` request, not as an interactive `transaction('write')`. An interactive transaction sends every statement as its own HTTP exchange. A create costs about 8 exchanges, so 25 operations need about 200 subrequests from the Worker. The reads that decide a batch (receipt, live session, slugs, expected revisions) happen before the write request, and the write statements must fail the whole batch when a read no longer holds. The unique index on owner, project, and slug already fails a raced slug claim.

- Each operation is one of `create`, `update` (with `expectedRevisionId`), or `move`. The CLI and the typed client also accept `edit` (partial changes), which they prepare into an `update` with `expectedRevisionId` before submission; it is not a member of the server's batch schema. Operations address existing artifacts by ID or by `{ project, slug }`. A `create` earlier in the batch can be addressed by its slug from later operations.
- The batch is all-or-nothing. The first failure aborts the transaction and returns its operation index and domain error, such as `revision_conflict` or `slug_conflict`. Nothing is committed.
- Each operation obeys the existing per-revision limits (1 MiB decoded, 32 attachments). The whole batch has a ceiling of 4 MiB of decoded content and metadata, counted as the per-revision limit counts it. A 4 MiB batch of base64 attachments encodes to a 5.6 MB request, within the 8 MiB REST and MCP limit. 6 MiB of attachments encodes to 8,396,005 bytes and exceeds it.
- The receipt records `{ results: [{ index, id, revisionId }] }`. An exact retry returns it. The same request ID with a changed batch fails with `request_conflict`. Deleting an artifact scrubs it from receipts that name it, as for other content-bearing receipts.
- Batches never publish. Publication stays a separate, deliberate command per artifact.

The ceiling was measured on 2026-11-07 with a throwaway Worker (`artifacts-batch-spike`) and Turso database (`batch-spike`), both since destroyed. The Worker bundled the store's `receipt`, `authorize`, and create logic with the production Worker database client, and Workers Observability reported CPU per invocation. Each scenario ran 25 creates with a project and slug, at least 5 successful runs for every 4 MiB case. Medians with ranges follow.

| Batch | Request bytes | CPU ms | Write request ms |
| --- | --- | --- | --- |
| Typical ingest, 13 operations (200 KiB source, 10 pages of 6 KiB, index, log) | 277,328 | 16 (13–19) | 248 (120–325) |
| 25 × 1 KiB Markdown | 31,315 | 10 (10–45) | 387 (142–745) |
| 4 MiB Markdown | 4,200,040 | 93 (86–119) | 1,355 (1,054–1,782) |
| 4 MiB HTML | 4,202,615 | 260 (207–268) | 1,670 (1,066–2,293) |
| 4 MiB base64 attachments | 5,599,805 | 108 (75–110) | 772 (526–1,293) |
| 6 MiB Markdown | 6,297,640 | 170 (113–260) | 2,283 (1,870–2,986) |

- CPU grows with bytes. Markdown and attachments cost about 25 ms per MiB, and HTML about 65 ms per MiB because the search index extracts its text with `htmlparser2`.
- Write time also grows with bytes sent to Turso. Text travels twice, once in the snapshot and once in the search row. From a local client, the same 4 MiB batch took a median of 2,093 ms with the search row and 1,165 ms without it.
- The Worker database client aborts any HTTP exchange after 5 seconds. A 4 MiB batch peaked at 2.3 seconds, and 6 MiB at 3.0 seconds, so 4 MiB keeps about twice the headroom.
- The interactive form of the same transaction failed with `Too many subrequests by single Worker invocation` at its 50th subrequest, on the sixth operation. Five operations fit, in 47 exchanges and 1.6 seconds. The aborted transaction kept the database write lock for 6 to 10 seconds, and other writes in that window timed out.
- The 13-operation ingest used about half of the 25-operation limit and 7% of the byte ceiling, so 25 operations cover a typical ingest.

The account runs on the Workers Free plan, whose CPU limit is 10 ms per invocation. Cloudflare let the spike Worker exceed it in short bursts. After about 35 requests in three minutes, most of them using 40 to 270 ms of CPU, it failed every request with `exceededCpu` at 10 ms, including the 31 KB batch, and recovered within three minutes. A paced run hit the limit again on one 6 MiB batch. Every batch measured, the typical ingest included, needs more than 10 ms of CPU. Batch commands therefore require the Workers Paid plan, which allows up to 5 minutes of CPU per request. The account moved to Workers Paid on 2026-11-07, after the spike. The record is in [#94](https://github.com/yersonargotev/artifacts/issues/94).

What shipped in [#95](https://github.com/yersonargotev/artifacts/issues/95):

- `batchSchema` is one strict object with `requestId` and 1 to 25 `operations`, so MCP gets a top-level object schema. `batchOperationSchema` is a union on `op` with `create` and `update` members, and [#96](https://github.com/yersonargotev/artifacts/issues/96) adds `move` as a new member. [#97](https://github.com/yersonargotev/artifacts/issues/97) adds `edit` on the client side only. A `create` takes the create fields without `requestId` and `response`. An `update` takes a complete `snapshot` and the `readSchema` locator rule: exactly one of `artifactId` or `slug`, and `project` only with `slug`. zod 4 accepts the refined member inside the union, so the rule reports at the operation's path.
- `snapshotBytes` computes the per-revision decoded byte count once, for the 1 MiB revision limit and the 4 MiB batch ceiling.
- Results use `artifactId` instead of the `id` drafted above, as search did. `index` is the 0-based position in `operations`, in results and in errors.
- `expectedRevisionId` is optional on an update and must equal the head at that point in the batch. It may be omitted only when an earlier operation in the same batch wrote that head, because the caller cannot know a revision ID the batch generates. Otherwise the update fails like a single update, with `conflict`, `Artifact head changed`, and `currentRevisionId`. The `revision_conflict` named above is this existing code.
- Every domain error keeps its usual code and details and adds `index`: `slug_conflict` with the holder, `not_found` for an unknown ID or locator, and `conflict`.
- `store.batch` reads before it writes, on the plain database: `authorize` with `artifacts:write` and the live session, then in parallel the receipt, the owned projects for canonical spellings, and one query for the owner's artifacts named by ID or by any slug in the batch, joined to the head revision's sequence. A pure planner walks the operations over an in-memory namespace keyed by stored project and slug. A create with a new project fixes its spelling for later operations.
- The writes and the receipt go as one `$client.batch(statements, 'write')`, built with drizzle query builders and `toSQL()`. Per create: artifact, revision 1, and search row. Per update: revision with the planned parent and sequence, head update guarded by the planned head, and the search row rewritten from the same `searchRow` as `indexHead`. The receipt is last.
- The write request has no read inside it, so it fails when a read stopped holding. The unique `(artifact_id, sequence)` index catches a concurrent update, the foreign key from `artifact_revision` to `artifact` a concurrent delete, the slug index a raced slug, and the `artifact_command` primary key a raced receipt. On a `SQLITE_CONSTRAINT` error anywhere in the cause chain, the store reads and plans again, so the caller gets the precise domain error with its index, or the receipt the race committed. It tries three times before rethrowing and retries `SQLITE_BUSY` and `SQLITE_LOCKED` with the same backoff as `writeTransaction`. Tests force each race by committing a competing command right before the write request. The local libSQL build enforces foreign keys on every pooled connection, so the delete race fails inside the batch without an extra guard.
- The live session is checked in the read phase only. A session revoked between the read and the write request does not stop that one batch.
- Deleting an artifact also scrubs the receipts whose `$.results[*].artifactId` names it, through `json_each`, so a retry of that batch fails with `not_found`.
- MCP adds `artifacts_batch`, REST adds `POST /v1/batch`, which answers 200, the typed client adds `batch()`, and the CLI adds `artifacts batch --command FILE`, retained before submission so `artifacts retry` replays it.

What shipped in [#96](https://github.com/yersonargotev/artifacts/issues/96):

- `batchOperationSchema` gains a `move` member with the `moveSchema` fields and the same rule: `project`, `slug`, or both, where an absent field keeps its value and `null` clears it. The page is named by exactly one of `artifactId` or `from: { project?, slug }`. The flat `{ project, slug }` locator of an update cannot work here, because those fields already name the destination. A move by ID is therefore `moveSchema` without `requestId`, as a batch create is `createSchema` without it.
- The planner applies the `move` rules over its namespace. The destination project takes its canonical spelling, a slug held by another page fails with `slug_conflict` and `index`, and a slug the page already holds is no conflict. The page leaves its old key and takes the new one, so later operations address it by the new slug and a later create can claim the freed slug. The statements run in operation order, so the unique slug index accepts such chains and swaps.
- A move with no `slug` keeps the page's slug at the destination, which the batch input does not name. The read phase therefore also selects pages whose slug equals the slug of any artifact named by ID.
- A move result is `{ index, artifactId, revisionId }` like the others, with the head the move left in place, because a move writes no revision. The result schema is unchanged, and no client with `batch()` has been released yet.
- Per move, the write request updates the artifact's project and slug only where it stands at the planned location, then runs a guard that inserts a `NULL` owner into `artifact_command` unless the artifact now stands at its destination under the planned head. A concurrent delete, move, or update therefore fails a `NOT NULL` constraint, and the store plans again: a delete yields `not_found` with `index`, a move that keeps one field keeps the value the concurrent move set, and the result names the head a concurrent update wrote. The guard cannot use `changes()`. After an FTS5 insert earlier in the same batch, a later update that matches no row left `changes()` nonzero in local libSQL, measured on 2026-11-07.
- Search needs no write for a move, because it reads the project and slug from `artifact`. A search after the batch commits finds the moved page under its new project and slug.

What shipped in [#97](https://github.com/yersonargotev/artifacts/issues/97):

- `edit` is a client-side operation. `batchSchema`, REST, MCP, and the store are unchanged. The contracts' `/workflow` export adds `batchCommandSchema`, which accepts the `batchOperationSchema` members plus `{ op: 'edit', changes }` with the `readSchema` locator rule and the `changes` of `prepareArtifactEdit`.
- `prepareBatch(client, command)`, re-exported by the typed client, reads the head of every edited page in parallel, merges the changes with the same helper as `prepareArtifactEdit`, and emits `{ op: 'update', <the edit's locator>, expectedRevisionId: head, snapshot }`. Keeping the edit's own locator keeps the server's semantics: a slug resolves at that point in the batch. Other operations pass through unchanged, and the result is parsed by `batchSchema`, so the 4 MiB ceiling applies to the merged snapshots.
- A page changed after the read, or written by an earlier operation in the same batch, fails at the server with `conflict` and the edit's `index`. An edit therefore addresses a page that exists before the batch; the batch uses `update` for a page it already creates or writes. Edits are not chained across operations.
- A read that fails, such as `not_found` for a page the batch would create, raises `BatchOperationError` with the operation's `index` and the original error as `cause`, before anything is retained or sent. The CLI prints the cause's code and details with `index` added, as for a server batch failure.
- `artifacts batch --command FILE` retains the prepared `batchSchema` command, so `artifacts retry` replays exactly what was prepared, like `artifacts edit`. A file without edits is retained and sent as before.

## Alternatives considered

- **One artifact holding the whole wiki** (index as content, pages as attachments). This was rejected because 32 attachments and 1 MiB per revision cap the wiki almost immediately, and every page edit would rewrite the whole wiki.
- **Keeping the wiki only in Git and publishing to Artifacts.** This remains the starting point while these capabilities ship. It does not give agents without a checkout write access or search.
- **An external search index or vector store.** This was rejected because it adds a second store that the authorization boundary must cover, while FTS5 runs in the existing database and transaction.
- **A `page` table separate from `artifact`.** This was rejected because a page is an artifact. A parallel entity would duplicate revisions, sharing, and receipts.

## Compatibility and rollout

The new `slug` field on `ArtifactRead` and summaries is a strict-schema change. As with `project`, published clients reject unknown fields, so a new client and CLI beta (`0.1.0-beta.8` for slugs) ship with the server, and the panel and publication Workers release together after the migrations.

The three parts ship in order: slugs first, because search results and batch operations address pages by slug, then search, then batch. Each part is independently useful.

## Open questions for validation

- Should link resolution in the panel reach across projects (`../../other-project/...`)? The proposal says no.
