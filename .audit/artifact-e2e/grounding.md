# Existing identity architecture

This report describes the source read on 2026-10-11. It also records the bounded native Worker prototype in `.test-artifacts/worker-probe`.

## Authorization owns identity and OAuth grants

[`apps/auth/src/auth.ts`](../../apps/auth/src/auth.ts) composes Better Auth 1.7.7, its JWT plugin, the MCP OAuth provider, and CIMD. It uses the Drizzle SQLite adapter with transactions and the shared database schema. The authorization issuer is `AUTH_URL + /api/auth`. The MCP resource and dashboard URLs come from validated service configuration.

The account uses email and password. Signup is disabled outside the bootstrap command. Authentication sessions last thirty days, do not refresh automatically, and do not use the cookie cache. The host-only auth cookie uses the `artifacts-auth` prefix. HTTPS enables Secure cookies.

The provider supports authorization code and refresh token grants, S256 PKCE, public clients, DCR, and the MCP 2026-07-28 CIMD profile. Access tokens last five minutes. Refresh tokens last seven days. The refresh reuse interval is thirty seconds. [`docs/decisions/identity.md`](../../docs/decisions/identity.md) records the dependency's refresh-family race and the existing behavioral checks.

[`apps/auth/src/http.ts`](../../apps/auth/src/http.ts) verifies the request host, serves the login and consent pages, and guards global revocation with the exact Origin and an active central session. Its narrow DCR adapter treats an omitted application type as native only for public clients with exact HTTP loopback redirects.

[`apps/auth/src/revocation.ts`](../../apps/auth/src/revocation.ts) deletes central sessions first. It then deletes OAuth access tokens, refresh tokens, and consents in a transaction. Central-session deletion remains effective if grant cleanup fails. [`apps/auth/src/bootstrap.ts`](../../apps/auth/src/bootstrap.ts) provisions the owner and confidential panel and introspection clients. It preserves existing IDs and secrets, and verifies that configured client IDs exist in the selected database.

## MCP verifies each request against live central state

[`apps/mcp/src/http.ts`](../../apps/mcp/src/http.ts) exposes OAuth protected-resource metadata and a stateless HTTP MCP handler. It creates the MCP server only after authorization. The sole current tool, `whoami`, reports the verified user, central session, client, and scopes.

[`apps/mcp/src/identity.ts`](../../apps/mcp/src/identity.ts) first verifies the JWT signature with remote issuer JWKS. It validates issuer, resource audience, expiry, subject, central session, and client claims. It then calls the issuer's introspection endpoint with a confidential client on every protected request. The live response must match the JWT's user, session, client, audience, expiry, and scopes. Missing or invalid credentials return 401. Missing scopes return 403. Network or dependency failures return 503. The MCP service has no database credentials.

## The panel stores opaque sessions in the shared database

[`apps/dashboard/src/identity.ts`](../../apps/dashboard/src/identity.ts) uses `openid-client` discovery, confidential client authentication, state, nonce, PKCE, and ID-token signature checks. A login transaction stores a hash of its random cookie token. Callback consumption deletes that transaction atomically before token exchange, which prevents replay and callback races.

The panel receives an ID token containing the central `sid`. It checks that central session in a database transaction before creating a panel session. The panel cookie contains a random token. Only its hash is stored in `panel_session`. Every authenticated panel request joins that row with the live central session and user.

[`packages/db/src/schema.ts`](../../packages/db/src/schema.ts) gives panel sessions a foreign key to the central session with `ON DELETE CASCADE`. Panel logout deletes only the panel session. Global revocation deletes central sessions and invalidates panel access through the join and cascade. [`apps/dashboard/src/middleware.ts`](../../apps/dashboard/src/middleware.ts) validates host and mutation Origin, clears invalid cookies, sets no-store responses, and fails closed with 503 when runtime or database access fails.

## The database boundary already supports remote libSQL

[`packages/db/src/index.ts`](../../packages/db/src/index.ts) creates a libSQL client, enables foreign keys, verifies that setting, and constructs Drizzle with the shared schema. Its default import selects the Node driver locally. The pinned `@libsql/client` export map selects its web implementation for the `workerd` condition and also exports `@libsql/client/web` explicitly.

