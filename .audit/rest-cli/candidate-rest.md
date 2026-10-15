# REST as the canonical remote artifact API

This is a design candidate, not an implementation or runtime acceptance report. It changes no application files. It uses the grounding in `frame.md`, `ground-domain.md`, and `ground-identity.md`, with direct source checks listed below.

## Usage

The CLI uses the existing protected resource URL. REST resides below that resource at `/v1`, so a deployment whose MCP endpoint is `/mcp` exposes `/mcp/v1/artifacts`.

```sh
artifacts login --server http://127.0.0.1:4101/mcp
artifacts create --snapshot ./snapshot.json --operation ./create.operation.json
artifacts list --limit 25
artifacts read ARTIFACT_ID --revision REVISION_ID
artifacts edit ARTIFACT_ID --changes ./changes.json --operation ./edit.operation.json
artifacts history ARTIFACT_ID --limit 5
artifacts publish ARTIFACT_ID --revision REVISION_ID --expected-version 0 --operation ./publish.operation.json
artifacts export ARTIFACT_ID --revision REVISION_ID --output ./artifact.zip
artifacts retry ./edit.operation.json
artifacts logout
```

Mutations persist an exact command before sending it. `--operation` selects a reviewable file. Its default is a new private file under the selected profile's operations directory. Commands print the operation path to stderr and JSON results to stdout. A conflict exits unsuccessfully and retains that operation. `retry` resends it unchanged. `update --command file.json` supports a complete existing update command without the edit convenience. The CLI never repairs a conflict by choosing a new expected revision itself.

A library caller supplies credentials through a callback. The client owns routing, bearer headers, response validation, and domain error reconstruction.

```ts
import { createArtifactClient } from '@artifacts/http/client';
import { prepareArtifactEdit } from '@artifacts/artifacts/workflow';

const artifacts = createArtifactClient({
	resource: 'http://127.0.0.1:4101/mcp',
	accessToken: () => credentials.accessToken(),
});
const command = await prepareArtifactEdit(artifacts, {
	artifactId,
	requestId: crypto.randomUUID(),
	changes: { metadata: { title: 'Reviewed' } },
});
await saveOperation({ kind: 'update', input: command });
const committed = await artifacts.update(command);
```

`credentials` and `saveOperation` belong to the caller. They are not HTTP-client requirements beyond the token callback. The CLI provides their durable implementations. The returned revision is the command's committed result. A separate `read` obtains the current head or publication after other writers act.

An embedder can expose the reusable Fetch server without MCP.

```ts
import { createArtifactRestHandler } from '@artifacts/http/server';

const rest = createArtifactRestHandler({
	resource: config.resource,
	issuer: config.issuer,
	introspectionClient: { id: config.clientId, secret: config.clientSecret },
	artifacts: createArtifactStore(db, { publishOrigin }),
});
serve({ fetch: rest, hostname: '127.0.0.1', port: 4101 });
```

The repository host composes MCP with that same REST handler. MCP receives a client factory instead of an `ArtifactStore`.

```ts
const mcp = createMcpApp({
	resource: config.resource,
	issuer: config.issuer,
	clientFor: (token) => createArtifactClient({
		resource: config.resource,
		accessToken: async () => token,
		fetch: rest,
	}),
});
```

The injected `fetch` uses real `Request` and `Response` serialization, REST route validation, bearer admission, and error mapping. It is not a direct-store adapter. Normal remote consumers use global `fetch`. The colocated host avoids a network call back into its own Worker while exercising the same API contract.

## Problem

Artifacts needs a reusable REST server, HTTP client, and authenticated CLI. Its store already owns immutable revisions, publication comparisons, ownership, and transactional command receipts. MCP and the panel currently call that store directly. This candidate gives all remote bearer clients one REST contract while preserving the panel's opaque-session model and store access.

The current authorization server binds grants and introspection links to the complete `MCP_URL`. A second URL cannot be treated as a second audience without changing provider resources and grants. This candidate keeps the existing resource identity and hosts both protocols within it.

