# Better Auth 1.7.7 provider contract audit

Verdict **ISSUES**. The settled provider supports the identity increment. Two contract limits need explicit handling. Local OIDC loopback redirects require `application_type: "native"`, even for a confidential client. Live access-token introspection does not require `sid`, so resource and panel code must require it.

This is a read-only source audit. It does not review application code or claim runtime integration coverage. No package installation, repository edit, or secret access was performed.

throughput checkpoint: n/a, read-only investigation

## Source locations

All paths refer to the installed published 1.7.7 artifacts in the implementation worktree.

- `BA` is `/tmp/artifacts-identity-implementation/apps/auth/node_modules/better-auth/dist`.
- `MCP` is `/tmp/artifacts-identity-implementation/apps/auth/node_modules/@better-auth/mcp/dist`.
- `CIMD` is `/tmp/artifacts-identity-implementation/apps/auth/node_modules/@better-auth/cimd/dist`.
- `OP` is `/tmp/artifacts-identity-implementation/node_modules/.pnpm/@better-auth+oauth-provider@1.7.7_@better-auth+core@1.7.7_@better-auth+utils@0.4.2_@bet_6a3cb442d4436054ac0f6bdf5c5df341/node_modules/@better-auth/oauth-provider/dist`.
- `CORE` is `/tmp/artifacts-identity-implementation/node_modules/.pnpm/@better-auth+core@1.7.7_@better-auth+utils@0.4.2_@better-fetch+fetch@1.3.2_better-call@_94b44af7b11fcee3e693a882f11ec606/node_modules/@better-auth/core`.

The two installed `@better-auth/oauth-provider@1.7.7` peer variants have identical `introspect-CNR06Oy3.mjs` SHA-1 `fdace4517d6c184af47fe89c3429032efa0bcf7b`. `mcp()` composes `oauthProvider()`, adds its resource and default registration resource, and defaults the refresh reuse interval to 30 seconds. See `MCP/index.mjs:169-176`.

## Access tokens and refresh preserve the session

The access JWT shape is:

```ts
{
	sub: user.id,
	aud: string | string[],
	client_id: client.clientId,
	azp: client.clientId,
	scope: string,
	sid?: string,
	iss: string,
	iat: number,
	exp: number,
	jti: string,
	cnf?: { jkt: string }
}
```

The provider stamps `sid` after custom access claims. Authorization-code redemption fetches a live session by `verificationValue.sessionId`, then issues with `session.id`. Refresh issuance copies `refreshToken.sessionId`. See `OP/introspect-CNR06Oy3.mjs:1349-1372`, `:2022-2041`, and `:2172-2183`.

Set `accessTokenExpiresIn: 300`, `refreshTokenExpiresIn: 604800`, and `refreshTokenReuseInterval: 30`. These options are seconds. Refresh expiry is rolling because each issuance uses the current `iat + refreshTokenTtl`. See `OP/oauth-C_7TvkRL.d.mts:1254-1290` and `OP/introspect-CNR06Oy3.mjs:1603-1617`.

The refresh row persists `sessionId`, `userId`, `clientId`, `scopes: string[]`, `resources?: string[]`, `authTime?: Date`, `expiresAt: Date`, `revoked?: Date`, and replay fields. Its session foreign key uses `onDelete: "set null"`. Deleting a session can therefore remove `sid` from later refresh issuance. See `OP/authorize-K1WHCNih.mjs:3909-3983`.

The known refresh-family race is present. `invalidateRefreshFamily()` reads refresh rows, deletes their access children, then deletes refresh rows. The source records the concurrent recreation window. Enabling adapter transactions does not change this function into an atomic family operation. See `OP/introspect-CNR06Oy3.mjs:1481-1527`.

## RFC 7662 introspection

The HTTP endpoint is `POST /oauth2/introspect`. Its body has `token: string`, optional `token_type_hint: string`, and optional client credential or assertion fields. Missing client authentication fails with `invalid_client`. The client must use its registered method. A public `none` client cannot introspect with only its identifier. See `OP/authorize-K1WHCNih.mjs:4731-4741`, `OP/introspect-CNR06Oy3.mjs:2502-2515`, and `OP/utils-D6Hp4Qd_.mjs:641-654`.

