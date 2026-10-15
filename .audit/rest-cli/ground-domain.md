# Artifact domain exploration

PASS for read-only grounding. The existing domain supports an independently usable REST adapter and CLI without another persistence or mutation model. No application changes or runtime acceptance claims are part of this report.

throughput checkpoint: n/a, read-only investigation

## Components found

| Component | Exact file | Responsibility |
| --- | --- | --- |
| `Snapshot`, `Actor`, `ArtifactRead`, `UpdateInput`, schemas, `ArtifactError` | `packages/artifacts/src/contracts.ts` | Defines strict external commands, complete snapshots, provenance, limits, and domain errors. The contracts entry point avoids database and ZIP imports. |
| `createArtifactStore` | `packages/artifacts/src/index.ts:23` | Owns retained revisions, ownership, live-session checks, operation scopes, optimistic comparisons, transactional receipts, publication grants, and ZIP export. |
| `prepareArtifactEdit` | `packages/artifacts/src/workflow.ts:121` | Reads a full current head, preserves omitted fields, and returns a cloned, recursively frozen complete update command. It does not submit or retry that command. |
| `summarizeRevision`, `compactArtifactRead`, `compareRevisions` | `packages/artifacts/src/workflow.ts` | Shares compact projections and metadata, content, and decoded-file comparison between adapters. |
| `canonicalJson`, `sha256` | `packages/artifacts/src/serialization.ts` | Sorts JSON object keys recursively and hashes canonical snapshots and command inputs. Array order remains meaningful. |
| Artifact tables | `packages/db/src/schema.ts:25` | Separates canonical owner and draft head, immutable revisions, publication pointer/version, owner-scoped receipts, and one-use grants. |
| Migration invariants | `packages/db/migrations/0001_sleepy_bastion.sql` | Adds composite membership foreign keys, a deferred initial head constraint, unique revision sequences, and an immutable-revision update trigger. |
| Database connection | `packages/db/src/index.ts` | Enables and verifies foreign-key enforcement for every connection. |
| Existing MCP adapter | `apps/mcp/src/http.ts` | Constructs a verified principal, calls the store, maps domain errors, and projects compact responses after store completion. |
| Panel adapter helpers | `apps/dashboard/src/publication.ts`, `runtime.ts`, `publish.ts`, `review.ts` | Constructs panel actors, maps errors, creates the store, verifies post-publication state, and assembles review data. |

## Flow

### Authoring and replay

1. An authentication adapter supplies an `Actor` containing verified `userId`, live central `sessionId`, OAuth `clientId`, and scopes. The store never accepts owner identity from snapshot metadata. `apps/mcp/src/http.ts` passes its authorizer's principal; the panel uses `panelActor`.
2. `create`, `update`, and `publish` parse their strict schemas. Creation and update canonicalize the complete snapshot and compute its digest. `packages/artifacts/src/index.ts:80`, `:102`, and `:117` contain these command entry points.
3. `command` hashes `{ kind, input }`, enters a transaction, and checks operation scope and the live central session before reading a receipt. `packages/artifacts/src/index.ts:64` owns this ordering.
4. A matching `(ownerId, requestId)` receipt returns its original complete result. Changed arguments fail with `request_conflict`. Receipt identity spans command kinds and clients for the same owner. It is not scoped to one transport.
5. A new create inserts the artifact and revision together. A new update reads the owned head, compares `expectedRevisionId`, inserts the next full revision, and conditionally moves the head. Any conflict rolls back both the new row and receipt.
6. The command result and receipt commit in the same transaction. The store returns complete data even when input requests `response: "compact"`. MCP calls `compactArtifactRead` only afterward.
7. `transaction` retries only SQLite busy or locked failures, up to five retries after the first attempt, with exponential delays. It preserves the original expected revision and publication version. It never rereads and silently rebases the caller's command.

### Safe CLI editing

1. A CLI can supply `prepareArtifactEdit` with a REST client implementing `read({ artifactId })` and returning a full `ArtifactRead`.
2. Preparation rejects a different artifact or a selected historical revision that is not the current head. It merges supplied metadata and content fields and preserves all omitted metadata, custom JSON, content fields, and files.
3. `changes.files` replaces the entire inventory. `[]` removes every file. `custom: null` stores JSON null. An own `custom: undefined` removes custom metadata before command serialization.
4. The caller persists the resulting command before submission. An uncertain transport result retries that exact command. A conflict requires a deliberate new operation with a new request ID.

### Publication and viewing