## Shape

### Public contracts

The sketch derives inputs from the existing schemas. It does not duplicate snapshot, receipt, archive, or conflict rules. Bodies are intentionally absent.

```ts
import type { z } from 'zod';
import type {
	Actor, Archive, ArtifactRead, ArtifactSummary, Revision, UpdateInput,
	createSchema, readSchema, publishSchema, publishResultSchema,
	listSchema, historySchema, exportSchema,
} from '@artifacts/artifacts/contracts';
import type { CompactArtifactRead, RevisionSummary } from '@artifacts/artifacts/workflow';
import type { ArtifactStore } from '@artifacts/artifacts';

type CreateInput = z.input<typeof createSchema>;
type ReadInput = z.input<typeof readSchema>;
type PublishInput = z.input<typeof publishSchema>;
type PublishResult = z.output<typeof publishResultSchema>;
type ListInput = z.input<typeof listSchema>;
type HistoryInput = z.input<typeof historySchema>;
type ExportInput = z.input<typeof exportSchema>;
type Page<T> = { items: T[]; nextCursor: string | null };
type History<T> = { items: T[]; nextBeforeSequence: number | null };

type SnapshotCall<I> = {
	(input: I & { response: 'compact' }): Promise<CompactArtifactRead>;
	(input: I & { response?: 'full' }): Promise<ArtifactRead>;
	(input: I): Promise<ArtifactRead | CompactArtifactRead>;
};

interface ArtifactClient {
	identity(): Promise<Actor>;
	create: SnapshotCall<CreateInput>;
	read: SnapshotCall<ReadInput>;
	update: SnapshotCall<UpdateInput>;
	list(input?: ListInput): Promise<Page<ArtifactSummary>>;
	history(input: HistoryInput & { response: 'summary' }): Promise<History<RevisionSummary>>;
	history(input: HistoryInput & { response?: 'full' }): Promise<History<Revision>>;
	history(input: HistoryInput): Promise<History<Revision | RevisionSummary>>;
	publish(input: PublishInput): Promise<PublishResult>;
	export(input: ExportInput): Promise<Archive>;
}

type FetchHandler = (request: Request) => Promise<Response>;
type ClientOptions = {
	resource: string;
	accessToken: () => Promise<string>;
	fetch?: FetchHandler;
};

export function createArtifactClient(options: ClientOptions): ArtifactClient {
	throw new Error('not implemented');
}

export function createArtifactRestHandler(options: {
	resource: string;
	issuer: string;
	introspectionClient: { id: string; secret: string };
	artifacts: ArtifactStore;
}): FetchHandler {
	throw new Error('not implemented');
}

export function createMcpApp(options: {
	resource: string;
	issuer: string;
	clientFor: (accessToken: string) => ArtifactClient;
}): FetchHandler {
	throw new Error('not implemented');
}

type SavedOperation =
	| { kind: 'create'; input: CreateInput }
	| { kind: 'update'; input: UpdateInput }
	| { kind: 'publish'; input: PublishInput };

type LogoutResult = {
	local: 'cleared';
	refresh: 'revoked' | 'absent' | 'unconfirmed';
};

interface CliCredentials {
	login(options: { resource: string; openBrowser: boolean }): Promise<Actor>;
	accessToken(): Promise<string>;
	logout(): Promise<LogoutResult>;
}

export function openCliCredentials(profileDirectory: string): CliCredentials {
	throw new Error('not implemented');
}

export async function runCli(argv: readonly string[]): Promise<number> {
	throw new Error('not implemented');
}
```

The HTTP client exports domain results, not status codes, raw `Response`, or SDK-specific types. A domain error reconstructs the existing `ArtifactError`. A separate client error discriminates `unauthenticated`, `insufficient_scope`, `unavailable`, and `invalid_response`. The client does not read credentials from disk or mutate command inputs. `identity()` returns public identity data, not the server's private verified-principal brand. No caller can submit an actor through REST.

