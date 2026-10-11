# Artifact store

`createArtifactStore(db, { publishOrigin })` owns retained snapshots, draft heads, publication pointers, retry receipts, and publication grants. MCP and panel callers use this API. `@artifacts/artifacts/contracts` exposes the input and response schemas without importing the database or ZIP library.

A snapshot contains `metadata`, `content`, and `files`. Metadata retains the title, description, and optional JSON custom value. Content contains its kind and text. Files retain normalized relative paths, media types, the original UTF-8 or base64 encoding, and their data. Each revision stores the entire snapshot, parent, sequence, author, creation time, and SHA-256 of canonical snapshot JSON. Unknown fields are rejected.

The initial product limit is 1 MiB of decoded content, file bytes, file names, media types, and serialized metadata, with at most 32 attachments. Published HTML is self-contained. Attachments remain downloadable and exportable. Arbitrary relative JavaScript imports and multi-file websites are outside this contract.

## Commands and reads

Every method checks a live central session. An actor contains `userId`, `sessionId`, `clientId`, and granted `scopes`, supplied by the caller's verified authentication adapter. The store checks artifact ownership independently of the adapter.

| Method | Arguments after actor | Required scope | Result |
| --- | --- | --- | --- |
| `create` | `requestId`, `snapshot` | `artifacts:write` | Complete artifact and revision |
| `read` | `artifactId`, optional `revisionId` | `artifacts:read` | Complete artifact and selected revision |
| `update` | `requestId`, `artifactId`, `expectedRevisionId`, `snapshot` | `artifacts:write` | Complete artifact and new revision |
| `publish` | `requestId`, `artifactId`, `revisionId`, `expectedPublicationVersion` | `artifacts:publish` | Artifact ID, revision ID, version, and URL |
| `list` | Optional `limit` and `cursor` | `artifacts:read` | Summaries and `nextCursor` |
| `history` | `artifactId`, optional `limit` and `beforeSequence` | `artifacts:read` | Revisions and `nextBeforeSequence` |
| `export` | `artifactId`, `revisionId` | `artifacts:read` | ZIP base64, filename, media type, and SHA-256 |

Lists default to 25 summaries and allow at most 100 per page. History defaults to 5 complete revisions and allows at most 10 per page. Callers use the returned cursor to request the next page.

Creation, update, and publication store their result under an owner-scoped request ID in the same transaction as the change. Matching retries return the committed result after checking current authority. Changed arguments under that ID fail with `request_conflict`. Updates compare the expected head. Publication compares the expected version before considering a same-revision no-op. Version zero means unpublished. Busy retries retain the caller's expected versions.

The publication URL is `${publishOrigin}/a/${artifactId}`. It remains stable when the selected revision changes. Publishing does not move the draft head. Composite foreign keys enforce revision membership for parents, heads, and publication pointers. The head membership constraint is deferred to commit so a new artifact and its first revision enter together. A database trigger rejects revision updates.

## Publication admission

`issuePublicationGrant(actor, { artifactId, state })` requires `artifacts:read`, ownership, and an existing publication. It returns a random code and expiration time. The database stores only the code hash, bound to the state, artifact, owner, central session, fixed `/callback` URL, and a deadline of at most 60 seconds.

`consumePublicationGrant({ code, state, artifactId })` checks those bindings and the live central session, then consumes the code atomically. It returns a viewer containing `artifactId`, `userId`, `sessionId`, and `expiresAt` in epoch milliseconds. The viewer expires within one hour and no later than the central session.

`readPublished(viewer, { artifactId, revisionId? })` checks the viewer's artifact and expiry, the live central session, canonical ownership, and the current publication in one transaction. A supplied revision must still be published. The publication adapter authenticates its viewer cookie and service request before calling this method. The Worker does not receive database credentials or authoring credentials.

## ZIP format

The archive contains `artifact.json`, a content document with the matching extension, and `files/<path>` entries sorted by path. The manifest retains artifact metadata, revision provenance, content kind, and each file's media type, encoding, size, and SHA-256. Credentials are excluded. Fixed ZIP timestamps and attributes make repeated exports of one revision byte-identical. The implementation uses `fflate` 0.8.3 with stored ZIP entries.

Run `pnpm exec tsx --test tests/artifacts.test.ts` to exercise real migrated SQLite databases, competing writers, stale publication requests, retry receipts, session revocation, one-use grants, schema rejection, MCP tools, and decompressed export bytes.