For JWT access tokens, the endpoint checks the signature, issuer, expiry, allowed audience resources, and enabled issuing client. It authorizes the caller if it is the issuing client or has an `oauthClientResource` link to any resource in the token audience. Otherwise it returns `{ active: false }`. This cross-client check applies independently of `enforcePerClientResources`. See `OP/introspect-CNR06Oy3.mjs:2225-2286`.

The resource link shape is `{ id, clientId, resourceId, createdAt?, metadata? }`. `clientId` references `oauthClient.clientId`. `resourceId` references `oauthResource.identifier`, which is the resource URL, not its row ID. The pair needs a unique index. `mcp()` includes the MCP URL in default registration links, including managed clients created through the provider. See `OP/authorize-K1WHCNih.mjs:3867-3902` and `:2011-2029`.

A JWT with `sid` triggers an uncached `adapter.findOne({ model: "session", where: [{ field: "id", value: sid }] })`. Missing or expired sessions return `{ active: false }`. The successful response is the JWT payload plus `active: true`, normalized `client_id = azp`, and `token_type: "Bearer"` or `"DPoP"`. Tokens without `sid` can still return `active: true`. See `OP/introspect-CNR06Oy3.mjs:2272-2286`.

MCP must require a nonempty `sid`, local signature and issuer/audience/expiry/scope checks, and authenticated access-token introspection on each request. The dedicated introspection client needs its MCP resource link. No resource link means `active: false`, even with a valid client secret.

The `createMcpProtectedRequestHandler()` helper accepts `remoteVerify: { introspectUrl, clientId, clientSecret, force?, allowMissingAudience? }`. With `jwksUrl` and no `force: true`, it checks the JWT locally and still introspects on every request. `force: true` skips the local JWT check. The helper sends `client_secret_post`, so its resource client must register that method. A custom Basic-auth request requires a `client_secret_basic` client instead. See `MCP/index.d.mts:8-29` and `CORE/dist/oauth2/verify.mjs:168-214`.

Refresh-token introspection is unsuitable for the session gate. An ended session clears the returned `sid` but can leave `active: true`. Refresh redemption also does not check central session liveness. See `OP/introspect-CNR06Oy3.mjs:2100-2184` and `:2395-2416`.

Canonical subject IDs remain `user.id` with the default public subject policy. Enabling `pairwiseSecret` and a client `subjectType: "pairwise"` changes OIDC and introspection subjects. See `OP/utils-D6Hp4Qd_.mjs:789-791` and `OP/introspect-CNR06Oy3.mjs:2490-2499`.

## ID-token session opt-in

ID tokens emit `sid` only if `client.enableEndSession` or `client.backchannelLogoutUri` is truthy. Register the panel with wire field `enable_end_session: true`; storage uses `enableEndSession`. `customIdTokenClaims` cannot add or override `sid` because it is reserved. See `OP/introspect-CNR06Oy3.mjs:13-51`, `:1406-1419`, and `OP/authorize-K1WHCNih.mjs:2190-2224`.

The administrative managed-client endpoint accepts `enable_end_session`. The DCR schema does not expose it. See `OP/authorize-K1WHCNih.mjs:2505-2533` and `OP/introspect-CNR06Oy3.mjs:1085-1110`.

## Owner bootstrap and global revocation

`emailAndPassword.disableSignUp: true` blocks `auth.api.signUpEmail()` too. The guard is inside the endpoint. See `BA/api/routes/sign-up.mjs:143-148`.

`await auth.$context` exposes the provider's password functions and internal adapter. The concrete provisioned shapes are:

```ts
const userInput = { email, name, emailVerified: true };
const provisioningSource = { method: "email-password" };
const accountInput = {
	userId: user.id,
	providerId: "credential",
	accountId: user.id,
	password: await context.password.hash(password)
};
```

`internalAdapter.createUser(userInput, provisioningSource)` requires the source argument in 1.7.7 types. `internalAdapter.linkAccount(accountInput)` adds timestamps. Credential `accountId` must equal `user.id`, which sign-in checks. User emails normalize to lowercase. This supports a script-only bootstrap without enabling public signup. See `BA/types/auth.d.mts:18`, `CORE/src/types/context.ts:121-130`, `:224-226`, `:456-463`, `BA/db/internal-adapter.mjs:140-168`, `:594-599`, and `BA/api/routes/sign-in.mjs:318-319`.