`SnapshotCall` keeps a full read compatible with `prepareArtifactEdit` and makes compact results visible in the return type. The optional `response` field remains absent when absent. The REST server projects compact results only after the store returns its complete receipt.

### Routes

All paths below are relative to `${resource}/v1`. Requests and responses use JSON except the optional ZIP representation. Every response containing identity or artifact data uses `Cache-Control: no-store`.

| Method and route | Input and result | Scope |
| --- | --- | --- |
| `GET /identity` | Verified identity | `artifacts:read` |
| `POST /artifacts` | Exact create command; full or compact retained result | `artifacts:write` |
| `GET /artifacts` | `limit`, `cursor`; stable ID page | `artifacts:read` |
| `GET /artifacts/:artifactId` | Optional `revisionId`, `response`; selected retained read | `artifacts:read` |
| `POST /artifacts/:artifactId/revisions` | Exact update command; full or compact retained result | `artifacts:write` |
| `GET /artifacts/:artifactId/revisions` | `limit`, `beforeSequence`, `response`; history page | `artifacts:read` |
| `POST /artifacts/:artifactId/publication` | Exact publish command; committed publication result | `artifacts:publish` |
| `GET /artifacts/:artifactId/revisions/:revisionId/export` | Existing `Archive`, or ZIP for `Accept: application/zip` | `artifacts:read` |

Update and publish bodies retain their existing `artifactId` field. The handler rejects a disagreement with the route. This permits exact persisted commands and preserves receipt hashes. Query values are parsed once into existing input schemas. Unknown fields and malformed numeric values fail with 400. The ingress cap remains 8 MiB, independent of the store's 1 MiB decoded-snapshot limit. Unsupported methods return 405.

The JSON error body is `{ error: { code, message, details } }`. Validation maps to 400, invalid bearer to 401, missing authority to 403, absent or unowned artifacts to 404, both conflict kinds to 409, body overflow to 413, and unavailable dependencies to 503. Preserve `currentRevisionId` and `currentPublicationVersion`. The 401 and scope-denial responses use the existing protected-resource metadata challenge. REST checks the actual operation scope. MCP keeps its existing `artifacts:read` admission requirement before any protocol dispatch.

The export handler calls the existing store export exactly once. JSON retains its base64 contract for MCP. Binary responses decode those same bytes and carry the existing digest and download filename. Neither route builds another archive format.

### Authentication and forwarding

Move `apps/mcp/src/identity.ts` into the private implementation of the REST server. Keep its JWT verification, Basic introspection credentials, fresh introspection per request, claim reconciliation, timeout, and redirect refusal. MCP delegates admission to `client.identity()` and forwards the original bearer token for artifact operations. The REST handler verifies that token again. It never accepts forwarded user IDs, actor JSON, panel cookies, an introspection secret from the caller, or a process-wide cached principal.

The composed Worker and Node server bind the client's fetch implementation to the REST handler. Only that composition root imports the store. `apps/mcp/src/http.ts` imports client and contract entry points, and no longer imports `ArtifactStore`. Delete its direct-store path in the same change. Tool names, schemas, annotations, JSON text, structured content, compact projections, and stateless legacy MCP transport remain compatible. Domain errors retain their existing MCP shape through client error reconstruction.

This is a canonical REST contract even when the host dispatches in memory. Every MCP artifact command serializes through that contract. Remote clients use the same bytes over HTTP. The panel deliberately remains a separate authenticated adapter to the store because its identity is an opaque OIDC session. Its library query, preview, review, publication grants, and protected publication service remain unchanged.

The canonical OAuth resource remains exactly `MCP_URL`, including its path. The CLI discovers the issuer through the existing protected-resource metadata and requests that resource in authorization, token exchange, and refresh. `auth-core.ts` configures this one resource. Installed `@better-auth/mcp` appends it to provider resources and default registration links. `bootstrap.ts` explicitly repairs the introspection client's link to the same identifier. The current confidential credentials therefore work for both protocols without another resource or secret.

