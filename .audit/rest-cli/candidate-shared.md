# Shared-core REST and MCP adapters

This is a design candidate. No application implementation or runtime acceptance is claimed. REST and MCP call the existing store. The CLI calls REST. The candidate preserves the store as the only owner of artifact SQL, receipts, revision comparisons, and publication transitions.

## Usage

A CLI user signs in through the existing authorization server and works with retained artifacts without an MCP client. The API URL identifies the REST transport. Its metadata identifies the existing OAuth resource.

```sh
artifacts login --url https://artifacts.example.test/api/v1
artifacts whoami
artifacts create --snapshot ./snapshot.json
artifacts list --limit 25
artifacts read ARTIFACT_ID --out ./current.json
artifacts update ARTIFACT_ID --snapshot ./next-snapshot.json --expected-revision REVISION_ID
artifacts history ARTIFACT_ID --summary
artifacts publish ARTIFACT_ID --revision REVISION_ID --expected-version 0
artifacts export ARTIFACT_ID --revision REVISION_ID --out ./artifact.zip
artifacts retry REQUEST_ID
artifacts logout
```

`create`, `update`, and `publish` prepare a complete command and retain it before the first HTTP attempt. Each prints the generated request ID and retry command to stderr before sending. Successful JSON goes to stdout. `--request-id` accepts a caller-owned ID. `--command FILE` accepts a complete previously prepared command instead of reconstructing it from flags. `retry` loads the retained command without reading or editing the artifact again. The exact optional `response` field, array order, snapshot, expected revision, and expected publication version survive a retry.

`update` takes a complete snapshot. A separate `edit ARTIFACT_ID --changes FILE` convenience command uses the existing `prepareArtifactEdit` helper, performs a full current-head read, preserves untouched fields, and persists the resulting update before submission. A CAS conflict exits with code 3. It requires a new deliberate edit and request ID. Invalid local input exits with code 2. Authentication failures exit with code 4. Unavailable or uncertain transport outcomes exit with code 5 and retain the command.

`logout` revokes the stored refresh token and removes local credentials even when the remote call fails. It reports whether remote refresh revocation was confirmed. An already issued JWT can remain valid for its five-minute lifetime. The existing authorization-page global revocation deletes central sessions and stops REST, MCP, and panel access immediately. Logout does not claim to perform global revocation.

A direct HTTP consumer uses the same command fields and resource scopes. `TOKEN` below is an access token acquired through the advertised authorization-code flow. Credentials never appear in a URL.

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @create-command.json \
  https://artifacts.example.test/api/v1/artifacts

curl --fail-with-body \
  -H "Authorization: Bearer $TOKEN" \
  'https://artifacts.example.test/api/v1/artifacts/ARTIFACT_ID?response=compact'

curl --fail-with-body \
  -H "Authorization: Bearer $TOKEN" \
  --output artifact.zip \
  https://artifacts.example.test/api/v1/artifacts/ARTIFACT_ID/revisions/REVISION_ID/export
```

The installed HTTP client has no database, ZIP implementation, Node credential storage, or MCP dependency. It accepts a token supplier rather than owning login or persistence.

```ts
import { createArtifactHttpClient } from '@artifacts/client';
import { prepareArtifactEdit } from '@artifacts/contracts/workflow';

const client = createArtifactHttpClient({
	url: new URL('https://artifacts.example.test/api/v1'),
	accessToken: async () => credentials.accessToken(),
});
const created = await client.create({
	requestId: 'create-report-2026-10-14',
	snapshot,
});
const command = await prepareArtifactEdit(client, {
	artifactId: created.artifactId,
	requestId: 'edit-report-2026-10-14',
	changes: { metadata: { title: 'Revised report' } },
});
await savePreparedCommand(command);
const committed = await client.update(command);
const published = await client.publish({
	requestId: 'publish-report-2026-10-14',
	artifactId: committed.artifactId,
	revisionId: committed.revision.id,
	expectedPublicationVersion: committed.publication?.version ?? 0,
});
const archive = await client.export({
	artifactId: committed.artifactId,
	revisionId: committed.revision.id,
});
```

`savePreparedCommand` belongs to this caller. The library never creates another ID or silently prepares another edit after an uncertain result. Repeating `client.update(command)` returns the same domain result if the first request committed. A receipt is a past commitment. A subsequent `read` reports current head or publication state.

A Node service or Worker can host REST without importing the MCP application. The server factory returns a standard Fetch handler. Runtime configuration and the database connection remain the host's responsibility.

```ts
import { serve } from '@hono/node-server';
import { createArtifactStore } from '@artifacts/artifacts';
import { createArtifactRestApp } from '@artifacts/rest';

