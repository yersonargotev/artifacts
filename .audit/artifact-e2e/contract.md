# Synthesized artifact contract

Candidate A is the base. Whole revision snapshots in Turso keep complete bytes, metadata, and pointers in one transaction. Candidate B contributes deterministic ZIP structure and explicit artifact-scoped viewer admission. Native Workers deployment is being probed separately. No measured size requirement justifies R2 in this increment.

## Data shape

A snapshot has metadata containing title, description, and optional JSON custom values; content containing kind html, markdown, or text and text; and files containing path, mediaType, encoding utf8 or base64, and data. Every revision stores that entire snapshot, immutable parent, sequence, author user/client, creation timestamp, and SHA-256. A 1 MiB decoded total and 32 attachments bound this initial implementation. HTML publication is self-contained. Files are retained, read, downloaded, and exported. No HTML executes on the panel origin.

An artifact has a canonical owner, immutable ID, head revision, and optional independent publication. Updating requires expectedRevisionId. Publishing requires revisionId and expectedPublicationVersion, with 0 meaning unpublished. Check expected publication version before same-revision no-op so stale publishers cannot silently hide a race. Every mutation has an owner-scoped requestId and payload receipt. Reusing a requestId with changed payload fails. Ownership and operation scopes are checked by the store, with user identity derived from actual MCP or browser admission.

## Public API

`createArtifactStore(db, { publishOrigin })` owns create, read, update, publish, list, history, export, published reads, and login grants. Use domain schemas at MCP and browser/internal HTTP boundaries. Keep callers free of artifact SQL. Lists/history are bounded with deterministic ordering and pagination. Tools are artifacts_create, artifacts_read, artifacts_update, artifacts_publish, artifacts_export, artifacts_list, artifacts_history. Return IDs, versions, and stable publication URL in structured content. Preserve whoami.

`artifact.json`, `content.html` or its appropriate extension, and `files/<path>` form the deterministic ZIP. MCP returns archive base64, mediaType, filename, and SHA-256. The panel streams ZIP bytes under its session. Export a selected immutable revision, never credentials.

## Publication protocol

Use PUBLISH_URL/a/<artifactId> as the stable URL. The separate Worker stores only PUBLICATION_SERVICE_SECRET and PUBLICATION_COOKIE_SECRET, with public panel/publication origins. It receives no DB token, owner password, or authoring credential.

An anonymous document request creates encrypted authenticated transaction data with random state, artifactId, and short expiry in an HttpOnly host-only cookie. Redirect to the fixed panel `/publication/open` route with artifactId and state. Panel login preserves only validated local return paths. A live owner session issues a hashed one-use code bound to state, artifactId, and central session. Redirect to the fixed Worker callback. Worker validates its transaction cookie and state, then exchanges code/state/artifactId through a service-authenticated internal panel endpoint. Consumption and live central-session checks are atomic. Worker issues an authenticated encrypted viewer cookie containing artifactId, userId, centralSessionId, and expiry limited by the central session. Callback redirects to the clean stable URL.

Every document and attachment request calls a narrow internal panel endpoint with the verified viewer. Backend checks live session, canonical ownership, artifact binding, and current published pointer. Never positively cache admission or content. Missing credentials cannot read bytes. DB/backend outage fails closed with 503. Serve only selected published revisions. Attachment links pin revisionId to the document that produced them; reject an obsolete revision when it is no longer published rather than mix bytes from another revision.

Trusted wrapper contains escaped srcdoc inside an iframe sandbox with only allow-scripts. Do not allow same-origin, forms, popups, top navigation, workers, network connections, external executable assets, or unsafe parent messaging. CSP enforces those restrictions. Text and markdown can render inertly for this increment. Attachment downloads always use attachment disposition and nosniff. Real browser assertions must prove isolation and denial.

## Configuration and ownership

Root owns package manifests, lockfile integration, deployment configs, env migration/cutover and cloud deployment. Artifact owner owns packages/artifacts, DB schema/migrations, MCP integration, artifact tests and fixture injection. Publication/panel owner uses the store and owns apps/publication plus dashboard pages/identity return-path support. A migration worker owns only scripts/migrate-identity.ts and tests/identity-migration.test.ts. Independent worktrees prevent shared writes.

## Acceptance

Actual Claude creates and publishes revision 1 through MCP. Actual Codex reads, updates and publishes revision 2. Same signed-in browser URL shows revision 2. Panel contains both immutable revisions. Export of revision 1 preserves its bytes and files. Anonymous and revoked sessions cannot read document or attachments. Migrate existing identity by consistent snapshot with destination conflict checks and verify owner ID before changing config. Public issuer/resource changes require fresh public CLI login, with the same canonical owner.
