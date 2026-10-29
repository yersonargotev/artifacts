# Artifacts HTTP client reference

`@yargote/artifacts-client` is a typed Fetch client for the Artifacts REST API. It depends on `@yargote/artifacts-contracts` and Zod. It does not install the artifact store or a database driver. Node 24 or later is required.

```sh
npm install @yargote/artifacts-client@0.1.0-beta.6
```

```ts
import { createArtifactHttpClient, HttpError } from '@yargote/artifacts-client';

const client = createArtifactHttpClient({
	resource: process.env.ARTIFACTS_SERVER!,
	accessToken: async () => obtainAccessToken(),
	timeoutMs: 30_000,
});

const identity = await client.identity();
const document = await client.read({ artifactId: 'artifact-id' });
```

## Configuration

`createArtifactHttpClient({ resource, accessToken, fetch?, timeoutMs? })` returns an `ArtifactHttpClient`.

`resource` is the exact canonical REST OAuth resource. Set it to the deployment's `API_URL` origin, such as `https://artifacts.example`, to use routes under `/v1`. Request access tokens for that same origin. MCP uses a separate `/mcp` audience. The client appends `/v1` to the supplied resource and does not remove or rewrite paths. Older deployments without `API_URL` retain their complete MCP resource and `/mcp/v1` routes.

HTTPS is required except for HTTP on `localhost`, `127.0.0.1`, or `[::1]`. Credentials, queries, fragments, and noncanonical URLs are rejected. The client has no default resource.

`accessToken` is a bearer token or an asynchronous function that returns one. The function runs once per method call. The caller owns credential storage and refresh.

`fetch` defaults to `globalThis.fetch`. `timeoutMs` defaults to 30 seconds and covers the request and response body. It must be a positive safe integer no greater than 2147483647.

## Methods

Every method makes one HTTP request. The client does not retry, follow redirects, rebase conflicts, or change expected versions.

| Method | Input | Result |
| --- | --- | --- |
| `identity()` | None | Verified user, session, client, and scopes |
| `create(command)` | `requestId`, complete `snapshot`, optional `project` and `response` | Artifact receipt |
| `list(query?)` | Optional `limit`, `cursor`, and `project` | Artifact summaries and `nextCursor` |
| `projects()` | None | `{ items: [{ name, artifactCount }] }` |
| `read(query)` | `artifactId`, optional `revisionId` and `response` | Artifact revision |
| `update(command)` | `requestId`, `artifactId`, `expectedRevisionId`, complete `snapshot`, optional `response` | Artifact receipt |
| `history(query)` | `artifactId`, optional `limit`, `beforeSequence`, and `response` | Revisions and `nextBeforeSequence` |
| `publish(command)` | `requestId`, `artifactId`, `revisionId`, `expectedPublicationVersion` | Publication receipt |
| `share(command)` | `requestId`, `artifactId`, `email`, optional `notify` and `requireNew: true` | Share receipt with optional notification disposition |
| `listShares(query)` | `artifactId` | `{ items: Share[] }` |
| `unshare(command)` | `requestId`, `artifactId`, `shareId` | `void` after an empty HTTP 204 |
| `move(command)` | `requestId`, `artifactId`, `project` name or null | `{ artifactId, project }` |
| `export(query)` | `artifactId`, `revisionId` | `{ filename, mediaType, bytes, sha256 }` |

Create, read, and update accept `response: 'compact'`. The returned revision contains metadata and file summaries. Omitted response and `response: 'full'` return the complete snapshot. History accepts `response: 'summary'` or `response: 'full'`. Its page limit is ten revisions. Overloads reflect these projections in the return type.

All commands and JSON responses pass the strict domain schemas. An omitted mutation `response` remains omitted in the transmitted command. JSON responses are bounded at 64 MiB, which accommodates ten maximum-size revisions with JSON escaping. Archives are bounded at 8 MiB. Export verifies the binary bytes against `X-Artifact-SHA256` and returns the bytes without rebuilding the ZIP.

All sharing methods require `artifacts:publish` and artifact ownership. `share` trims and lowercases the email. The client places identifiers in encoded URL segments and sends `{ requestId, email }` plus any explicitly supplied `notify` or `requireNew` for share or `{ requestId }` for unshare. `unshare` resolves with `undefined` and requires no JSON content type on its empty response.

Artifact reads and list items include `project`, a name or null. A project name matches an existing project regardless of letter case and keeps its stored spelling. `move` never creates a revision or changes the publication. `projects()` lists only projects that contain artifacts, ordered by name. Because response schemas are strict, this client requires a server that returns `project`. Version `0.1.0-beta.4` and earlier reject responses from such a server with `invalid_response`.

`prepareArtifactEdit(client, { artifactId, requestId, changes })` reads the current full snapshot and prepares an immutable update command. Metadata and content changes merge into that snapshot. An explicit `files` array replaces the attachments. The helper does not submit the update. Retain its exact output before sending it.

## Errors and retries

`HttpError` extends `Error` and contains `status`, `code`, and `details`. Server conflicts preserve the server's details. Transport failures use status `0` and code `network_error` or `timeout`. Rejected redirects use `redirect_refused`. Invalid response schemas use `invalid_response`. Oversized responses use `response_too_large`. A mismatched archive digest uses `archive_digest_mismatch`.

Invalid local commands throw a Zod validation error before any HTTP request. Invalid configuration throws `TypeError`.

A caller that needs recovery retains the complete create, update, publish, move, share, or unshare command before its first request. While the artifact exists, retrying that exact command returns the original receipt or confirms unshare with another empty 204. Changing `response`, the snapshot, an expected version, or a sharing argument changes the command. A conflict requires a new deliberate command with a new request ID. A replayed receipt describes the original operation and can differ from a fresh read. Replaying a share after revocation returns its historical receipt without restoring access. A new unshare command for a removed share returns `not_found`.

## Compiled installation

The registry package contains compiled ESM JavaScript and declarations. Consumers need no TypeScript loader or database package. For repository development, `pnpm build:packages` produces local tarballs and a `dist/packages/manifest.json` inventory. `pnpm test:packages` verifies an ordinary Node consumer and its types.

This package is MIT licensed. The license applies to this package and does not license the private Artifacts application repository.

Permanent deletion from the panel invalidates historical content-bearing receipts. An exact create, update, publish or move retry for a deleted artifact returns `not_found`; request identity remains reserved, so a changed command still returns `request_conflict` and an old create cannot recreate it. Live-session and scope checks still precede replay. This package exposes no deletion operation.

`notify: true` requests one invitation attempt. The result adds `notification` with `status: "requested"`, or `status: "skipped"` and `reason: "disabled"` or `"rate_limited"`. A rate-limited result includes the next UTC day in `retryAt`. Access succeeds in each case. `requested` does not confirm delivery. Exact retries never send again. A fresh request can notify existing access. `requireNew: true` atomically rejects existing access with `conflict` and `details.reason: "share_exists"`. Plain and explicit-false results keep the five grant fields.
