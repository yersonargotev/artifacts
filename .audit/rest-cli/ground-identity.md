# Identity grounding for REST and CLI

This is a read-only investigation at `95a1fc6`. It identifies the existing contracts and extension points. No application files, credentials, database rows, client registrations, or deployments changed. The only output is this report. Existing proof reports are historical evidence, not tests run during this exploration.

throughput checkpoint: n/a, read-only investigation

## Components found

| Component | Location | Responsibility |
| --- | --- | --- |
| `createAuth` | `apps/auth/src/auth-core.ts:12` | Composes Better Auth 1.7.7, JWT, MCP OAuth provider, and CIMD against the canonical database. |
| `createAuthHandler` | `apps/auth/src/http-core.ts:7` | Enforces the configured host, serves account pages, handles same-origin global revocation, and narrowly repairs omitted native DCR application type. |
| Node metadata transport | `apps/auth/src/auth.ts:1` | Uses the provider's DNS-pinned CIMD implementation. |
| Worker metadata transport | `apps/auth/src/metadata-worker.ts:3` | Allows only the exact Codex and Claude metadata URLs and refuses redirects. |
| Bootstrap | `apps/auth/src/bootstrap.ts:23` | Preserves the owner and configured confidential panel and resource-introspection clients. |
| `revokeUserIdentity` | `apps/auth/src/revocation.ts:5` | Deletes every central session for a user, then attempts grant cleanup. |
| `createMcpAuthorizer` | `apps/mcp/src/identity.ts:18` | Verifies bearer JWTs, obtains fresh authenticated introspection, reconciles identity, and constructs a private branded `Principal`. |
| `AccessDecision` | `apps/mcp/src/identity.ts:7` | Distinguishes authorized, unauthenticated, insufficient-scope, and unavailable outcomes. |
| `createMcpApp` | `apps/mcp/src/http.ts:8` | Owns MCP discovery, HTTP admission, MCP protocol dispatch, and tool-result translation. |
| `Actor` | `packages/artifacts/src/contracts.ts:55` | Carries the authenticated canonical user ID, central session ID, OAuth client ID, and granted scopes into the store. |
| `createArtifactStore` | `packages/artifacts/src/index.ts:23` | Owns live-session and scope checks, owner filtering, immutable revisions, receipts, and concurrency. |
| `createPanelIdentity` | `apps/dashboard/src/identity.ts:21` | Validates confidential OIDC login and maintains opaque panel sessions tied to central sessions. |
| Panel middleware | `apps/dashboard/src/middleware.ts:7` | Loads the live panel identity on each request and requires exact same-origin mutations. |
| `panelActor` | `apps/dashboard/src/publication.ts:16` | Converts an authenticated panel identity into the existing application-owned artifact permissions. |
| Config | `packages/config/src/index.ts:1` | Defines shared scope names, service URL validation, app config, and typed Worker bindings. |
| Persistence | `packages/db/src/schema.ts:6` | Owns panel session foreign keys, OIDC transactions, and artifact tables. |
| Database connection | `packages/db/src/index.ts:5` | Verifies foreign-key enforcement before exposing the database. |

## Flow

### Existing public OAuth client to MCP

1. The client discovers the authorization issuer through protected-resource metadata. `createMcpApp` exposes both the path-specific metadata route and the root route. The resource is the complete configured `MCP_URL`, including `/mcp`. Evidence is `apps/mcp/src/http.ts:10`.
2. A public native client registers at `${issuer}/oauth2/register` with `token_endpoint_auth_method: none`, `authorization_code` and `refresh_token` grants, and an HTTP loopback callback. `tests/helpers.ts:55` is an executable HTTP example. Production DCR remains enabled in `apps/auth/src/auth-core.ts:31`.
3. The client opens authorization with PKCE S256, a fresh state, requested scopes, and `resource`. The real account browser pages perform password login and consent. Passwords remain at the auth app. Evidence is `apps/auth/src/pages.ts:22` and `tests/helpers.ts:66`.
4. The client exchanges the callback code with its PKCE verifier and the same resource. The provider issues the access token from the canonical user and central session. `tests/helpers.ts:76` contains the exchange.
5. MCP requires `artifacts:read` before dispatch. It verifies the JWT signature, issuer, audience, expiry, required claims, nonempty `sid`, `client_id === azp`, and absence of unsupported `cnf`. Evidence is `apps/mcp/src/identity.ts:12` and `apps/mcp/src/http.ts:19`.
6. On every protected HTTP request, MCP POSTs the token to authenticated introspection with its own confidential Basic client credentials. It refuses redirects and requires status 200. It checks that introspection agrees on subject, session, client, issuer, audience, expiry, and scopes. No positive introspection cache exists. Evidence is `apps/mcp/src/identity.ts:35`.
7. A verified `Principal` reaches tools through the request closure. MCP protocol sessions do not establish identity. The tool passes the principal to the common artifact store. Evidence is `apps/mcp/src/http.ts:26`.
8. The store checks the required operation scope and a live database session that belongs to the actor's user. Mutations perform this check before reading or replaying a receipt. Owner-filtered reads return `not_found` for another owner's artifact. Evidence is `packages/artifacts/src/index.ts:29`, `:40`, and `:64`.