A configurable arbitrary upstream URL is absent. A future separate REST deployment must explicitly pin its resource and destination, preserve audience linkage, refuse redirects, and forward only bearer credentials to that trusted resource. Sending a token issued for one resource to an unrelated REST audience is not a deployment shortcut.

### CLI credentials and uncertain operations

Use the existing `openid-client` dependency for public-client discovery, PKCE, authorization-code exchange, and refresh. Bind `127.0.0.1` on an ephemeral port before opening the browser. Reuse a profile-specific DCR registration with `application_type: native`, `token_endpoint_auth_method: none`, and a fixed callback path. The provider already permits a variable loopback port. Check state, exact callback path, issuer, and resource. Close the listener on success, error, cancellation, or timeout. `--no-browser` prints the authorization URL but retains the real callback flow.

Profiles are keyed by the normalized resource URL and verified issuer. Discovery must match that resource. All endpoints require HTTPS except exact loopback HTTP. Reject redirects on credential-bearing requests and pin the discovered issuer for later refresh. A changed issuer requires a new login. Secrets never appear in command arguments, stdout, operation files, or diagnostics.

Keep the initial credential store in a private local directory with 0700 permissions and 0600 files. One profile owns one token family. Use atomic replacement and a monotonically increasing generation. A cross-process exclusive lock covers token reread, refresh, token persistence, and logout. Do not share a mutable token file across different profiles. The reversible implementation choice is an established local-file lock dependency, selected after platform support is checked. Tests must prove two CLI processes share a single refresh result and logout cannot be undone by a delayed refresh. A lock that permits a live second writer does not satisfy this contract.

Do not hold that lock while the user completes browser login. Login captures the current generation and installs new credentials only if the generation still matches. Logout advances the generation and clears local tokens even when the authorization server is unavailable. A pending login or refresh cannot resurrect a cleared profile.

Record a refresh attempt before sending it. A lost refresh response can retry the same refresh token promptly within the provider's 30-second rotation replay window. If that outcome cannot be reconciled within the window, require a new login instead of reusing the old token indefinitely. Preserve the previous credential file until its successor is durably written. The provider's seven-day refresh lifetime and five-minute access lifetime remain unchanged.

Logout attempts refresh-token revocation using the public `client_id`, then clears local credentials and reports whether remote revocation was confirmed. The coordinator tested this against the real fixture during this design run and observed HTTP 200 for public-client refresh revocation. A provider helper comment claims otherwise, so implementation acceptance must retain the runtime check. The same probe observed HTTP 400 `unsupported_token_type` for JWT revocation and a still-valid access JWT after refresh revocation. Logout therefore does not promise immediate invalidation of a copied access JWT or account-wide logout. Existing central-session deletion remains the immediate global revocation boundary.

Artifact command persistence is independent of credential rotation. Store the selected resource, verified owner, command kind, and immutable command before its first submission. A retry after login must verify the same owner and resource. Credentials are excluded. An uncertain result leaves the command unchanged. A successful response may be saved beside it, without rewriting the original command. Never replace a receipt with a fresh read.

The store remains the only receipt authority. It checks operation scope and the live owner session before replay. Request IDs remain scoped to the owner across transports and command kinds. A lost-response retry can cross MCP and REST without a new revision. A reused ID with changed arguments returns `request_conflict`. Stale `expectedRevisionId` or `expectedPublicationVersion` returns `conflict`. No automatic rebase or publication-version increment occurs in the client.

### Module map and deployment

| Module | Ownership |
| --- | --- |
| `packages/artifacts` | Existing snapshots, store, ownership, revisions, receipts, CAS, publication, archive generation, and edit preparation |
| `packages/http/src/client.ts` | Typed REST client, route encoding, response parsing, and error reconstruction |
| `packages/http/src/server.ts` | Fetch routing, schema parsing, transport limits, scope selection, projections, and HTTP errors |
| `packages/http/src/identity.ts` | Private bearer verification moved from MCP |
| `packages/http/src/protocol.ts` | Private shared route definitions and response schemas used by client and server |
| `apps/mcp/src/http.ts` | Existing MCP protocol and tool metadata, backed exclusively by the HTTP client |
| `apps/mcp/src/server.ts`, `worker.ts` | Compose the store, REST handler, and MCP client-backed handler |
| `packages/cli/src/cli.ts` | Arguments, operation persistence, JSON output, and ZIP file output |
| `packages/cli/src/credentials.ts` | Browser OAuth, profile files, refresh serialization, and logout |
| `packages/cli/README.md`, `.agents/skills/artifacts-cli/SKILL.md` | Supported workflows, safe preparation and retry, authentication, and verification instructions |