const fetch = createArtifactRestApp({
	url: new URL('https://artifacts.example.test/api/v1'),
	bearer: {
		issuer: 'https://auth.example.test/api/auth',
		resource: 'https://artifacts.example.test/mcp',
		introspectionClientId,
		introspectionClientSecret,
	},
	artifacts: createArtifactStore(db, {
		publishOrigin: 'https://published.example.test',
	}),
});
serve({ fetch, hostname: '127.0.0.1', port: 4103 });
```

An independent REST deployment can serve the same canonical resource at an explicitly configured API URL. Its confidential introspection client must be linked to that resource. Default repository deployment adds the REST routes to the existing MCP Worker and Node listener. It requires no new public service or confidential client.

## Problem

The existing system already has the required artifact operations and concurrency model. A new protocol must preserve their behavior while providing an authenticated standalone API and CLI. The difficult boundaries are live bearer admission, exact command identity, cross-process refresh rotation, and useful results after an uncertain write. The [artifact decision](../../docs/decisions/artifacts.md) assigns all artifact state to the store. The [identity decision](../../docs/decisions/identity.md) kept credential-specific application admission separate. A second bearer transport now justifies sharing that bearer policy while the panel retains its opaque-session policy.

## Shape

### Package and module map

The design introduces three reusable packages and one CLI application. A dedicated contracts package is the minimum additional boundary that gives the separately installable client shared runtime validators without installing the store's database dependencies.

| Module | Owned knowledge | Dependencies and compatibility |
| --- | --- | --- |
| `packages/contracts/src/index.ts`, `workflow.ts`, `serialization.ts` | Existing domain schemas, domain errors, projections, comparisons, and complete edit preparation. Adds missing client-result schemas beside their authoritative domain definitions. | Zod and the existing pure utilities. No database, HTTP server, or archive builder. Existing `@artifacts/artifacts`, `./contracts`, and `./workflow` exports re-export the same definitions to preserve current imports and `ArtifactError` identity. |
| `packages/artifacts/src/index.ts` | Existing store and deterministic ZIP generation. | Imports contracts. Owns all artifact SQL, authorization inside transactions, receipts, CAS, publication grants, and viewers. No new command coordinator. |
| `packages/rest/src/index.ts` | Fetch routing, URL/body parsing, body limit, response projection, binary export, and stable HTTP error mapping. | Imports contracts, the store's public type, and its own bearer module. Its factory accepts a caller-created store. |
| `packages/rest/src/bearer.ts` | Existing signature verification, claims checks, uncached authenticated introspection, reconciliation, and verified principal construction. | Moves from `apps/mcp/src/identity.ts` without changing policy. Exposed as `@artifacts/rest/bearer` for the two bearer adapters. Uses `jose` and Zod. No panel admission. |
| `packages/client/src/index.ts` | Typed authenticated HTTP operations, fixed request encoding, bounded response parsing, binary archive decoding, and typed errors. | Depends only on contracts. Uses Fetch supplied by the runtime or caller. No application or database import. |
| `apps/cli/src/main.ts` | Argument parsing, stdout/stderr, snapshot and command files, exports, and exit status. | Depends on client, contracts, and its private auth module. Exposes the `artifacts` bin and a root development script. |
| `apps/cli/src/auth.ts` | Discovery, native registration, loopback PKCE, token refresh, logout, and durable credential generations. | Reuses installed `openid-client` 6.8.8. Uses Node's built-in SQLite for one local credential table. No server database credentials. |
| `apps/mcp/src/http.ts` | Existing tool registration, MCP protocol, and tool projections. | Imports the shared bearer authorizer and continues to call the store directly. Tool names and schemas remain compatible. |
| `apps/mcp/src/server.ts`, `worker.ts` | Runtime composition. | Construct one store and dispatch the exact API prefix and REST metadata path to the REST handler, then preserve existing MCP routes. No forwarding HTTP request inside the Worker. |
| `apps/dashboard` and `apps/publication` | Existing panel sessions, authoring, review, protected publication, and viewer boundaries. | Keep direct store calls and existing deployment credentials. Contracts use one package instance in the Node dashboard build. Publication receives no database access. |

Package `exports` expose only the documented entry points. Source-relative imports across package boundaries fail the repository check. Moving contracts does not introduce a second implementation. The old entry points are explicit compatibility re-exports, and the new canonical definitions have one owner.

An all-subpaths alternative would add `@artifacts/artifacts/rest`, `client`, and `bearer` without new reusable packages. That has fewer manifests, but installing the HTTP client would also install `@artifacts/db`, Drizzle, and `fflate` through `@artifacts/artifacts/package.json`. Bundler tree shaking cannot remove installation dependencies. Separate REST and client packages justify their boundaries through independent deployment and consumption. The pure contracts package prevents duplicate validators and breaks that transitive dependency. A separate bearer-policy package adds no useful consumer beyond these two adapters, so bearer policy stays inside REST's dedicated HTTP package.

Distribution uses a separate staging directory. Workspace imports continue to resolve current source during development and tests. A package build emits ESM JavaScript and declarations and writes packed manifests whose `exports` target those files. It never switches workspace exports to a `dist` directory that has not been built. The CLI package contains an executable JavaScript bin with a Node shebang and bundles ordinary dependencies with the installed esbuild. Node built-ins remain external. The HTTP client and reusable server ship JavaScript and declarations without requiring `tsx` or a repository checkout. Local tarball dependencies use concrete package versions. No npm publication is required.

The server and store use the same external `@artifacts/contracts` runtime when built or packed together. `ArtifactError` is declared exactly once in that package. Store and compatibility entry points re-export that class. Server bundles do not inline another contracts copy. Node dashboard build rules preserve the same instance across adapter and store. A consumer test must provoke an actual store error through the independently installed server and assert its exact HTTP mapping, so packaging cannot turn a conflict into an unavailable response.

### Domain types and public signatures

These are sketches. All new bodies stop at `not implemented`. Existing domain types and behavior are moved or re-exported rather than rewritten.

```ts
import type { z } from 'zod';
import type {
	Actor, Archive, ArtifactRead, ArtifactSummary, Publication, Revision,
	UpdateInput as DomainUpdateInput,
	createSchema, readSchema, updateSchema, publishSchema,
	historySchema, exportSchema, listSchema,
} from '@artifacts/contracts';
import type {
	CompactArtifactRead, RevisionSummary,
} from '@artifacts/contracts/workflow';
import type { ArtifactStore } from '@artifacts/artifacts';