The pinned MCP plugin automatically adds its configured resource to provider resources and default client-registration links. This was checked directly in installed `@better-auth/mcp/dist/index.mjs:169`. It explains why the integration fixture can create its introspection client without a separate explicit link call. Production bootstrap still explicitly ensures that link, which also repairs older clients. Evidence is `apps/auth/src/bootstrap.ts:19`.

### Panel OIDC and revocation

1. `startLogin` records a ten-minute transaction containing a hashed opaque cookie token, state, nonce, verifier, and local return path. It builds confidential OIDC authorization using `openid profile`. Evidence is `apps/dashboard/src/identity.ts:29`.
2. `completeLogin` atomically deletes the transaction before the code exchange. `openid-client` validates code exchange, PKCE, state, nonce, issuer, audience, and signature. The application then requires a nonempty `sid`. Evidence is `apps/dashboard/src/identity.ts:40`.
3. A database transaction requires that the central session is live and belongs to the verified subject. It inserts a panel session with the same central expiration. The browser receives only an opaque token, whose SHA-256 hash is stored. Evidence is `apps/dashboard/src/identity.ts:51`.
4. Each panel request joins panel session, central session, and user. It checks issuer, subject, client, and both expirations. Deleting a central session cascades panel-session deletion. Evidence is `apps/dashboard/src/identity.ts:59` and `packages/db/src/schema.ts:6`.
5. Panel logout deletes only the panel session. Global revocation authenticates a central browser session and deletes all central sessions belonging to its user. It attempts OAuth access-token, refresh-token, and consent cleanup afterward. Evidence is `apps/dashboard/src/identity.ts:65`, `apps/auth/src/http-core.ts:12`, and `apps/auth/src/revocation.ts:5`.

### Correct standalone CLI authentication

The existing provider supports a standalone public native client. The CLI can use DCR without adding a vendor CIMD URL or distributing a client secret. This follows the existing native DCR HTTP flow in `tests/helpers.ts:55` and the explicit provider configuration in `apps/auth/src/auth-core.ts:25`.

Recommended flow, inferred from those working seams:

1. Discover the issuer from the configured resource metadata or explicitly configured trusted issuer. Validate network configuration at the CLI boundary.
2. Bind an ephemeral HTTP listener to an exact loopback host before opening the browser. Register `application_type: native`, `token_endpoint_auth_method: none`, `authorization_code` and `refresh_token` grants, and an exact callback path. Persist registration per issuer and resource so every login does not create another client.
3. Generate fresh state and PKCE S256. Request `openid profile offline_access artifacts:read artifacts:write artifacts:publish` for the full workflow. The full set matches `README.md:24`. Request and redeem against the configured canonical resource.
4. Open the authorization URL in the real browser. Validate the callback's state and exact expected path. Exchange the code with the original verifier. Keep owner password, database credentials, panel client credentials, resource introspection credentials, and publication secrets outside the CLI.
5. Save client registration and tokens privately per deployment. Refresh with the same resource. Update rotated credentials atomically and serialize refresh across overlapping CLI commands. The serialization recommendation follows the existing refresh replay behavior, not a claim that a credential store already exists.
6. Send bearer authorization directly to REST and verify identity through the real authenticated identity endpoint. The CLI must never treat a decoded JWT as authorization.
7. Make local logout and account-wide revocation distinct. Erasing local tokens alone does not revoke already-issued bearer tokens. The provider returns `unsupported_token_type` for live JWT access-token revocation. Global account revocation remains central-session deletion.