Export only `@artifacts/http/client` and `@artifacts/http/server`. Keep protocol and identity internals unreachable through package exports. The client entry point must not import the store runtime, database driver, ZIP generator, callback listener, or credential persistence. The Node CLI does not enter Worker bundles.

Keep the existing four deployed services. Extend the MCP Worker and its Node server with REST routing. Preserve `MCP_URL`, current service names, auth resource links, introspection credentials, database bindings, and publication secrets. No fifth Worker, service-to-service secret, database migration, or production deployment is required. Extend release smoke and local development proof for the REST routes. Build Node dashboard and Worker variants sequentially because they share generated dashboard output.

The CLI and HTTP client must work outside this workspace. Build a Node executable JavaScript bundle with esbuild, a shebang, and a package `bin` entry. Ship compiled JavaScript and declarations for the HTTP client and server entry points. Bundle runtime contracts into the client output, and make emitted declarations self-contained or resolve through shipped compiled contract declarations. A `.ts` workspace export or an implicit `tsx` loader does not meet this requirement. Package installation must not require the repository checkout. Document the supported Node version and require no database environment variables for the CLI or HTTP client. Verify packed archives in a temporary consumer directory with ordinary `node` and the installed binary. Publishing to npm is outside this increment.

## Rationale

Boundary Discipline puts bearer admission and HTTP response validation in the REST package. MCP consumes domain results without reconstructing trusted actors. Type System Discipline derives commands from existing schemas and keeps compact and complete results distinct. Make Operations Idempotent preserves commands before transport and retains the original receipt after a lost response. These are the leaf skills read for this candidate.

The interface hides routing, authentication admission, decoding, projections, and error mapping behind one client factory and domain methods. Callers retain responsibility for deliberate edits and expected versions because those are user decisions. The reusable server remains thin over a deep transactional store. It does not add another service layer between the handler and store.

## Synthesis decision

Pending the coordinator's candidate comparison. This candidate proposes canonical REST with colocated Fetch dispatch as the base. It does not claim that an independent judge selected it.

## Tradeoffs accepted

- We accept MCP's dependence on REST serialization and response schemas in exchange for one remote artifact contract.
- We accept a fresh identity check before MCP dispatch and another before its artifact operation in exchange for no privileged forwarding header or cached authorization shortcut.
- We accept the existing `/mcp` resource name in REST URLs in exchange for preserving issued grants, discovery, and introspection linkage.
- We accept separate panel store access in exchange for preserving its opaque sessions, library query, and availability during an authorization HTTP outage.
- We accept private credential files and an explicit cross-process lock in the first CLI in exchange for a bounded local implementation. Operating-system keychain integration is a later storage substitution, not a requirement of the HTTP API.

## Alternatives considered

| Shape | What it hides | Cost relative to this candidate |
| --- | --- | --- |
| Shared core with MCP and REST adapters | The store hides all mutation and authorization invariants. A shared bearer authorizer hides identical credential checks. | Fewer internal round trips and a smaller diff. Both adapters still own projections and remote error mapping. This is a strong alternative if canonical REST is not a product requirement. |
| Separate REST Worker behind an MCP HTTP gateway | REST becomes an independently operated remote API and MCP has no database credentials. | Requires another deployment, trusted forwarding destination, resource policy, and failure boundary. Current load and ownership do not justify it. |
| CLI calls existing MCP only | Existing MCP protocol hides transport and uses current deployment. | Does not deliver the requested independent REST API or HTTP client. |