[`scripts/verify-turso.ts`](../../scripts/verify-turso.ts) is the existing remote-database proof. It does not establish a deployed authorization flow. The Worker prototype's explicit database statements configure PRAGMA and query a constant `SELECT 1`. However, Better Auth initialization automatically registered the synthetic OAuth resource `https://mcp-probe.example.test/mcp` in the personal Turso database. The parent agent detected that write. The probe stopped all personal-database traffic and now requires an explicitly supplied disposable database. The parent owns cleanup of that synthetic resource. This was a real remote side effect, so the probe was not read-only.

## Native Workers require a different CIMD transport

The installed `@better-auth/cimd/node` transport calls `node:dns/promises.lookup`, rejects any non-public DNS answer, and pins an approved address through `node:https.request` while preserving TLS identity. [Cloudflare's DNS documentation](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/) says `lookup` throws `Not implemented` in Workers. Keeping the Node transport in a native Worker therefore fails when CIMD resolution runs.

The installed CIMD types require a runtime-specific transport and expose `isMetadataDocumentUrlAllowed` as an additional pre-fetch gate. The transport also handles metadata-owned resources such as `jwks_uri`. A gate that checks only the original document does not protect those additional fetches.

The prototype's exact approved set contains the two URLs already present in the local OAuth client table. It contains `https://chatgpt.com/oauth/codex/client.json` and `https://claude.ai/oauth/claude-code-client-metadata`. No callback-specific IDs or opaque client IDs are recorded here. Both the CIMD gate and transport enforce the same set. The transport accepts HTTPS GET and HEAD requests only. It forces `redirect: manual` and rejects every 3xx response except conditional 304. Every other metadata or JWKS location is rejected.

The first workerd run rejected `redirect: error` before it made either approved fetch. Workers requires `manual` plus explicit status checks for this policy. The MCP introspection call in `apps/mcp/src/identity.ts` also uses `redirect: error` and needs the same runtime adaptation. Its existing `response.ok` check already rejects 3xx responses after `manual` prevents following them. The pinned `jose` JWKS fetch and `openid-client` discovery fetch already use `manual`.

[Cloudflare's compatibility-flag documentation](https://developers.cloudflare.com/workers/configuration/compatibility-flags/) states that `global_fetch_strictly_public` routes global fetch through the public Internet front door, including requests to the Worker's own zone. The [workerd network configuration](https://github.com/cloudflare/workerd/blob/main/src/workerd/server/workerd.capnp) restricts its default Internet service to publicly routable addresses and filters DNS results before connection. These are useful network protections, but they do not document the installed CIMD transport's stronger requirement to reject every special-use DNS answer. The closed vendor set is an explicit trust policy, not a claim of equivalent arbitrary-host DNS pinning.

The smallest viable production shape is an auth Worker with the web libSQL driver, the existing Better Auth composition, `nodejs_compat`, `global_fetch_strictly_public`, and this closed transport policy. MCP can preserve its fetch-shaped application with the Node listener omitted. The panel needs the Astro Cloudflare adapter and the web driver. Separate public HTTPS hostnames preserve the current cookie boundaries. This shape is a recommendation inferred from source plus the local prototype, not a deployed end-to-end result.

`cloudflare.config.ts` is the installed cf 1.0.0-beta.14 configuration format. Its fields include `worker.entrypoint`, `worker.compatibilityDate`, `worker.compatibilityFlags`, and `worker.env`. The installed cf generator and `@cloudflare/config` 0.24.1 declarations confirm those fields. [Cloudflare's configuration documentation](https://developers.cloudflare.com/cf/projects/cloudflare-config/) is the primary reference. Secret bindings are declarations; their values must be supplied separately. No container or entitlement change is required by the demonstrated bundle shape.

The prototype and its observations are disposable. Read [the probe report](../../.test-artifacts/worker-probe/report.md) for the actual execution results and remaining checks.