An established OAuth library is already available. `apps/dashboard/package.json:23` pins `openid-client` 6.8.8. Its installed declarations expose `None`, `discovery`, `buildAuthorizationUrl`, `authorizationCodeGrant`, `refreshTokenGrant`, state, and PKCE helpers. This is a concrete reuse candidate for a Node CLI package. Dynamic registration, browser launch, callback listener, private credential persistence, and concurrent refresh still need CLI ownership.

## Boundaries and design consequences

| Boundary | Existing input and output | Consequence for REST and CLI |
| --- | --- | --- |
| Auth provider | Browser account session and OAuth protocol requests produce tokens | Keep OAuth issuance in Better Auth. Do not add password login to the CLI. |
| Bearer admission | `Request` plus required scopes produce `AccessDecision` | Share this exact credential validation between REST and MCP when both consume the same audience. Keep panel OIDC separate. |
| Artifact store | Verified `Actor` plus command schema produce domain result or `ArtifactError` | A REST adapter can call the same store directly. Forward authenticated user/session/client identity. Never accept actor fields from request JSON. |
| Panel session | Opaque cookie produces `PanelIdentity` through OIDC and database joins | REST should not borrow cookies or depend on panel login. Preserve existing middleware and callback protections. |
| Resource configuration | `MCP_URL` is the canonical audience and registration default | Decide deliberately whether REST is another protocol for this resource or a new OAuth resource. A new URL alone does not register a new audience. |
| Publication | Separate Worker uses authenticated internal requests and live owner/session checks | A CLI publication command selects a revision. It does not make the viewer public or bypass viewer admission. |
| Deployment | Four declared service configurations determine runtime secret projections | Colocation can reuse the current MCP Worker. A fifth Worker requires build, release, config, deployment, and smoke changes. |

The existing app-local decision rejected a shared identity framework because the only consumers authenticated different credentials. REST introduces a second bearer consumer, which now gives a concrete reason to extract the bearer authorizer and its result type. That extraction does not justify moving OIDC cookie admission into the same abstraction. Evidence is `docs/decisions/identity.md:9` and `.audit/design/local/rationale.md:19`.

If REST shares the configured resource audience and runtime with MCP, the existing introspection client can validate both protocols without distributing any new secret to the CLI. If REST uses a distinct resource, the auth provider must register it, client registrations and grants must permit it, the introspection client must link to it, and REST must validate that distinct audience. The current plugin explicitly adds only the MCP resource. This is an architectural fork, not an implemented configuration option.

The brand on `Principal` is internal to `apps/mcp/src/identity.ts`. `Actor` is deliberately structural for both panel and MCP. A shared bearer authorizer can return the same verified identity shape. Constructing an `Actor` from user-supplied IDs would bypass the network trust boundary even though the store separately checks session existence.

## Deployment and configuration evidence

- `packages/config/src/index.ts:18` requires HTTPS except exact HTTP loopback hosts. Auth, dashboard, and publication must be origins. `MCP_URL` may retain a path.
- `packages/config/src/index.ts:46` rejects auth and panel sharing a cookie hostname. `publicationConfig` also requires a distinct host. Keep these constraints when introducing API configuration.
- `scripts/cloudflare.ts:6` names the four production URLs. `apps/mcp/cloudflare.config.ts:9` gives only the resource service its introspection secret and database credentials. `apps/auth/cloudflare.config.ts:9` gives auth its Better Auth secret and database credentials.
- `scripts/build-workers.ts:11`, `scripts/deploy-worker.ts:7`, and `scripts/release-production.ts:15` enumerate exactly `auth`, `mcp`, `panel`, and `view`. A separate REST Worker affects all three registries.
- `scripts/build-workers.ts:53` bundles under `workerd` and `browser` conditions and rejects Node-only DNS, HTTPS, and native libSQL paths. Do not let a shared server package import CLI callback listeners or private credential persistence into a Worker.
- `scripts/release-production.ts:31` derives and validates the exact runtime secret union from service declarations. Unknown runtime secrets fail. Adding an API secret cannot be done solely in a local environment file.
- `scripts/release-production.ts:152` provides real read-only production smoke. New REST discovery and anonymous denial should join the same proof if REST enters production.
- `scripts/dev.ts:3` starts exactly the four current services. No database migration or new production deployment is inherently needed for a reusable Fetch handler or colocated routes.