Shared-core adapters have better operational simplicity than a forced network hop. This candidate avoids that hop by colocating the Fetch handler while retaining one remote wire contract. It still has more serialization and admission work than direct shared-core adapters. No performance improvement is claimed.

## Open questions and risks

- Does the product value a single REST contract enough to justify migrating working MCP tools and performing another admission check per artifact call?
- Which operating systems must the first CLI support, so the lock dependency can be selected and its crash behavior tested before credential persistence ships?
- Is `/mcp/v1` acceptable as the initial REST URL while the existing resource identifier remains stable?

These questions do not block this design candidate. Its defaults are colocated REST, existing audience, and a private file-backed credential store. They require no production action.

## Verification plan

The coordinator's `coverage.md` owns the complete matrix. This candidate adds these architecture-specific checks. None ran in this design-only task.

1. Extend the disposable migrated-database HTTP fixture with the composed handler. Call every REST route directly, through the typed client, and through unchanged MCP tools. Assert exact identity, retained bytes, history order, publication version, and deterministic ZIP contents.
2. Start actual CLI subprocesses. Complete login through the real browser and loopback callback. Prove state rejection, callback timeout, repeated login registration reuse, private file permissions, expired-token refresh, concurrent refresh, logout during refresh, and logout during pending login. Retain the public-client refresh revocation probe and JWT behavior.
3. Create and edit through CLI, inspect through MCP and the built panel, publish through CLI, and open the protected publication page. Compare the panel download, direct REST ZIP, and MCP archive bytes. Keep browser and Worker builds sequential.
4. Race two updates against one expected head and two publications against one expected version. Require exactly one winner in each changed-state race. Preserve the losing command and conflict details. Retry a committed response dropped after database commit and require the original receipt with no extra revision.
5. Replay the same request across MCP and REST, including omitted and explicit `response` fields. Require the existing legacy hashes. Reject changed arguments, wrong owners, missing operation scopes, revoked central sessions, malformed introspection, issuer or audience mismatch, redirects, and introspection outages before any receipt is exposed.
6. Prove MCP has no direct-store alternative by inspecting package dependencies and exercising it against a REST fetch implementation that records every request. Check that client imports exclude database and ZIP dependencies and Worker bundles exclude CLI-only dependencies. Install packed CLI and HTTP packages into a temporary directory outside the repository. Run the installed binary, import the client through normal Node package exports, and type-check a consumer without source-workspace paths. The transport test supplements real HTTP tests.
7. Run existing artifact, workflow, OAuth, panel, database, publication, bootstrap, configuration, and release tests, then `pnpm check`, `pnpm test:browser`, and `pnpm build:workers` in the safe build order. Add anonymous REST denial and metadata checks to release smoke. Deployed verification requires a separate authorized deployment.

## Next implementation step

Implement the REST Fetch handler and typed client over the existing store, prove exact command and error compatibility over real HTTP, then migrate MCP to that tested client in the next complete increment.

## Evidence read

Direct source checks covered `packages/artifacts/src/contracts.ts`, `index.ts`, `workflow.ts`, the package exports, `apps/mcp/src/http.ts`, `identity.ts`, `server.ts`, `worker.ts`, `cloudflare.config.ts`, `apps/auth/src/auth-core.ts`, `http-core.ts`, `bootstrap.ts`, `revocation.ts`, `packages/config/src/index.ts`, `tests/helpers.ts`, `tests/oauth.test.ts`, `docs/decisions/identity.md`, `scripts/build-workers.ts`, and `scripts/cloudflare.ts`. Installed provider checks covered MCP resource registration defaults and OAuth-provider introspection linkage and revocation behavior. The coordinator supplied the explicitly attributed live revocation result above.

Workflow sources read were `poteto-mode`, `architect`, its runner prompt, rationale template and red flags, `how`, `technical-writing`, `unslop`, and the Boundary Discipline, Type System Discipline, and Make Operations Idempotent leaf skills. The candidate stays within the delegated design-only scope. Independent synthesis, implementation, and runtime acceptance remain separate gates.