type ReadMode = 'full' | 'compact';
type HistoryMode = 'full' | 'summary';
type ReadResult<M extends ReadMode> =
	M extends 'compact' ? CompactArtifactRead : ArtifactRead;
type HistoryPage<M extends HistoryMode> = {
	items: Array<M extends 'summary' ? RevisionSummary : Revision>;
	nextBeforeSequence: number | null;
};
type CreateInput<M extends ReadMode = 'full'> =
	Omit<z.input<typeof createSchema>, 'response'> & { response?: M };
type ReadInput<M extends ReadMode = 'full'> =
	Omit<z.input<typeof readSchema>, 'response'> & { response?: M };
type UpdateInput<M extends ReadMode = 'full'> =
	Omit<DomainUpdateInput, 'response'> & { response?: M };
type HistoryInput<M extends HistoryMode = 'full'> =
	Omit<z.input<typeof historySchema>, 'response'> & { response?: M };
type PublishInput = z.input<typeof publishSchema>;
type ExportInput = z.input<typeof exportSchema>;
type ListInput = z.input<typeof listSchema>;
type ListPage = { items: ArtifactSummary[]; nextCursor: string | null };
type PublishReceipt = Publication & { artifactId: string };
type Identity = Pick<Actor, 'userId' | 'sessionId' | 'clientId' | 'scopes'>;

export type ArtifactHttpClient = {
	whoami(): Promise<Identity>;
	create<M extends ReadMode = 'full'>(input: CreateInput<M>): Promise<ReadResult<M>>;
	list(input?: ListInput): Promise<ListPage>;
	read<M extends ReadMode = 'full'>(input: ReadInput<M>): Promise<ReadResult<M>>;
	update<M extends ReadMode = 'full'>(input: UpdateInput<M>): Promise<ReadResult<M>>;
	history<M extends HistoryMode = 'full'>(input: HistoryInput<M>): Promise<HistoryPage<M>>;
	publish(input: PublishInput): Promise<PublishReceipt>;
	export(input: ExportInput): Promise<Archive>;
};

