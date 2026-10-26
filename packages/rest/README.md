# Artifacts REST

`createArtifactRestApp(config, store)` returns a Fetch handler. It does not import or construct MCP. The caller supplies the canonical artifact store and the existing bearer resource configuration. Build compiled JavaScript, declarations, and tarballs with `pnpm build:packages`. Install the generated contracts, config, db, artifacts, and rest tarballs together in an external server project. The [repository instructions](https://github.com/yersonargotev/artifacts/blob/5ccb12e7cb9711c7919171602b3af7006e8bc6cc/README.md#use-the-standalone-cli-or-rest-client) describe local installation.

```ts
import { createArtifactRestApp } from '@artifacts/rest';

const fetch = createArtifactRestApp({
	resource: 'https://artifacts.example/mcp',
	issuer: 'https://accounts.example/api/auth',
	clientId: process.env.MCP_INTROSPECTION_CLIENT_ID,
	clientSecret: process.env.MCP_INTROSPECTION_CLIENT_SECRET,
}, store);
```

The canonical resource is the existing complete `MCP_URL`. API routes live at `${MCP_URL}/v1`. Direct consumers need no MCP session. The default Worker composes both adapters. `pnpm dev:rest` starts the REST-only Node listener using `DATABASE_URL`, optional `DATABASE_AUTH_TOKEN`, `AUTH_URL`, `MCP_URL`, `PUBLISH_URL`, both introspection credentials, and the existing `MCP_PORT` and `MCP_BIND_HOST` variables. This entry point reads explicit environment variables and does not load `.env`.

## Routes

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

The metadata URL is `/.well-known/oauth-protected-resource` followed by the canonical resource path. Check its `resource` field against the configured canonical resource. REST route challenges omit `resource_metadata` because those route URLs differ from the OAuth audience.

## Sharing

Only an artifact's owner can create, list, or revoke its shares. All three routes require `artifacts:publish`, including GET. An email is trimmed and lowercased. Sharing the same email again returns the existing share. A share has `shareId`, `artifactId`, `kind: "email"`, `value`, and `createdAt`. Listing returns `{ "items": [share] }`.

A verified guest whose email matches a share can open the published revision. A share on an artifact that has never been published waits until publication. Revoking a share denies the guest's next read. Sharing does not grant access to owner history, export, editing, or share management.

The typed client's `share` and `unshare` methods accept complete commands with route identifiers. `listShares` accepts `{ artifactId }`. The client projects the short HTTP bodies, validates returned shares, and resolves `unshare` with `undefined` only after an empty 204 response.

## Errors and retries

Errors have the shape `{ "error": { "code": "conflict", "message": "Artifact head changed", "details": { "currentRevisionId": "..." } } }`. Invalid input returns 400, missing authentication 401, forbidden access 403, missing owned objects 404, conflicts 409, oversized requests 413, unsupported content types 415, unsupported methods 405 with `Allow`, and unavailable dependencies 503.

Every bearer request verifies signature, claims, and fresh introspection. Artifact reads, artifact lists, and projects require `artifacts:read`. Create, update, and move require `artifacts:write`. Publication and every sharing route require `artifacts:publish`. A missing scope returns 403 with JSON code `forbidden`, `details.requiredScopes`, and a `WWW-Authenticate` challenge containing `insufficient_scope`. The store independently verifies scopes and live sessions before receipt lookup.

Retry a mutation with its exact complete command. Preserve omitted response fields, request ID, snapshot, and expected versions. While the artifact exists, an exact retry returns the original receipt, which can describe an older head or publication. Read fresh state separately. A conflict requires a deliberate new command, not a changed retry.

REST and MCP use the same sharing receipts. An exact share retry returns its historical share even after that share has been revoked. Replaying that command does not restore access. An exact unshare retry still returns 204 after removal. A new unshare command for a missing share returns 404. Changing the arguments of a reserved request ID returns 409 `request_conflict`. Email normalization applies before receipt comparison.

Export returns the store's deterministic ZIP bytes with `Content-Disposition`, `X-Artifact-SHA256`, and `X-Content-Type-Options: nosniff`. The HTTP adapter does not rebuild archives.

Permanent deletion from the panel invalidates historical content-bearing receipts. An exact create, update, publish or move retry for a deleted artifact returns `not_found`; request identity remains reserved, so a changed command still returns `request_conflict` and an old create cannot recreate it. Live-session and scope checks still precede replay. This package exposes no deletion operation.
