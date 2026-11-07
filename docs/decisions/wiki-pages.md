# Wiki pages: stable slugs, search, and batch commands

Status: proposed, 2026-11-06. Spec [#87](https://github.com/yersonargotev/artifacts/issues/87) implements this decision through its tickets, and the decision is accepted when the last one lands: slugs [#88](https://github.com/yersonargotev/artifacts/issues/88) (create and read, shipped) and [#89](https://github.com/yersonargotev/artifacts/issues/89) (move), links [#90](https://github.com/yersonargotev/artifacts/issues/90), search [#91](https://github.com/yersonargotev/artifacts/issues/91), [#92](https://github.com/yersonargotev/artifacts/issues/92), and [#93](https://github.com/yersonargotev/artifacts/issues/93), and batch [#94](https://github.com/yersonargotev/artifacts/issues/94), [#95](https://github.com/yersonargotev/artifacts/issues/95), [#96](https://github.com/yersonargotev/artifacts/issues/96), and [#97](https://github.com/yersonargotev/artifacts/issues/97).

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

Setting or clearing the slug on `move` ([#89](https://github.com/yersonargotev/artifacts/issues/89)) and link resolution ([#90](https://github.com/yersonargotev/artifacts/issues/90)) follow in later tickets.

Link resolution: in a Markdown page, a relative link without a scheme (`../concepts/rag.md`, `rag.md#history`) is resolved against the page's own slug as a path, its `.md` suffix is dropped, and it is looked up in the same project. The owner panel renders a resolved link as a navigation to the target artifact, and an unresolved link as marked plain text. This keeps the same link syntax valid in a Git checkout of the wiki and in Artifacts, which is what makes two-way sync possible. Publication keeps its current inert rendering in this decision. Rendering links for viewers requires deciding what a viewer sees when the target is unpublished or not shared, which is out of scope.

## Full-text search

The store maintains one FTS5 row per artifact for its **head revision only**. History stays reachable through `artifacts_history`. Indexing every revision would multiply the index without serving the query use case.

- Table: `artifact_search(artifact_id UNINDEXED, owner_id UNINDEXED, project UNINDEXED, slug UNINDEXED, title, description, body)` with `tokenize='unicode61 remove_diacritics 2'`, so `busqueda` matches `búsqueda`.
- `body` holds the content text for `markdown` and `text`, and the text content with tags removed for `html`. `design` indexes only its metadata. Attachments are not indexed.
- The store writes the row inside the same transaction as `create`, `update`, `edit`, `move`, `delete`, and `batch`. It does not use SQL triggers, because the HTML text extraction and the move rules are store logic.
- `artifacts_search { query, project?, limit (1–25, default 10), cursor? }`, `GET /v1/search`, and `artifacts search QUERY [--project NAME]` return `{ id, project, slug, title, snippet, rank }` items ordered by `bm25` with an ID tie-break. The command authorizes `artifacts:read` and the live session, and it searches only the caller's owned artifacts. Shared-with-me artifacts are excluded until a separate decision covers search over shared publications.
- The query is plain text. The store tokenizes it and quotes each term, so FTS5 operators in user input cannot cause syntax errors or unbounded queries. All terms must match. Advanced syntax is deferred until a need appears.
- A migration creates the table and backfills it from current head revisions.

## Batch commands

`artifacts_batch { requestId, operations[1..25] }` (`POST /v1/batch`, `artifacts batch --command FILE`) runs every operation in one owner-authorized transaction and persists one receipt. The `panel_move` command already uses this shape.

- Each operation is one of `create`, `update` (with `expectedRevisionId`), `edit` (prepared changes with an expected revision), or `move`. Operations address existing artifacts by ID or by `{ project, slug }`. A `create` earlier in the batch can be addressed by its slug from later operations.
- The batch is all-or-nothing. The first failure aborts the transaction and returns its operation index and domain error, such as `revision_conflict` or `slug_conflict`. Nothing is committed.
- Each operation obeys the existing per-revision limits (1 MiB decoded, 32 attachments). The whole batch has a decoded payload ceiling, proposed at 4 MiB. The validation issue measures it against Worker request limits and libSQL transaction time.
- The receipt records `{ results: [{ index, id, revisionId }] }`. An exact retry returns it. The same request ID with a changed batch fails with `request_conflict`. Deleting an artifact scrubs it from receipts that name it, as for other content-bearing receipts.
- Batches never publish. Publication stays a separate, deliberate command per artifact.

## Alternatives considered

- **One artifact holding the whole wiki** (index as content, pages as attachments). This was rejected because 32 attachments and 1 MiB per revision cap the wiki almost immediately, and every page edit would rewrite the whole wiki.
- **Keeping the wiki only in Git and publishing to Artifacts.** This remains the starting point while these capabilities ship. It does not give agents without a checkout write access or search.
- **An external search index or vector store.** This was rejected because it adds a second store that the authorization boundary must cover, while FTS5 runs in the existing database and transaction.
- **A `page` table separate from `artifact`.** This was rejected because a page is an artifact. A parallel entity would duplicate revisions, sharing, and receipts.

## Compatibility and rollout

The new `slug` field on `ArtifactRead` and summaries is a strict-schema change. As with `project`, published clients reject unknown fields, so a new client and CLI beta (`0.1.0-beta.8` for slugs) ship with the server, and the panel and publication Workers release together after the migrations.

The three parts ship in order: slugs first, because search results and batch operations address pages by slug, then search, then batch. Each part is independently useful.

## Open questions for validation

- Does the deployed Turso database accept `CREATE VIRTUAL TABLE ... USING fts5` with the `unicode61 remove_diacritics 2` tokenizer through the web libSQL client used by the Workers? The local `@libsql/client` 0.18.0 does, as verified on 2026-11-06. If it does not, the fallback is an owner-scoped scan with `instr` over head revisions, acceptable up to a few hundred pages.
- What batch payload ceiling stays within Worker CPU and request limits and libSQL transaction time?
- Should link resolution in the panel reach across projects (`../../other-project/...`)? The proposal says no.