export function createArtifactHttpClient(options: {
	url: URL;
	accessToken: () => Promise<string>;
	fetch?: typeof globalThis.fetch;
}): ArtifactHttpClient {
	throw new Error('not implemented');
}

export type ArtifactClientError =
	| { kind: 'authentication'; message: string }
	| { kind: 'forbidden'; message: string; requiredScope?: string }
	| { kind: 'not_found'; message: string }
	| { kind: 'conflict'; message: string;
		currentRevisionId?: string; currentPublicationVersion?: number }
	| { kind: 'request_conflict'; message: string }
	| { kind: 'invalid_input'; message: string }
	| { kind: 'unavailable'; message: string };
```

The actual client throws one exported error class carrying this discriminated failure value. It does not export HTTP status numbers, `Response`, wire envelopes, or internal Zod inference objects as the caller's result. Domain input types remain derived from the canonical schemas. Full and compact results remain distinct in the type system. A full read remains structurally compatible with `prepareArtifactEdit`.

```ts
export type BearerConfiguration = Readonly<{
	issuer: string;
	resource: string;
	introspectionClientId: string;
	introspectionClientSecret: string;
}>;

const principalBrand: unique symbol = Symbol('verified-principal');
export type VerifiedPrincipal = Actor & { readonly [principalBrand]: true };
export type BearerDecision =
	| { kind: 'authorized'; principal: VerifiedPrincipal }
	| { kind: 'unauthenticated' }
	| { kind: 'insufficient-scope'; required: readonly string[] }
	| { kind: 'unavailable' };

export function createBearerAuthorizer(config: BearerConfiguration):
	(request: Request, required: readonly string[]) => Promise<BearerDecision> {
	throw new Error('not implemented');
}