## Current OAuth client roles

| Role | Registration and use | Constraint |
| --- | --- | --- |
| Panel | Bootstrap creates confidential `client_secret_basic`, `openid profile`, authorization code, PKCE, skip consent, and end-session support. | Local HTTP callback uses native application type. Production HTTPS uses web. Preserve this client and its opaque-cookie flow. |
| Resource introspection | Bootstrap creates confidential `client_secret_basic` and ensures the `MCP_URL` resource link. | Resource servers own this secret. A public CLI must not receive it. |
| Codex | Exact `https://chatgpt.com/oauth/codex/client.json` CIMD metadata. | Production Worker only approves this exact URL. |
| Claude Code | Exact `https://claude.ai/oauth/claude-code-client-metadata` CIMD metadata. | Production Worker only approves this exact URL. |
| Older or independent public native clients | Public DCR with PKCE and loopback redirects. | Explicit native application type avoids dependence on the narrow omitted-type repair. |

This table describes the source-configured client roles and recorded deployed clients. It is not a live inventory of current OAuth database rows or personal token stores. No private environment files or credential stores were opened. `.codex/config.toml` still defines the repository-local MCP as `artifacts` at the local endpoint. `README.md:22` documents the additional hosted `artifacts-cloud` connection.

## Non-obvious things

1. A five-minute JWT is not the revocation boundary. Central-session deletion plus fresh introspection is. Removing introspection or caching success changes the product's immediate revocation promise. The store also requires the live user-session relationship before receipt replay.
2. Better Auth 1.7.7 refresh tokens can survive central deletion through `ON DELETE SET NULL` and can then mint a JWT with `sid: null`. There is also a documented concurrent refresh-family invalidation race. The resource must require a nonempty `sid` even after a successful provider introspection. Evidence is `docs/decisions/identity.md:23` and `tests/oauth.test.ts:106`.
3. Introspection must authenticate as the registered method. The application deliberately uses `client_secret_basic`. The provider's generic MCP helper uses `client_secret_post`, according to the existing source audit, so replacing the custom authorizer with that helper is not behavior preserving without reviewing its registration and claim rules. Evidence is `.audit/design/provider-audit.md:61`.
4. The introspection resource link stores the resource identifier URL, not the resource row ID. Evidence is `packages/db/src/auth-schema.ts:176`.
5. Native HTTP callbacks permit variable ports only. Hostname, path, query, and other characters still match. `localhost` and `127.0.0.1` are distinct. Installed `@better-auth/oauth-provider/dist/authorize-K1WHCNih.mjs:5386` confirms this.
6. The omitted DCR application-type repair applies only to explicit public `none` clients whose redirects all use exact loopback HTTP hosts. A CLI should send `application_type: native` itself. Evidence is `apps/auth/src/http-core.ts:26`.
7. The existing MCP transport requires `artifacts:read` even for write or publish tool calls. A REST adapter must decide its admission scope deliberately and preserve the current MCP behavior. Scope-specific store checks remain required.
8. Panel OIDC grants contain `openid profile`; `panelActor` assigns application permissions after panel admission. It would be incorrect to infer the bearer policy from panel grants. Evidence is `apps/dashboard/src/publication.ts:16`.
9. Preserve the native mutation form Origin behavior. The account and panel intentionally use `Referrer-Policy: same-origin`. The original decision records that `no-referrer` produced `Origin: null` for browser native forms. Evidence is `docs/decisions/identity.md:19`.
10. Client logout cannot promise immediate central revocation by revoking the JWT alone. Installed `@better-auth/oauth-provider/dist/authorize-K1WHCNih.mjs:3419` explicitly rejects that operation for a live JWT. Refresh revocation and deleting local tokens have narrower effects than global account revocation.
11. Existing command fingerprints preserve optional fields. A transport must not insert default `response: full` before forwarding a mutation because an omitted and explicit field can produce different receipt hashes. The shared task frame records this store constraint. Identity authorization must occur before receipt replay.

