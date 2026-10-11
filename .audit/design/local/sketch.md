# App-local identity boundaries

## Phase checklist
- Ground completed. Greenfield repository; architecture and vendor constraints come from the supplied brief.
- Sketch completed. Endpoint-led ownership, caller examples, signatures, state, and verification below.
- Agree delegated to parent synthesis. No human approval gate requested.
- Implement excluded from this design-runner assignment.
- Scrap reserved for implementation evidence that invalidates these boundaries.

## Usage first

The CLI authenticates with the authorization app using PKCE, then calls the MCP `whoami` tool. The dashboard uses its own confidential OIDC client and an opaque browser cookie. All three applications run independently. README startup will expose `pnpm install`, `pnpm db:migrate`, `pnpm identity:bootstrap`, and `pnpm dev` with a checked-in local configuration example.

```ts
// apps/mcp/src/http.ts. Every protected HTTP request enters this boundary.
const decision = await authorizeMcp(readBearer(request), ["artifacts:read"]);
return respondToMcp(decision, principal =>
  dispatchMcpRequest(request, { principal }));
// whoami receives a verified per-request principal; it never reads a transport session identity.

// apps/dashboard/src/middleware.ts. Cookie decoding is HTTP shell work.
const decision = await loadPanelIdentity(readPanelCookie(context));
return respondToPanel(decision, principal => {
  context.locals.principal = principal;
  return next();
});

// apps/auth/src/routes/revoke-all.ts. Better Auth authenticates the current session.
const actor = await requireCurrentAuthSession(request);
await requireSameOriginPost(request);
await revokeUserIdentity(actor.userId);
return clearAuthCookieAndRedirect("/login");
```

## Core shapes and signatures

```ts
// Each app owns its domain types. No shared authentication-policy package.
// These pseudotypes show the agreed protocol meaning; they are not duplicate wire DTOs.
type UserId = string & { readonly userId: unique symbol };
type SessionId = string & { readonly sessionId: unique symbol };
type ClientId = string & { readonly clientId: unique symbol };
type Scope = string & { readonly scope: unique symbol };
type ArtifactScope = "artifacts:read" | "artifacts:write" | "artifacts:publish";
type Principal = Readonly<{
  userId: UserId; sessionId: SessionId; clientId: ClientId;
  scopes: ReadonlySet<Scope>;
}>;
type AccessDecision =
  | { kind: "authorized"; principal: Principal }
  | { kind: "unauthenticated" }
  | { kind: "insufficient-scope"; required: readonly ArtifactScope[] }
  | { kind: "unavailable" };

// apps/mcp/src/identity.ts. Only this module constructs an MCP Principal.
async function authorizeMcp(
  token: string | undefined, required: readonly ArtifactScope[]
): Promise<AccessDecision> { throw new Error("not implemented"); }
// Owns issuer, audience, signature, expiry, required sid, introspection, and granted scope checks.
// Pure private parsing and decision functions live beside this asynchronous boundary.

// apps/dashboard/src/identity.ts. Only this module constructs a dashboard Principal.
async function loadPanelIdentity(
  opaqueCookie: string | undefined
): Promise<AccessDecision> { throw new Error("not implemented"); }
async function startLogin(returnPath: string): Promise<LoginRedirect> {
  throw new Error("not implemented");
}
async function completeLogin(callbackUrl: URL, transactionCookie: string): Promise<NewPanelSession> {
  throw new Error("not implemented");
}
async function logoutPanel(opaqueCookie: string | undefined): Promise<void> {
  throw new Error("not implemented");
}
// LoginRedirect/NewPanelSession contain only redirect URL and opaque cookie instructions.
// HTTP handlers translate those domain results into framework responses.

// apps/auth/src/revocation.ts. Server-only and authenticated by its route caller.
async function revokeUserIdentity(userId: UserId): Promise<void> {
  throw new Error("not implemented");
}
// Central-session deletion commits before best-effort provider grant cleanup.
```

## Module map and ownership

| Module | Owns |
| --- | --- |
| `packages/db/src/schema.ts`, `migrations/` | Generated Better Auth tables plus durable panel and OIDC transaction tables; one migration owner. |
| `packages/db/src/client.ts` | LibSQL connection and Drizzle schema exports only; no authorization decisions. |
| `apps/auth/src/auth.ts` | Better Auth composition, JWT/MCP/CIMD plugins, canonical subject and sid issuance, scope registration, session/token durations, client registration policy. |
| `apps/auth/src/introspection.ts` | Authenticated provider introspection and live central-session gating; provider owns OAuth protocol handling. |
| `apps/auth/src/revocation.ts`, `routes/` | Global revocation command and thin HTTP/CSRF adaptation. |
| `apps/auth/src/bootstrap.ts` | Repeatable owner/client bootstrap through supported provider APIs and persistence; no public signup. |
| `apps/mcp/src/identity.ts`, `http.ts`, `tools.ts` | Bearer validation, HTTP status/challenges, protected dispatch, and `whoami`; MCP alone holds resource introspection credentials. |
| `apps/dashboard/src/identity.ts`, `middleware.ts`, `pages/` | openid-client flow, durable panel state, live-session join, cookies, login, panel logout, global-revoke navigation. |
| `tests/identity/` | Cross-application protocol proofs and isolated real CLI verification. |