export function createArtifactRestApp(options: {
	url: URL;
	bearer: BearerConfiguration;
	artifacts: ArtifactStore;
}): (request: Request) => Promise<Response> {
	throw new Error('not implemented');
}
```

REST owns the only HTTP-to-domain mapping. Routes parse path and query values, reject unknown body fields, and call the current store method. The server does not parse an authenticated actor from JSON. Its authorizer constructs the principal from verified claims. Transport parsing preserves an omitted `response` field. The store continues its own command-boundary parsing because existing public callers still submit external commands.

| HTTP operation | Domain call and result | Required scope |
| --- | --- | --- |
| `GET /api/v1/identity` | Verified identity from fresh bearer admission. | `artifacts:read` |
| `POST /api/v1/artifacts` | `create(principal, body)`, JSON full or compact receipt. Returns 201 for initial and matching replay. | `artifacts:write` |
| `GET /api/v1/artifacts` | `list(principal, parsedQuery)`, JSON page. | `artifacts:read` |
| `GET /api/v1/artifacts/:id` | `read(principal, { artifactId, ...parsedQuery })`, JSON full or compact read. | `artifacts:read` |
| `PUT /api/v1/artifacts/:id` | `update(principal, { artifactId, ...body })`, JSON full or compact receipt. The body contains request ID, expected revision, and complete snapshot. | `artifacts:write` |
| `GET /api/v1/artifacts/:id/history` | `history(principal, { artifactId, ...parsedQuery })`, JSON full or summary page. | `artifacts:read` |
| `PUT /api/v1/artifacts/:id/publication` | `publish(principal, { artifactId, ...body })`, JSON publication receipt. | `artifacts:publish` |
| `GET /api/v1/artifacts/:id/revisions/:revisionId/export` | `export(principal, { artifactId, revisionId })`, exact ZIP bytes. | `artifacts:read` |

Artifact IDs in paths are decoded and validated once. Body IDs are absent by contract and cannot override paths. Pagination keeps current list and history limits. No `DELETE`, patch protocol, independent upload lifecycle, or new publication-viewer route is introduced.

Every authenticated response uses `Cache-Control: no-store`. Export decodes the store's `Archive.base64` and uses its filename, media type, and SHA-256. The response supplies `Content-Disposition`, `X-Content-Type-Options: nosniff`, and `X-Artifacts-SHA256`. The client checks ZIP bytes against the digest and reconstructs the existing `Archive` value. It never builds another ZIP. Mutation projections happen after the complete store receipt returns.

HTTP admission failures map to 401, 403, or 503 and preserve the protected-resource challenge. Domain `forbidden`, `not_found`, `conflict`, and `request_conflict` map to 403, 404, 409, and 409. Invalid input maps to 400, oversize input to 413, and unsupported methods to 405 with `Allow`. Unexpected errors become a non-sensitive 503. Error bodies carry stable error codes, messages, and the domain's conflict details. Store exceptions never become a successful HTTP body.

The REST body reader enforces the existing MCP ingress cap of 8 MiB before JSON parsing. The domain still enforces its distinct 1 MiB decoded snapshot limit and 32-file limit. The client rejects unexpected content types, malformed results, redirects, and responses above an explicit bound derived from the largest allowed JSON or ZIP result. It sends credentials only to its configured API URL. It does not follow a redirect with authorization.

### OAuth resource and fresh admission

The configured resource remains the exact current `MCP_URL`, including `/mcp`. REST is another transport for that resource. `GET /.well-known/oauth-protected-resource/api/v1` on the REST origin advertises that canonical identifier, existing scopes, header bearer support, and the existing issuer. REST challenges link to that document. Existing MCP metadata and the root metadata route retain their current meaning.

This choice follows inspected source rather than URL symmetry. `packages/config/src/index.ts` assigns `authConfig.resource` from `MCP_URL`. `apps/auth/src/auth-core.ts` passes that value to the provider's `mcp({ resource })` configuration. `apps/auth/src/bootstrap.ts` creates or verifies `MCP_INTROSPECTION_CLIENT_ID` and links it through `adminLinkClientResource` to that same identifier. Installed `@better-auth/oauth-provider` 1.7.7 authorizes cross-client introspection through `isClientLinkedToAnyResource` in `dist/introspect-CNR06Oy3.mjs`, lines 555-577. An arbitrary new REST audience would therefore be incomplete without provider resource registration, issuance changes, and the corresponding introspection-client link.

Default composition reuses the existing introspection credentials because both handlers serve the same canonical resource in the same Worker. Independent hosting may use separately provisioned confidential credentials linked to that same resource. Reusing an audience is an explicit decision to give the same scopes the same authority through both protocols. It does not authorize accepting any audience on the same origin.

The extracted authorizer preserves the current signed `sub`, nonempty `sid`, issuer, resource audience, expiry, `client_id`, `azp`, scope, and no-`cnf` checks. It obtains fresh authenticated introspection for every protected request and reconciles identity, audience, expiry, and scopes with the signed JWT. Redirects and unavailable or malformed introspection fail closed. Only signing keys may be cached. REST chooses the operation's required scope before invoking the authorizer. The store rechecks that scope and the live canonical owner's central session inside the transaction before any receipt lookup. MCP preserves its current initial read-scope requirement and per-operation store checks.

The CLI discovers the REST protected-resource document, then the exact advertised issuer. Discovery and registration permit HTTPS or explicit loopback HTTP only. The CLI binds the issuer and resource to the selected API profile, rejects mismatched discovery issuer values, and does not send a token to metadata-selected arbitrary API hosts. OAuth endpoints must match the configured issuer's origin, or login fails. State and PKCE validation use `openid-client`, which already owns those checks in the panel.

Native login binds `127.0.0.1` on an ephemeral port before opening the browser. It registers a public native client with `token_endpoint_auth_method: none`, an exact callback path, code and refresh grants, and PKCE. Authorization and token exchange both send the canonical resource. Each login attempt has its own callback listener, state, verifier, and public client. The CLI requests `openid profile offline_access artifacts:read artifacts:write artifacts:publish` by default and permits explicit narrower scopes. `--no-browser` prints the same authorization URL while retaining the loopback callback flow. No password collection, pasted access-token login, client secret, device flow, or authentication bypass is required.

The provider already accepts native registration and loopback port variation in `apps/auth/src/http-core.ts` and `tests/helpers.ts`. The [recorded fixture experiment](oauth-probe.md) confirmed that a public DCR client can revoke its refresh token with `client_id` and no secret. That experiment also confirmed access-token revocation returns `unsupported_token_type` because JWTs are self-contained. This candidate does not claim those experiments as its own runtime work.

### Credential and command concurrency

```ts
type CredentialProfile = Readonly<{
	apiUrl: string;
	issuer: string;
	resource: string;
}>;
type Credentials = Readonly<{
	clientId: string;
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
}>;
type CredentialState =
	| { kind: 'signed-out'; epoch: number }
	| { kind: 'signed-in'; epoch: number; credentials: Credentials };
type LoginAttempt = Readonly<{
	profile: CredentialProfile;
	epoch: number;
	state: string;
	verifier: string;
	clientId: string;
	redirectUri: string;
}>;
type LogoutResult =
	| { kind: 'local-and-refresh-revoked' }
	| { kind: 'local-only'; reason: string };