1. `publish` reads the requested owned retained revision and compares `expectedPublicationVersion` before considering a same-revision no-op. Zero means unpublished. A pointer change increments the version. The draft head and stable `${publishOrigin}/a/${artifactId}` URL stay independent.
2. The panel's `publishSelectedRevision` rereads publication after submission. It distinguishes the committed receipt from the currently observed publication. A receipt can be correct even when a later request superseded it. See `apps/dashboard/src/publish.ts:25`.
3. `issuePublicationGrant` requires read scope, ownership, a live session, and an existing publication. It stores only a hash of a random code, bound to artifact, browser state, owner, session, fixed callback, and at most 60 seconds.
4. `consumePublicationGrant` checks those bindings and current ownership/session, then deletes the grant atomically. A viewer expires within one hour and no later than the central session.
5. `readPublished` checks the artifact-bound viewer, expiry, live session, ownership, and current publication inside one transaction. A pinned revision that is no longer published fails. REST authoring must not become an alternative viewer-admission route.

### Export

1. `export` requires an explicit artifact and revision. It calls the ordinary authorized owned read.
2. The store assembles `artifact.json`, `content.html`, `content.md`, or `content.txt`, and sorted `files/<path>` members. The manifest includes metadata, revision provenance, each file's original encoding, decoded size, and decoded-byte digest.
3. Fixed ZIP timestamps and attributes and stored entries produce repeatable archive bytes. The result contains filename, `application/zip`, base64, and SHA-256. The panel converts that same base64 to a binary download in `apps/dashboard/src/pages/artifacts/[artifactId]/export.ts`.

## Boundaries and implementation consequences

- REST should validate transport inputs, derive a verified actor, call `ArtifactStore`, and map errors. Artifact SQL, concurrency comparisons, receipt creation, and archive generation belong in `packages/artifacts`. This boundary is explicit in `docs/decisions/artifacts.md` and the original design judgment.
- The CLI should depend on a network client and the contracts or workflow entry points. Importing the store entry point brings database and ZIP dependencies. `packages/artifacts/package.json` already separates `.`, `./contracts`, and `./workflow`.
- Preserve the existing MCP tools and panel callers while adding REST. There is no need to migrate them onto HTTP to make REST independently usable. No new domain schema or database migration follows from the observed requirement alone.
- Domain errors are `forbidden`, `not_found`, `conflict`, `request_conflict`, and `invalid_grant`. Existing panel mapping uses 403, 404, 409, 409, and 403. Validation is 400 and unexpected service failure is 503. A REST adapter needs a machine-readable error body while preserving conflict details such as `currentRevisionId` and `currentPublicationVersion`.
- Keep exact binary export semantics. A binary HTTP response can decode the existing archive result, as the panel does. It must not rebuild a second archive format.
- The store still checks authority on receipt replay. CLI credentials or refresh behavior cannot bypass revoked or expired central sessions.

## Non-obvious things

- Optional `response` fields have no defaults. Omission, `"full"`, and `"compact"` produce distinct create/update receipt hashes. A REST or CLI adapter that inserts `response: "full"` changes an old command's identity. `tests/workflow.test.ts:182` pins literal legacy hashes.
- Receipt replay returns the original head and publication state, not fresh current state. A CLI that reports "currently published" from a replay alone can lie after a later publication. The panel already solves that distinction with an independent read.
- The request ID namespace belongs to the owner across operations, clients, MCP, panel, and future REST. Use collision-resistant operation IDs and preserve the same ID across uncertain retries. A fresh ID is a fresh operation.
- `update` replaces the full snapshot. The server has no patch or attachment-merge protocol. A convenience CLI edit must perform full-read preparation or submit a complete user-provided command.
- Object key order is canonicalized. File array order and other array order are retained and affect snapshot and command hashes. Sorting files before every retry can therefore change a prepared command.
- The snapshot limit is 1 MiB of decoded content and files plus path/media-type bytes and serialized metadata. Transport JSON can be larger because of base64 and escaping. The MCP ingress separately caps raw request bytes at 8 MiB. A REST body cap must account for wire overhead rather than equating decoded and request sizes.
- Paths reject absolute or empty segments, dot segments, colons, backslashes, percent signs, controls, non-NFC spelling, duplicate paths, and file/directory prefix collisions. Base64 must be canonical and padded. Unknown schema fields fail instead of disappearing.
- `packages/db/src/schema.ts` does not express the deferred head foreign key or immutable trigger in the same detail as the SQL migration. Replacing migrations with generated schema initialization would lose accepted behavior. `openDatabase` also requires foreign keys to remain enabled.
- The immutable trigger rejects updates, rather than defining a public revision-deletion API. No artifact deletion operation exists in `ArtifactStore`; adding CLI delete would add unrequested product semantics.
- `queryLibrary` is a separate panel-oriented read with search, counts, statuses, and a fixed page size of 25. MCP's `list` has stable ID cursor ordering and configurable bounds. Do not silently replace one contract with the other.
- HTML remains self-contained. Attachments are retained downloads, not executable relative website assets. REST upload or CLI file import must preserve this documented content model.
- Node dashboard builds require a shared package instance for `ArtifactError` identity. `docs/decisions/artifacts.md` records why `instanceof` error mapping depends on that build boundary. Worker builds bundle both contracts and store.

## Original rationale and history

