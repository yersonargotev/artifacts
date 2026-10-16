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
| GET | `/artifacts` | `limit`, `cursor` |
| GET | `/artifacts/:artifactId` | `revisionId`, `response` |
| PUT | `/artifacts/:artifactId` | Complete update command |
| GET | `/artifacts/:artifactId/history` | `limit`, `beforeSequence`, `response` |
| PUT | `/artifacts/:artifactId/publication` | Complete publish command |
| GET | `/artifacts/:artifactId/revisions/:revisionId/export` | None |

Command bodies use the existing strict contracts. Update and publish bodies include `artifactId`, which must match the route. Unknown or repeated query parameters fail. Body streaming stops after 8 MiB. Create and its receipt replay return 201. Other successes return 200. All protected responses use `Cache-Control: no-store`.

```sh
curl --fail-with-body "$ARTIFACTS_SERVER/v1/identity" \
	-H "Authorization: Bearer $ARTIFACTS_ACCESS_TOKEN"
curl --fail-with-body "$ARTIFACTS_SERVER/v1/artifacts" \
	-H "Authorization: Bearer $ARTIFACTS_ACCESS_TOKEN" \
	-H 'Content-Type: application/json' --data-binary @create-command.json
```

The metadata URL is `/.well-known/oauth-protected-resource` followed by the canonical resource path. Check its `resource` field against the configured canonical resource. REST route challenges omit `resource_metadata` because those route URLs differ from the OAuth audience.

## Errors and retries

Errors have the shape `{ "error": { "code": "conflict", "message": "Artifact head changed", "details": { "currentRevisionId": "..." } } }`. Invalid input returns 400, missing authentication 401, forbidden access 403, missing owned objects 404, conflicts 409, oversized requests 413, unsupported content types 415, unsupported methods 405 with `Allow`, and unavailable dependencies 503.

Every bearer request verifies signature, claims, and fresh introspection. Reads require `artifacts:read`, create and update require `artifacts:write`, and publication requires `artifacts:publish`. The store independently verifies scopes and live sessions before receipt lookup.

Retry a mutation with its exact complete command. Preserve omitted response fields, request ID, snapshot, and expected versions. While the artifact exists, an exact retry returns the original receipt, which can describe an older head or publication. Read fresh state separately. A conflict requires a deliberate new command, not a changed retry.

Export returns the store's deterministic ZIP bytes with `Content-Disposition`, `X-Artifact-SHA256`, and `X-Content-Type-Options: nosniff`. The HTTP adapter does not rebuild archives.

Permanent deletion from the panel invalidates historical content-bearing receipts. An exact create, update or publish retry for a deleted artifact returns `not_found`; request identity remains reserved, so a changed command still returns `request_conflict` and an old create cannot recreate it. Live-session and scope checks still precede replay. This package exposes no deletion operation.