type CliAuth = {
	login(profile: CredentialProfile, options: { openBrowser: boolean }): Promise<Identity>;
	accessToken(profile: CredentialProfile): Promise<string>;
	logout(profile: CredentialProfile): Promise<LogoutResult>;
};

function openCliAuth(stateDirectory: string): CliAuth {
	throw new Error('not implemented');
}

type PreparedCommand =
	| { operation: 'create'; input: CreateInput<ReadMode> }
	| { operation: 'update'; input: UpdateInput<ReadMode> }
	| { operation: 'publish'; input: PublishInput };

async function retainCommand(profile: CredentialProfile,
	ownerId: Identity['userId'], command: PreparedCommand): Promise<string> {
	throw new Error('not implemented');
}

async function executeRetainedCommand(client: ArtifactHttpClient,
	commandFile: string): Promise<void> {
	throw new Error('not implemented');
}
```

The CLI keeps credentials in one local `auth.sqlite` file under a private state directory. One row per normalized API profile contains an epoch and the signed-in or signed-out state. The file and rollback journals use mode 0600 inside a 0700 directory. The CLI rejects symlink state paths. A `BEGIN IMMEDIATE` transaction owns a refresh or logout from reread through network response and atomic credential update. A bounded busy retry waits for the other subprocess instead of taking a stale lock or rotating the same refresh token twice. The network timeout bounds the lock duration. Process death releases the database lock automatically.

This local database does not change the application database or require a server migration. The installed HTTP client does not import `node:sqlite`. Local inspection confirmed `DatabaseSync` and `BEGIN IMMEDIATE` are available on this workspace's Node v24.12.0. That execution emitted Node's experimental SQLite warning. The CLI must document and test its supported Node range, and this candidate accepts that built-in API risk instead of adding a native lock dependency or unsafe lease stealing. If an experimental built-in is unacceptable for distribution, replace only private credential storage with a proven OS-lock implementation before implementation begins. The client and server contracts do not depend on that choice.

Login reserves a new epoch under a brief transaction before the browser flow. It saves the callback's tokens only if that epoch still matches. It never holds a database lock while the browser is open. Logout advances the epoch and clears credentials under the same writer transaction after attempting refresh revocation. A delayed callback cannot sign the user back in. Concurrent login attempts have independent callback state and clients. Only the latest reserved epoch can install credentials. Refresh rereads after obtaining the writer transaction and skips rotation if another process already saved a sufficiently fresh token.

After a refresh response is lost, the CLI can replay that same refresh token within the provider's existing thirty-second grace interval. It cannot promise recovery after that interval or after the provider rejects the family. It then requires login. Provider central-session deletion remains the authority boundary even if its known refresh-family invalidation race returns another JWT.

Prepared artifact commands are independent immutable files, one per request ID and profile. Atomic exclusive creation detects local ID reuse with different content. Completed results are separate files, so a writer never rewrites the original command. Concurrent edits have separate command files and compete only through the server's intended CAS. Two retries of one command may run simultaneously because the store converges on one receipt. Commands and result files receive the same private permissions as credentials because they can contain retained content.

The HTTP client makes one submission per method call and never generates IDs or rebases conflicts. The CLI can make one bounded transport retry with the retained command. For a persistent outage it reports uncertainty and the exact retry command. It never retries a 409 as a new operation. `retry` checks that the current authenticated owner matches the command's original verified owner before submission. Server ownership and current authority remain authoritative. Client checks add useful diagnostics rather than granting access.

### Immutable receipts, CAS, and compatibility

The store's receipt key remains canonical owner plus request ID across clients and transports. The command fingerprint remains the existing canonical JSON of `{ kind, input }`. No REST headers, URL, transport name, client ID, or extra envelope field enters it. An omitted `response` stays omitted. No migration or fingerprint version is introduced.

A write commits the revision or publication change and receipt together. Replaying a lost response returns its original head and publication fields even when later edits have changed current state. REST and CLI label this as the committed result. A separate current read is required for current state. A changed argument under the same request ID returns `request_conflict`. A stale expected revision or publication version returns `conflict`, leaves no new revision or receipt, and never causes a hidden read-and-rebase loop.

The REST principal's owner cannot come from input. Authorization and live-session checks precede receipt replay in the existing store. A different owner cannot retrieve another owner's receipt. A revoked central session or missing operation scope cannot recover an earlier successful result. REST repeats these checks through both bearer admission and the store rather than moving receipt lookup into an HTTP cache.

MCP retains its tools, input schemas, structured content, projections, legacy stateless mode, and `/mcp` endpoint. The panel retains its opaque session, direct store API, review semantics, and protected preview. Publication keeps its separate Worker and no database credentials. A REST-created artifact is an ordinary retained artifact and appears in the existing MCP list and panel library without synchronization. Compact JSON and summary history are projections of the same full results.

### Interface depth and red-flag screen

Boundary Discipline keeps transport parsing, authentication, and error mapping at HTTP and CLI boundaries. The client hides URL construction, bearer headers, result validation, and binary conversion behind domain methods. The server hides bearer policy and transport details behind one Fetch factory. The store still hides transactional artifact invariants. The separate client and server factories earn their interfaces through different deployment and dependency needs.

Model the Domain shapes credentials as signed-in or signed-out states with an epoch rather than independent token and logout flags. Type System Discipline derives inputs from existing schemas and distinguishes compact results. Make Operations Idempotent preserves complete commands and delegates durable replay to the existing store. Separate Before Serializing Shared State gives independent artifact operations separate files and serializes only the inherently shared rotating credential. Laziness Protocol keeps MCP direct and avoids a service, repository, or generic transport abstraction. Minimize Reader Load keeps the REST route-to-store operation in one adapter file.

The design passes the inspected red flags. It adds no pass-through domain service, no new artifact writer, no duplicated command registry, and no independent bearer policy. The two transport adapters are intentional protocol boundaries. Existing contract re-exports preserve an explicit compatibility requirement and contain no implementation. Package exports and boundary checks prevent importing internals. A changed domain operation should fail exhaustive adapter typing or response validation tests rather than silently diverge.

## Synthesis decision

This candidate is the shared-core base proposal. The orchestrator must compare it with the independently produced MCP-consuming-REST candidate. No cross-candidate selection or review is claimed here.

## Tradeoffs accepted

- We accept three new reusable package manifests in exchange for an independently installable REST server and a client whose dependency graph excludes the database and archive builder.
- We accept two protocol adapters in exchange for preserving MCP availability and deployment behavior without making every tool call perform an internal HTTP round trip.
- We accept the existing `/mcp` resource identifier for REST in exchange for preserving issued grants, provider resource registration, and introspection links. A transport URL and an OAuth resource identifier have distinct jobs.
- We accept a small local SQLite credential table in exchange for cross-process refresh serialization, atomic logout, and automatic crash lock release without another library. Node currently labels this built-in experimental.
- We accept local logout plus confirmed refresh revocation in exchange for using the existing public-native OAuth contract. Immediate global revocation remains the existing browser-authenticated central-session operation.
- We accept a separate current-state read after a receipt in exchange for retaining immutable receipts that remain truthful after later edits.

## Alternatives considered

MCP consuming REST would keep CLI and MCP artifact operations behind one HTTP contract. REST would own bearer admission and call the store, while MCP would forward the caller's unchanged bearer token using the HTTP client. If MCP still admitted `whoami` locally, both policies would need fresh introspection. If all admission moved into REST, MCP would need to translate HTTP authentication failures into its existing challenges and tool behavior. The HTTP client would hide transport machinery, but MCP's adapter would still expose error and projection policy to its maintainer. This shape adds a network availability dependency and a new trust boundary to each tool call. It does not remove the store or panel's direct adapter. It loses here because a common store and one shared bearer implementation already centralize the actual invariants without that extra hop.

Colocating both handlers while making MCP invoke REST through an in-process Fetch call avoids the network hop but retains HTTP encoding, body parsing, authorization reentry, and response validation inside one process. Passing an already verified actor through a private service header would create a second privileged admission protocol. Bypassing HTTP through another operation facade becomes the shared-core design with an extra pass-through module. Neither hides enough new policy to justify its additional path.

A separate REST resource would give audience isolation between protocols. It requires a second provider resource, native requests for that resource, confidential introspection links for it, configuration and deployment updates, and tests for both resource grants. A client authorized only for MCP would deliberately lose REST admission. This is useful if protocol-specific authority becomes a requirement. The current task asks for equivalent artifact operations, so the extra identity lifecycle is unearned complexity.

Putting all new exports in the existing artifacts package has the fewest manifests. It loses independently installable client isolation because installation follows package dependencies even if a particular export never imports the store. Duplicating domain schemas inside a new client to avoid extraction would create hand-synchronized validators. Extracting one shared contracts package is the smaller reliable boundary.

## Open questions and risks

- Does the supported CLI distribution accept Node's experimental `node:sqlite` built-in, or must private credential storage use a stable OS-lock library? The proposed default is Node's built-in, and this does not change the HTTP or artifact API.
- Is protocol-specific audience isolation a product requirement beyond equivalent access to the same retained artifacts? The proposed default is the existing canonical resource and existing scope authority.
- Should command content retention have an explicit user-operated prune command? The default retains private command and result files for deterministic retry and does not delete them automatically.
- Can all direct HTTP clients use native PKCE with loopback callbacks or their own registered OAuth clients? The API needs no custom API-key path, and this candidate does not add one.

## Concrete verification plan

These are required implementation gates, not completed evidence. The shared [acceptance coverage](coverage.md) is authoritative for the complete obligation matrix.

1. Extract contracts without behavior changes. Run existing unit tests and `pnpm check`. Keep the current receipt fingerprint assertions, `ArtifactError` identity, Node panel build, and Worker bundle checks. Build and pack the server, contracts, client, CLI, and required existing server dependencies into local tarballs. Install them in a temporary consumer outside the workspace. Import the client in plain Node, host the Fetch server, execute the installed `artifacts` bin without `tsx`, and assert a real store conflict maps to HTTP 409. Inspect the packed client tarball and its dependency tree. Neither can contain or depend on `@artifacts/db`, Drizzle, `fflate`, MCP, or CLI credential storage. Give the CLI subprocess only documented public OAuth and API configuration.
2. Add shared bearer policy and the Fetch REST adapter. Serve the real handler over TCP with the existing migrated-database/auth fixture. Use direct `fetch` and literal expected results for create, paginated list, full and compact reads, complete update, paginated full and summary history, CAS publication, and exact ZIP bytes. Exercise malformed inputs, invalid host/origin, incorrect methods, body caps, challenge metadata, wrong owner, absent scope, wrong audience, inactive session, and introspection outage.
3. Prove immutable cross-transport commands. Commit a command through REST, change current head or publication through MCP, then replay the original REST command and compare its literal original receipt. Drop the committed response at a TCP proxy and retry the exact retained command. Assert one revision and one receipt. Replay omitted versus explicit `response: full` and assert the established fingerprint distinction. Revoke the session or remove required scope before replay and assert denial before result disclosure.
4. Race real TCP clients with separate database connections. Two updates from the same head must produce one success and one 409, with exactly one next revision. Two publication changes from one version must produce one winner. A same-revision publication with a stale expected version must fail. Concurrent identical IDs converge on the same receipt. Changed arguments under one ID fail without new rows.
5. Add the client and compiled CLI bin. Spawn actual CLI subprocesses with isolated state directories. A browser automation driver completes `login` against the real provider using the printed authorization URL and loopback callback. Verify state mismatch, callback reuse, timeout, and cancellation. Exercise every operation through the bin and parse stdout. Compare persisted domain bytes and ZIP members with independent MCP reads and exports.
6. Force expiry and launch two CLI subprocesses against the same credential profile. Hold the provider token response and prove only one refresh is in flight, the second rereads the saved token, and both commands complete. Crash the refresh owner and prove another process can obtain the local transaction. Race logout with refresh and delayed login callbacks. No stale callback may restore a signed-out epoch. Confirm refresh revocation, local deletion on remote failure, and truthful residual JWT behavior.
7. Build the actual Astro panel and run it against the same fixture after REST and CLI authoring. Use the browser to find the artifact, inspect the exact retained revision, preview, publish, and download the export. Compare full metadata, custom JSON, content, attachment bytes, publication, and archive digest across REST, CLI, MCP, and panel. Run the repository's retained verification skill against the actual app. Keep Node dashboard builds and Worker builds sequential because their output currently shares paths.
8. Run the existing 59-test baseline, type checks, Node build, Worker build, and browser regression proof. Add REST metadata and operation smoke checks to local Worker verification. Do not deploy production. Review the package graph, independent Fetch hosting example, CLI documentation, and repository-owned `artifacts-cli` skill against the actual built commands before declaring the feature complete.

## Next implementation step

Move the existing pure contracts and workflow into the dependency-light package with compatibility re-exports, then prove all existing fingerprint and dashboard error-identity tests before introducing HTTP behavior.