## Tests and real verification entry points

| Entry point | Existing proof | Needed extension |
| --- | --- | --- |
| `tests/helpers.ts` | Disposable migrated database, real auth and MCP HTTP servers, canonical owner, public DCR and PKCE token grant. | Compose the REST handler with the same fixture and obtain CLI tokens through supported public OAuth. |
| `tests/oauth.test.ts` | Signature, claims, scope, unauthenticated introspection, inconsistent introspection, redirects, outages, refresh rotation, replay, central revocation, and surviving refresh rejection. | Exercise equivalent REST denial and preserve MCP outcomes after extraction. |
| `tests/panel.test.ts` | Durable one-use transactions, state tampering, expiry, logout isolation, callback-versus-revocation race, signed subject mismatch. | Existing suite is the regression gate for preserving panel behavior. |
| `tests/database.test.ts` | Repeatable migrations, panel cascade, rejection of dangling panel sessions. | No new identity tables are required by the native public CLI design. |
| `tests/bootstrap.test.ts` | Independent origins, resource links, owner and secret preservation, selected private file. | Keep bootstrap unchanged unless introducing a separately managed API resource or CLI client. |
| `tests/worker-metadata.test.ts` | Exact Worker CIMD allowlist, redirect rejection, and conditional 304 handling. | Standalone CLI DCR should not require widening the vendor policy. |
| `tests/browser.proof.ts` | Actual Chrome, native panel logout and SSO, canonical user ID, global revocation and MCP denial, native Origin headers. | Verify CLI-created artifacts in the same real panel and retain this regression proof. |
| `.agents/skills/verify-artifacts/scripts/control.ts` | Isolated actual app instances and fixed identity, authoring, preview, publication, and export drives. | Real CLI integration needs a subprocess proof in addition to fixture OAuth setup. |
| `scripts/verify-artifact-clients.ts` | Actual Claude and Codex subprocesses using registered HTTP MCP. Scrubs application secrets from child environment and validates tool results. | Useful subprocess-isolation pattern for the standalone CLI. It currently assumes OAuth registration is already complete. |
| `scripts/verify-deployed-artifact.ts` | Actual panel and viewer login, canonical owner, historical bytes, anonymous denial, and separate-session revocation. | Deployed proof is a later authorized gate, not required to explore or build locally. |
| `scripts/verify-turso.ts` | Disposable remote database migration, transaction, cross-client visibility, central revocation, and cascade proof. | Use only a disposable target, never the normal account. |
| `scripts/release-production.ts` and `tests/release.test.ts` | Exact secret projection, bundle integrity, release ordering, read-only HTTP smoke, and database-backed absent-session denial. | A separate API Worker requires explicit integration here. |

The verification skill's identity recipe expressly limits global revocation to the disposable run. It also states that fixture OAuth setup does not prove live CLI interactive consent. Evidence is `.agents/skills/verify-artifacts/features/identity.md:23` and `.agents/skills/verify-artifacts/SKILL.md:39`.

## Relevant history and rationale

- `7d4c718` introduced the central identity, public PKCE MCP flow, and durable confidential OIDC panel in one increment.
- `0cb84b5` recorded the app-local decision, independent comparison, and provider audit. The stated reason was fewer interfaces for consumers using different credential types.
- `d54a5f4` replaced the remote-database unknown with real Turso transaction and revocation evidence. It did not claim deployed OAuth acceptance at that point.
- `670380f` split auth core from Node-specific metadata transport and introduced the Worker-specific closed vendor policy.
- `60b57a5` changed introspection redirect handling from `redirect: error` to `manual` plus an exact 200 requirement after Worker verification.
- `d3547fb` recorded the canonical identity migration and real deployed Codex and Claude CIMD acceptance. `.audit/artifact-e2e/runtime.md:5` records those observed flows. Its Worker version table is historical, not the current deployment version.

The scope-update paragraph in `docs/decisions/identity.md:3` supersedes the older pending-deployment wording at its end. The code and later evidence must be read together.