- Commit `cd6f7c1` introduced the store, contracts, constraints, receipts, grants, and real migrated-database tests. Its original README already assigned every mutation and publication rule to the store.
- Commit `d3547fb` introduced `docs/decisions/artifacts.md`. It records the choice of complete bounded Turso snapshots over an R2-backed catalog. Accepted bytes and pointers commit together, avoiding uploads, orphan handling, and two-store coordination for the known size requirement.
- `.audit/artifact-e2e/design-judgment.md` exists locally and records the original independent comparison. It selected the single transactional store and adopted explicit owner/request receipt keys, deterministic archives, and revision-bound downloads from the alternative. The document is design evidence, not current runtime proof.
- Commit `6f41eaf` added optional MCP projections, persistable prepared edits, panel review/publication, and retained verification. `docs/workflow/design.md` explains why it chose optional response modes instead of four alias tools and client-side complete commands instead of a server patch protocol.
- `docs/workflow/decisions.tsv` records a real build-output collision between Node browser proof and Worker builds. Keep those checks sequential when they share generated dashboard output.

## Verification entry points

These commands and assertions were inspected, not executed during this read-only exploration.

| Entry point | Existing evidence it checks |
| --- | --- |
| `pnpm exec tsx --test tests/artifacts.test.ts tests/workflow.test.ts tests/database.test.ts` | Real migrated SQLite, complete retained snapshots, deterministic decompressed export bytes, receipt replay, legacy hashes, operation scopes, revocation, multi-connection writers, stale publication precedence, owner filtering, foreign keys, immutable trigger, one-use grant races, and safe persisted edit retry. |
| `pnpm exec tsx --test tests/library.test.ts tests/publication.test.ts tests/panel.test.ts` | Adjacent panel library, publication service, and owner-session regressions. These are entry points discovered in the test inventory, not fully reviewed test bodies. |
| `pnpm check` and `pnpm build:workers` | Type and Worker compilation. They do not establish runtime acceptance. |
| `pnpm test:browser` | The package script builds the actual panel and runs identity, authoring/review/publication, network isolation, retained contract, and retained application browser proofs. Build output must remain stable during the run. |
| `.agents/skills/verify-artifacts/SKILL.md` | Disposable local feature recipes and non-authoring retained verification against a full independent saved revision and authenticated real browser. Export compares the panel download with exact MCP archive bytes. |

New REST and CLI acceptance should exercise their actual HTTP and process boundaries, retain the same command for an uncertain replay, demonstrate stale-head and stale-publication errors, independently reread full retained bytes, and compare the downloaded ZIP with the existing store/MCP export. Successful MCP fixtures alone cannot prove the new CLI entry point.

## Open questions

- REST resource/audience and CLI OAuth registration, callback, refresh, and credential persistence are authentication and packaging decisions outside this domain slice. The store requires their result to be a verified actor with a live central session.
- The exact REST URL and binary-export response contract remain design choices. Domain reuse does not require a second archive or persistence format.
- No runtime tests were run here. This PASS certifies completed source/history exploration, not an implemented REST API or CLI.

## Skills and files read

Boundary Discipline shaped the thin-adapter recommendation. Make Operations Idempotent shaped exact prepared-command persistence and replay guidance. Prove It Works keeps real HTTP/process/browser checks separate from source-grounding PASS. Their leaf skills were read this session.

Product files read were `packages/artifacts/src/contracts.ts`, `index.ts`, `workflow.ts`, `serialization.ts`, `packages/artifacts/package.json`, `packages/artifacts/README.md`, `packages/db/src/schema.ts`, `index.ts`, `migrate.ts`, `packages/db/migrations/0001_sleepy_bastion.sql`, `apps/mcp/src/http.ts`, `apps/dashboard/src/publish.ts`, `review.ts`, `publication.ts`, `runtime.ts`, `apps/dashboard/src/pages/artifacts/[artifactId]/export.ts`, `tests/artifacts.test.ts`, `tests/workflow.test.ts`, `tests/database.test.ts`, `package.json`, `docs/decisions/artifacts.md`, `docs/workflow/design.md`, `docs/workflow/decisions.tsv`, and `.audit/artifact-e2e/design-judgment.md`.

Workflow files read were `.agents/skills/poteto-mode/SKILL.md`, `poteto-mode/playbooks/investigation.md`, `how/SKILL.md`, `how/references/explorer-prompt.md`, `unslop/SKILL.md`, `technical-writing/SKILL.md`, `principle-boundary-discipline/SKILL.md`, `principle-make-operations-idempotent/SKILL.md`, `principle-prove-it-works/SKILL.md`, and `verify-artifacts/SKILL.md`, all under `.agents/skills/` unless an absolute path is stated.

History inspected used `git log` for the package and decision, the `cd6f7c1` README, and the `6f41eaf` contracts/store diff. The attempted `1c70987:docs/decisions/artifacts.md` lookup confirmed that decision file did not yet exist at that commit.
