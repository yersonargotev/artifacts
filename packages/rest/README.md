# Artifacts REST

`createArtifactRestApp(config, store)` returns a Fetch handler. It does not import or construct MCP. The caller supplies the canonical artifact store and the existing bearer resource configuration. Build compiled JavaScript, declarations, and tarballs with `pnpm build:packages`. Install the generated contracts, config, db, artifacts, and rest tarballs together in an external server project. The [repository instructions](https://github.com/yersonargotev/artifacts/blob/5ccb12e7cb9711c7919171602b3af7006e8bc6cc/README.md#use-the-standalone-cli-or-rest-client) describe local installation.

The default portable tarballs keep the upstream registry native graph. Its inherited native statement-retention defect can block later local writes after a failed transaction control or warmed read. This profile does not contain the native correction.

For the private native-fixed profile, run `node scripts/prepare-native.mjs` and `pnpm build:packages:native` on the intended deployment platform. Install the tarballs from `dist/packages-native-fixed/tarballs` together with ordinary `npm install --ignore-scripts`. The private tarball filenames identify the build target. The DB package bundles the unchanged SDK, Drizzle, and the corrected native runtime graph. It needs no consumer compiler, preload, installation script, or producer path. The native inventory cannot be published by the public release command.

Native preparation currently supports macOS arm64 and Linux x64 with glibc. The build manifest records the actual OS, CPU, libc version, N-API requirement, tools, and binary hash. Older Linux libc baselines, other targets, and replica recovery remain unverified. The [native guide](../../native/libsql/README.md) gives the complete requirements and retained limits.

```ts
import { createArtifactRestApp } from '@artifacts/rest';

const fetch = createArtifactRestApp({
	resource: 'https://artifacts.example',
	issuer: 'https://accounts.example/api/auth',
	clientId: process.env.MCP_INTROSPECTION_CLIENT_ID,
	clientSecret: process.env.MCP_INTROSPECTION_CLIENT_SECRET,
}, store);
```

The canonical REST resource is the `API_URL` origin. Routes live at `${API_URL}/v1`. MCP uses the same origin with `/mcp` as its separate OAuth resource. Request a token for the REST origin when calling this adapter. Direct consumers need no MCP session. The default `artifacts-api` Worker composes both adapters over one store.

`pnpm dev:rest` starts the REST-only Node listener using `DATABASE_URL`, optional `DATABASE_AUTH_TOKEN`, `AUTH_URL`, `API_URL`, `MCP_URL`, `PUBLISH_URL`, both introspection credentials, and the existing `MCP_PORT` and `MCP_BIND_HOST` variables. `API_URL` must be an origin, and `MCP_URL` must be the same origin followed by `/mcp`. Without `API_URL`, older configurations retain `MCP_URL` as the REST resource and expose `${MCP_URL}/v1`. This entry point reads explicit environment variables and does not load `.env`.

## Routes

Paths below are relative to `${API_URL}/v1`.

| Method | Relative path | Input |
| --- | --- | --- |
| GET | `/identity` | None |
| POST | `/artifacts` | Complete create command |
| GET | `/artifacts` | `limit`, `cursor`, `project` |
| GET | `/artifacts/:artifactId` | `revisionId`, `response` |
| PUT | `/artifacts/:artifactId` | Complete update command |
| GET | `/artifacts/:artifactId/history` | `limit`, `beforeSequence`, `response` |
| PUT | `/artifacts/:artifactId/publication` | Complete publish command |
| PUT | `/artifacts/:artifactId/project` | Complete move command |
| GET | `/artifacts/:artifactId/shares` | None |
| POST | `/artifacts/:artifactId/shares` | `{ "requestId": "...", "email": "ana@example.com" }` |
| DELETE | `/artifacts/:artifactId/shares/:shareId` | `{ "requestId": "..." }` |
| GET | `/artifacts/:artifactId/revisions/:revisionId/export` | None |
| GET | `/projects` | None |

Command bodies use the existing strict contracts and require `Content-Type: application/json`. Update, publish, and move bodies include `artifactId`, which must match the route. Share and unshare bodies omit route identifiers and reject them as unknown properties. Unknown or repeated query parameters fail. Sharing routes accept no query parameters. Body streaming stops after 8 MiB. Create and share return 201, including receipt replays. Unshare returns 204 with an empty body. Other successes return 200. All protected responses use `Cache-Control: no-store`.

```sh
curl --fail-with-body "$ARTIFACTS_SERVER/v1/identity" \
	-H "Authorization: Bearer $ARTIFACTS_ACCESS_TOKEN"
curl --fail-with-body "$ARTIFACTS_SERVER/v1/artifacts" \
	-H "Authorization: Bearer $ARTIFACTS_ACCESS_TOKEN" \
	-H 'Content-Type: application/json' --data-binary @create-command.json
```

## Projects

A create command accepts an optional `project` name. Every artifact response and list item includes `project`, a name or null. A name that matches an existing project of the owner regardless of letter case reuses its stored spelling. `GET /artifacts?project=NAME` lists only that project's artifacts.

A move command is `{ "requestId": "...", "artifactId": "...", "project": "Beta" }`. Use `"project": null` to remove the artifact from its project. The result is `{ "artifactId": "...", "project": "Beta" }` with the stored spelling. A move never creates a revision or changes the publication. Moving to the current project succeeds without change.

`GET /projects` returns `{ "items": [{ "name": "Beta", "artifactCount": 1 }] }`, ordered by name without regard to letter case. Projects exist only while they contain artifacts, so the list has no empty entries and no pagination.

For an origin resource, the metadata URL is `${API_URL}/.well-known/oauth-protected-resource`. MCP metadata lives at `${API_URL}/.well-known/oauth-protected-resource/mcp`. Each document identifies its own exact OAuth resource. Check the REST document's `resource` field against the configured API origin. REST route challenges omit `resource_metadata` because those route URLs differ from the OAuth audience.

## Sharing

Only an artifact's owner can create, list, or revoke its shares. All three routes require `artifacts:publish`, including GET. An email is trimmed and lowercased. Sharing the same email again returns the existing share. A share has `shareId`, `artifactId`, `kind: "email"`, `value`, and `createdAt`. Listing returns `{ "items": [share] }`.

A verified guest whose email matches a share can open the published revision. A share on an artifact that has never been published waits until publication. Revoking a share denies the guest's next read. Sharing does not grant access to owner history, export, editing, or share management.

The typed client's `share` and `unshare` methods accept complete commands with route identifiers. `listShares` accepts `{ artifactId }`. The client projects the short HTTP bodies, validates returned shares, and resolves `unshare` with `undefined` only after an empty 204 response.

## Invitations and admission limits

A share POST accepts optional `notify` and literal `requireNew: true`. Omitted fields remain omitted in receipt hashes. An explicitly supplied `notify: false` is a different command argument from absence. `requireNew` rejects an existing grant atomically with HTTP 409, `conflict`, and `details.reason: "share_exists"`. Exact receipt replay returns the original result even if that grant was later revoked.

With `notify: true`, a successful 201 adds one immutable notification disposition.

```json
{"status":"requested"}
{"status":"skipped","reason":"disabled"}
{"status":"skipped","reason":"rate_limited","retryAt":"2026-10-26T00:00:00.000Z"}
```

`requested` records a budget reservation committed atomically with the share and its receipt; the bounded send attempt starts after commit. It does not confirm provider acceptance or mailbox delivery. A crash before the attempt can lose the email. Rejection, timeout, revoked access, or a failed optional lookup preserves the successful access result. Exact retries never start another attempt. A fresh request for existing access can request another invitation.

Each owner has 100 invitation reservations per UTC day, based on database time. Revoke, artifact deletion, delivery failure, and crashes do not refund reservations. New grants have caps of 100 per artifact and 1000 per owner. Growth beyond a cap returns HTTP 409 with `details.reason: "share_limit"`, `scope: "artifact"` or `"owner"`, and `limit`. Existing grants remain fully listable, reusable, and revocable, including legacy rows above the caps. List items never include notification dispositions.

## Errors and retries

Errors have the shape `{ "error": { "code": "conflict", "message": "Artifact head changed", "details": { "currentRevisionId": "..." } } }`. Invalid input returns 400, missing authentication 401, forbidden access 403, missing owned objects 404, conflicts 409, oversized requests 413, unsupported content types 415, unsupported methods 405 with `Allow`, and unavailable dependencies 503.

Every bearer request verifies signature, claims, and fresh introspection. Artifact reads, artifact lists, and projects require `artifacts:read`. Create, update, and move require `artifacts:write`. Publication and every sharing route require `artifacts:publish`. A missing scope returns 403 with JSON code `forbidden`, `details.requiredScopes`, and a `WWW-Authenticate` challenge containing `insufficient_scope`. The store independently verifies scopes and live sessions before receipt lookup.

Retry a mutation with its exact complete command. Preserve omitted response fields, request ID, snapshot, and expected versions. While the artifact exists, an exact retry returns the original receipt, which can describe an older head or publication. Read fresh state separately. A conflict requires a deliberate new command, not a changed retry.

REST and MCP use the same sharing receipts. An exact share retry returns its historical share even after that share has been revoked. Replaying that command does not restore access. An exact unshare retry still returns 204 after removal. A new unshare command for a missing share returns 404. Changing the arguments of a reserved request ID returns 409 `request_conflict`. Email normalization applies before receipt comparison.

Export returns the store's deterministic ZIP bytes with `Content-Disposition`, `X-Artifact-SHA256`, and `X-Content-Type-Options: nosniff`. The HTTP adapter does not rebuild archives.

Permanent deletion from the panel invalidates historical content-bearing receipts. An exact create, update, publish or move retry for a deleted artifact returns `not_found`; request identity remains reserved, so a changed command still returns `request_conflict` and an old create cannot recreate it. Live-session and scope checks still precede replay. This package exposes no deletion operation.