Boundary Discipline shaped the recommendation to share only the identical bearer validation contract and retain separate panel admission. Prove It Works shaped the separation between source contracts, recorded historical runtime evidence, and future CLI or REST proofs. Both leaf skills were read during this investigation.

## Open questions

- The architectural comparison must choose colocated REST routes or a new Worker and must state the audience contract. Current code supports one configured MCP resource.
- The CLI's configuration directory, credential store, browser-open behavior, callback timeout, and cross-process refresh lock do not exist yet. No implementation was assumed.
- An independently configured REST deployment needs a trustworthy discovery and issuer configuration story. Redirect and endpoint trust policy belongs at that boundary.
- Native public DCR and PKCE already have integration coverage. A new CLI's actual browser listener, state rejection, cancellation, refresh persistence, and subprocess behavior remain unverified until implemented.
- No live OAuth database inventory, current personal token validity, or current deployed version was inspected. Existing source and historical acceptance are sufficient to select extension points, not to claim new deployed behavior.

## Files read

Application and package files were read in full or in relevant sections:

- `apps/auth/src/auth-core.ts`, `auth.ts`, `bootstrap.ts`, `http-core.ts`, `http.ts`, `worker.ts`, `server.ts`, `revocation.ts`, `metadata-worker.ts`, and `pages.ts`.
- `apps/auth/package.json` and `apps/auth/cloudflare.config.ts`.
- `apps/mcp/src/identity.ts`, `http.ts`, `server.ts`, and `worker.ts`.
- `apps/mcp/package.json` and `apps/mcp/cloudflare.config.ts`.
- `apps/dashboard/src/identity.ts`, `runtime.ts`, `middleware.ts`, `publication.ts`, `review.ts`, `publish.ts`, and the login, callback, and logout routes.
- `apps/dashboard/package.json` and `apps/dashboard/cloudflare.config.ts`.
- `packages/config/src/index.ts`, `packages/db/src/schema.ts`, `auth-schema.ts`, `index.ts`, `packages/artifacts/src/index.ts`, and `contracts.ts`.
- `scripts/configure.ts`, `cloudflare.ts`, `build-workers.ts`, `deploy-worker.ts`, `release-production.ts`, `dev.ts`, `verify-artifact-clients.ts`, and `verify-deployed-artifact.ts`.
- `tests/helpers.ts`, `oauth.test.ts`, `panel.test.ts`, `browser.proof.ts`, and relevant assertions or test declarations in `bootstrap.test.ts`, `configuration.test.ts`, `database.test.ts`, `worker-metadata.test.ts`, and `release.test.ts`.
- `package.json`, relevant `pnpm-lock.yaml` entries, `.codex/config.toml`, `.gitignore`, and `README.md`.

Decision and verification material was read in full or in relevant sections:

- `docs/decisions/identity.md`, `docs/deployment.md`, and matching passages in `docs/decisions/artifacts.md`, `docs/ci-cd.md`, and `docs/workflow/verification.md`.
- `.audit/design/local/sketch.md`, `.audit/design/local/rationale.md`, `.audit/design/judgment.md`, `.audit/design/provider-audit.md`, `.audit/artifact-e2e/runtime.md`, and `.audit/rest-cli/frame.md`.
- `.agents/skills/poteto-mode/SKILL.md`, its investigation playbook, `.agents/skills/how/SKILL.md`, and its explorer prompt.
- `.agents/skills/unslop/SKILL.md`, `technical-writing/SKILL.md`, `principle-boundary-discipline/SKILL.md`, and `principle-prove-it-works/SKILL.md`.
- `.agents/skills/verify-artifacts/SKILL.md` and `features/identity.md`.

Installed dependency sections were inspected directly:

- `@better-auth/mcp` 1.7.7 `dist/index.mjs` for resource and default-registration behavior.
- `@better-auth/oauth-provider` 1.7.7 `dist/authorize-K1WHCNih.mjs` for registration defaults, native redirect validation, resource registration, JWT revocation, and loopback matching.
- `openid-client` 6.8.8 `build/index.d.ts` for supported public-client, discovery, PKCE, code, refresh, and revocation APIs.

Git evidence came from `git log`, `git show --stat`, and focused `git show` diffs for the commits listed above.