## State and request paths

`panel_session` stores `tokenHash` PK, `authSessionId` FK with `ON DELETE CASCADE`, `issuer`, `subject`, `clientId`, granted scopes, and `expiresAt`. Index `authSessionId`. The auth session supplies the canonical user ID. The issuer/subject pair must equal the configured issuer and linked canonical user ID; email never links identities. Cookie material never enters storage in plaintext.

`oidc_transaction` stores the hashed opaque transaction-cookie identifier, unique state, nonce, PKCE verifier, safe relative return path, and expiry. Claim it once atomically before exchanging a code. Failed exchanges restart login. OIDC state survives process restarts. Consume-or-delete is idempotent; code reuse fails.

The dashboard inserts/deletes panel sessions. Auth owns central session creation/deletion. Central deletion cascades panel deletion in the same database transaction, including racing callback inserts. Enable and verify FK enforcement on every connection. Panel reads join the central session each request and require both expirations to be future; absent/expired sessions reject access. No positive cache exists. Dashboard can remain available when the auth HTTP process is down if the shared database is reachable.

MCP validates JWT locally, then performs authenticated RFC 7662 introspection on every protected request. Introspection succeeds only when the provider accepts the token and the token's sid identifies an unexpired central session for the same canonical user. Reconcile subject, sid, audience/resource, client, and granted scopes across trusted token/introspection data. Missing sid or inactive state rejects access. Malformed/unreachable introspection fails closed as unavailable. JWKS caching is allowed; active-result caching is not.

HTTP adaptation maps unauthenticated to 401 plus Bearer protected-resource metadata challenge, insufficient scope to 403 with the required scope, and central unavailability to 503. The MCP guard wraps all protected methods and existing transport sessions. It authorizes the actual operation; future tools declare their own required scopes. The first `whoami` operation requires `artifacts:read`.

Auth uses 5-minute access tokens, 7-day rolling refresh tokens with 30-second grace, and 30-day absolute sessions with `disableSessionRefresh` and positive cookie caching disabled. Introspection sid liveness limits the known concurrent refresh-family invalidation race; a Drizzle transaction option does not repair the upstream race.

OIDC enables end-session support when needed to obtain an ID-token sid. openid-client verifies issuer, audience, state, nonce, PKCE exchange, and ID-token signature. Callback completion requires a live matching central session before creating a panel session with expiry bounded by that central session. Panel-only logout deletes the panel row and cookie. Global logout enters the auth app and submits its authenticated, same-origin revocation form.

CIMD uses the Node secure metadata transport. DCR fallback treats omitted application_type with HTTP loopback redirects as native only under the validated fallback rule; it matches hostname/path exactly and permits only the loopback port to vary. Configuration independently names auth, MCP, and dashboard URLs. Local auth/dashboard use distinct localhost/127.0.0.1 cookie hosts. Non-loopback URLs require HTTPS. Browser cookies are host-only, HttpOnly, SameSite=Lax, and Secure under HTTPS.

## Verification plan

1. Install pinned compatible dependencies, migrate local file libSQL, run owner/client bootstrap twice, and start all apps from README commands. No external identity account is required.
2. Complete browser login, restart the dashboard, inspect live `whoami`, perform panel-only logout, log in again, and globally revoke. Existing browser and CLI sessions must fail immediately.
3. Exercise actual HTTP routes for valid tokens, wrong audience, wrong/missing scope, invalid signature, missing sid, expired/deleted sid, inactive introspection, auth outage, and a previously authenticated MCP transport session.
4. Exercise callback/state replay, authorization-code replay, refresh within/outside grace, concurrent refresh-family invalidation, and refresh after global revocation. Track the upstream race explicitly.
5. Race callback insertion against central deletion and verify durable session cascading with real libSQL. Verify central expiry without deletion and database unavailability at panel middleware.
6. Use installed Claude Code and Codex CLIs with unique test server names and isolation flags. Prove OAuth login and `whoami` where credentials permit, report credential-gated invocation honestly, and preserve personal config and HOME/CODEX_HOME.