Managed client creation through `auth.api.adminCreateOAuthClient()` requires a central session and the configured `clientPrivileges` check. It generates the identifier and secret rather than accepting `client_id` or `client_secret` in the endpoint body. With the JWT plugin enabled, `oauthClient.clientSecret` stores a hash, not the raw secret. An application-owned seed must respect that storage contract. See `OP/authorize-K1WHCNih.mjs:2166-2186`, `:2505-2536`, `:1928-1930`, `:4209`, and `OP/utils-D6Hp4Qd_.mjs:479-487`.

`auth.api.revokeSessions({ headers })` requires an authoritative central session, deletes every central session for its user, and returns `{ status: true }`. The lower-level operation is `internalAdapter.deleteUserSessions(userId)`. `deleteSessions(sessionTokens)` accepts tokens, not session IDs. See `BA/api/routes/session.mjs:304-310`, `:420-448`, and `CORE/src/types/context.ts:194-202`.

Neither operation directly addresses the application's panel-session table. The application database can satisfy panel cleanup with an `ON DELETE CASCADE` foreign key to the central session, without a second deletion. Parent verification reports that the implementation's libSQL cascade removes panel rows. This audit does not independently review that application schema. Provider logout intentionally preserves refresh tokens with `offline_access`, and direct database deletion bypasses provider delete hooks. Global revoke therefore requires enforced panel cleanup and grant cleanup. Already-issued JWTs keep their old `sid` and become inactive immediately under introspection. Survivor refresh tokens can lose `sid` through the foreign key, so rejecting missing `sid` remains required. See `OP/authorize-K1WHCNih.mjs:211-261`, `:3924-3931`, and `:4419-4444`.

JWT revocation through `/oauth2/revoke` returns `unsupported_token_type` for a live JWT. Central session deletion and live introspection provide the immediate cutoff. See `OP/authorize-K1WHCNih.mjs:3431-3458`.

`disableSessionRefresh: true` stops central session extension. `cookieCache.enabled: false` avoids positive cookie-cache authorization. See `BA/api/routes/session.mjs:39-48` and `:178-183`.

## Native DCR and redirect matching

DCR defaults omitted `application_type` to `"web"` and omitted auth method to `"client_secret_basic"`. Web clients require HTTPS on non-loopback hosts. Native HTTP redirects permit only exact raw hosts `localhost`, `127.0.0.1`, and `[::1]`. Credentials and fragments are rejected. See `OP/authorize-K1WHCNih.mjs:1630-1637` and `:1685-1708`.

This changes the local panel registration detail in the brief. A local confidential panel with an HTTP loopback callback must use `application_type: "native"` and a confidential token auth method. Application type classifies redirects only, so this does not turn the panel into a public client. See `OP/oauth-C_7TvkRL.d.mts:2899-2906`.

Safe normalization is supported by `hooks.before: createAuthMiddleware(...)`. A user hook runs before provider hooks. Returning `{ context: { body: replacementBody } }` merges the replacement before endpoint execution. The narrow fallback can match only `/oauth2/register`, omitted application type, explicit `token_endpoint_auth_method: "none"`, and all redirects using permitted HTTP loopback hosts without credentials or fragments. It can preserve the original URI strings and set only `application_type: "native"`. See `BA/api/dispatch.mjs:93-100`, `:141-166`, and `:210-234`.

The provider already allows a variable loopback port. Every other character of the registered redirect URI must match, including the host and path. `localhost` does not match `127.0.0.1`, and altered paths or query strings do not match. No custom `validateRedirectUri` hook is required. See `OP/authorize-K1WHCNih.mjs:5386-5445`.

CIMD defaults omitted application type to native-compatible validation and does not need the DCR fallback. The Node metadata transport resolves DNS once, requires every answer to be publicly routable, pins the chosen address, preserves TLS identity, and does not follow redirects. See `OP/authorize-K1WHCNih.mjs:1755-1778` and `CIMD/node.mjs:27-73`.

## Verification boundary

Principle Prove It Works shaped this audit. Claims were checked against installed provider code and exported types, including the session foreign-key action. The evidence establishes provider contracts. End-to-end tests still need to prove authentication failure behavior, missing `sid`, global revoke after refresh, local panel redirects, and real CLI interoperability.

