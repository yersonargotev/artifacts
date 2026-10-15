# Artifact store

`createArtifactStore(db, { publishOrigin })` owns retained snapshots, draft heads, publication pointers, retry receipts, and publication grants. MCP, REST, and panel callers use this API. `@artifacts/contracts` owns the database-free schemas and workflow helpers. The existing `@artifacts/artifacts/contracts` and `/workflow` exports remain compatible re-exports of the same runtime. HTTP consumers use [the client package](../client/README.md).

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

## Compact MCP responses

The `artifacts_create`, `artifacts_update`, and `artifacts_read` MCP tools accept optional `response: "compact"`. The `artifacts_history` tool accepts `response: "summary"`. Omission and `response: "full"` retain the complete response format. History keeps its existing pagination limits and cursor.

Compact reads retain artifact identity, the current head, publication state, and revision provenance. Each revision summary contains the title, description, content kind, content UTF-8 byte count, and attachment summaries. An attachment summary contains `path`, `mediaType`, `encoding`, `decodedBytes`, and `sha256` of the decoded bytes. Summaries omit custom metadata, content text, and attachment data.

The store always returns complete snapshots and saves complete command receipts. MCP projects the saved result after the operation completes. Compact responses reduce wire payloads. They do not reduce stored snapshots or database reads. A full `artifacts_read` or export remains necessary to verify saved bytes.

Response modes are part of the exact create and update arguments. Omission, `"full"`, and `"compact"` have distinct request identities. A retry must preserve the original mode. Reusing a request ID with a different mode fails with `request_conflict`. An identical retry returns the original receipt's head and publication state, even after later edits or publication changes. Preexisting requests with no response mode keep their original hashes.

`@artifacts/artifacts/workflow` exports `summarizeRevision(revision)`, `compactArtifactRead(document)`, and `compareRevisions(before, after)`. These asynchronous helpers share the summaries used by MCP and the panel. Comparisons include changed metadata rows, before and after content with `kindChanged` and `textChanged`, and added, removed, or changed attachments sorted by path. A file changes when its decoded bytes, media type, or encoding change. Custom JSON comparison ignores object key order.

## Prepare and retry an edit

`prepareArtifactEdit(client, { artifactId, requestId, changes })` reads the current head through `client.read({ artifactId })`. The client returns a complete `ArtifactRead`. The helper validates that result and rejects a different artifact or a selected revision that is not the head.

`changes.metadata` and `changes.content` replace only supplied fields. Omitted metadata, custom values, content fields, and attachments survive in the complete next snapshot. `changes.files` replaces the entire attachment inventory. An empty array removes all attachments. `metadata.custom: null` stores JSON null. An own `metadata.custom: undefined` property removes custom metadata.

The helper returns an `UpdateInput` with the observed `expectedRevisionId` and supplied `requestId`. It clones caller data and freezes the command recursively. It does not save a revision or retry conflicts. The command contains only JSON data and can be persisted before submission.

With an authenticated `store`, `actor`, and `artifactId`, prepare and save the exact command before sending it:

```ts
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { updateSchema } from '@artifacts/artifacts/contracts';
import { prepareArtifactEdit } from '@artifacts/artifacts/workflow';

const command = await prepareArtifactEdit(
	{ read: (input) => store.read(actor, input) },
	{
		artifactId,
		requestId: randomUUID(),
		changes: { content: { text: '<h1>Updated report</h1>' } },
	},
);
await writeFile('pending-edit.json', JSON.stringify(command), { mode: 0o600 });
const saved = await store.update(actor, command);
```

After an uncertain transport failure, reload and submit the saved command without changing any arguments:

```ts
const retry = updateSchema.parse(JSON.parse(await readFile('pending-edit.json', 'utf8')));
const saved = await store.update(actor, retry);
```

The same committed request returns its original receipt without creating another revision. A stale head fails with `conflict` and leaves the current artifact unchanged. Preparing again reads a new head and creates a new operation, so that decision requires a new request ID.

## Publication admission

`issuePublicationGrant(actor, { artifactId, state })` requires `artifacts:read`, ownership, and an existing publication. It returns a random code and expiration time. The database stores only the code hash, bound to the state, artifact, owner, central session, fixed `/callback` URL, and a deadline of at most 60 seconds.

`consumePublicationGrant({ code, state, artifactId })` checks those bindings and the live central session, then consumes the code atomically. It returns a viewer containing `artifactId`, `userId`, `sessionId`, and `expiresAt` in epoch milliseconds. The viewer expires within one hour and no later than the central session.

`readPublished(viewer, { artifactId, revisionId? })` checks the viewer's artifact and expiry, the live central session, canonical ownership, and the current publication in one transaction. A supplied revision must still be published. The publication adapter authenticates its viewer cookie and service request before calling this method. The Worker does not receive database credentials or authoring credentials.

## ZIP format

The archive contains `artifact.json`, a content document with the matching extension, and `files/<path>` entries sorted by path. The manifest retains artifact metadata, revision provenance, content kind, and each file's media type, encoding, size, and SHA-256. Credentials are excluded. Fixed ZIP timestamps and attributes make repeated exports of one revision byte-identical. The implementation uses `fflate` 0.8.3 with stored ZIP entries.

Run `pnpm exec tsx --test tests/artifacts.test.ts tests/workflow.test.ts` to exercise real migrated SQLite databases, competing writers, stale publication requests, retry receipts, session revocation, one-use grants, schema rejection, MCP tools, decompressed export bytes, compact responses, revision comparisons, and persisted prepared edits.
