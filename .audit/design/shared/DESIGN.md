# Shared authorization policy candidate

## Problem

The MCP server and Astro panel must admit the same immutable identity while using different transports and durable state. A signed token alone does not prove that its central session remains active. Both applications need fresh authenticated introspection, explicit resource binding, and consistent failure classification. Better Auth owns authorization sessions and grants. This candidate adds a shared functional policy package around that provider, with app-owned protocol adapters.

## Usage (caller's view)

Construct one authorizer per independently configured resource. Every call verifies a credential and obtains fresh introspection. Callers cannot supply cached session evidence or create a principal directly.

```ts
// apps/mcp/src/identity.ts
import { createAuthorizer } from "@artifacts/identity";
const authorize = createAuthorizer(mcpPolicy, mcpVerification);

// apps/mcp/src/http.ts
const admission = await authorize(readBearer(request), {
	kind: "resource", scopes: ["artifacts:read"],
});
if (admission.kind !== "allowed") return oauthFailure(admission);
return whoami(admission.principal);

// apps/dashboard/src/middleware.ts
const authorizePanel = createAuthorizer(panelPolicy, panelVerification);
const saved = await panelSessions.read(readHostOnlyCookie(request));
if (!saved) return redirectToLogin();
const credential = await panelTokens.current(saved); // Refresh when needed.
const admission = await authorizePanel(credential, {
	kind: "panel", boundTo: saved.identity,
});
if (admission.kind !== "allowed") return panelFailure(admission);
locals.principal = admission.principal;

// apps/dashboard/src/pages/logout.ts
await panelSessions.delete(readHostOnlyCookie(request)); // Panel-only logout.
return clearPanelCookie();
```

The OIDC callback uses `openid-client` to validate state, nonce, PKCE, issuer, subject, and the ID token. It persists a panel row only after binding its access token to the panel resource, canonical user ID, and required `sid`. The panel uses its confidential client for standard authenticated introspection. No speculative Better Auth session endpoint is required.

## Shape

`packages/identity` owns admission, scope semantics, identity binding, and failure variants. Its async function coordinates injected effects. Its private pure decision function compares normalized facts, expiry, scopes, and session identity. It exports no framework, OAuth JSON, JWT-library, or Drizzle types, per boundary-discipline.

The public function hides validation order and the live-session gate behind one operation. Apps supply resource configuration and two effect methods. Adapters own crypto algorithms, JWKS retrieval, RFC 7662 authentication, timeout behavior, and parsing. Positive introspection caching is absent from both the contract and implementation. JWKS caching remains permissible.

Opaque IDs separate users, central sessions, and clients. An opaque principal can originate only from the authorizer. Discriminated outcomes distinguish authentication failure, insufficient scope, and provider unavailability, per type-system-discipline and model-the-domain. Scope names have one registry. OAuth configuration and MCP tool declarations derive from it.

| Module | Ownership |
| --- | --- |
| `packages/identity/src/index.ts` | Only exported factory, domain contracts, and scope registry. |
| `packages/identity/src/access.ts` | Fresh effect coordination and private pure admission decision. |
| `packages/db/src/schema.ts` | Provider schema plus panel session and OIDC transaction schema. Single migration owner. |
| `apps/auth/src/auth.ts` | Better Auth composition, native DCR policy, secure CIMD transport, owner bootstrap policy. |
| `apps/auth/src/revoke.ts` | Authenticated global revocation. Deletes central and panel sessions, then attempts grant cleanup. |
| `apps/mcp/src/identity.ts` | JWT and introspection adapters configured for the MCP resource. |
| `apps/mcp/src/http.ts` | MCP transport, OAuth challenges, and principal injection. |
| `apps/dashboard/src/oidc.ts` | OIDC transaction, confidential client, token refresh, and callback binding. |
| `apps/dashboard/src/sessions.ts` | Durable host-only cookie sessions, central-session index, and token persistence. |
| `apps/dashboard/src/middleware.ts` | Fresh admission before each protected request and panel failure behavior. |

Each admission is traceable through the endpoint, app adapter, and shared policy, per minimize-reader-load. Auth owns central session deletion. Dashboard owns panel session creation and refresh updates. Global revocation accesses panel rows through the shared database schema to delete all rows for the user. Repeated deletion converges, per make-operations-idempotent. A callback must observe its central session as active before creating a panel row. Every later panel request checks the same `sid`, including after a concurrent revocation.

## Synthesis decision

Pending the orchestrator's comparison with the app-local candidate. This candidate proposes shared admission policy as the base and keeps provider protocols in their consuming apps.

## Tradeoffs accepted

- We accept injected verifier contracts in exchange for shared admission policy without coupling the package to Node HTTP, Astro, or MCP.
- We accept an authenticated network call on every protected request in exchange for immediate central-session revocation and fail-closed behavior.
- We accept app-owned token refresh concurrency in exchange for keeping durable token state out of the shared policy package. Local coalescing cannot fix the upstream refresh-family race.

## Alternatives considered

App-local endpoint orchestration makes each endpoint easier to read alone, but exposes identity binding, scope policy, and failure semantics to multiple maintainers. A shared SDK that owns OIDC, OAuth HTTP, database rows, and cookies hides more protocol code but requires a larger configuration contract and combines three applications' lifecycles.

## Open questions and risks

- Does the pinned provider's standard introspection check the actual central `sid`, and return enough identity and scope data to normalize the contract without inventing evidence?
- Can `openid-client` obtain a panel-resource access token with the required `sid`, and refresh it without changing the stored canonical identity binding?
- What durable refresh coordination does the first runnable deployment need, and do concurrent refresh failures consistently force renewed login while preserving the live `sid` gate?

## Next implementation step

Build one actual MCP `whoami` path through JWT verification and authenticated introspection, then reuse the admission contract for the OIDC panel.

## Verification plan

Exercise live MCP and panel requests against real local Better Auth and file libSQL. Verify valid login, wrong issuer or audience, missing `sid`, expired JWT, insufficient scope, and malformed introspection. Stop auth and assert unavailability rather than cached success. Delete a central session and prove the next request fails in both apps. Verify panel-only logout, global revocation, OIDC state and code replay rejection, refresh rotation and replay, concurrent refresh behavior, and durable sessions after restart. Test loopback DCR with a variable port and exact host and path matching. Use real isolated Codex and Claude OAuth registrations and `whoami` when installed. Report credential-related invocation limits separately.
