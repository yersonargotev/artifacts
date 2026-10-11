# Independent identity review

Verdict **ISSUES**. The default local identity flow passes the independent checks. Three concrete configuration or verification-runner defects remain. No authentication bypass, revocation bypass, privilege-granting anonymous registration, accidental credential, or code suppression was found in the reviewed increment.

Scope is `/tmp/artifacts-identity-implementation` against `dfaa03a`, including committed and working-tree implementation, schema, migrations, tests, README, decision document, and audit artifacts. Vendor and Packy skill changes are excluded from the application verdict. Installed provider source was inspected to verify boundary contracts. Application code and personal configuration were not edited. Disposable tests and ignored generated build artifacts were permitted by the assignment.

Throughput checkpoint is not applicable to this read-only review.

## Findings

1. **P2. Bootstrap assigns the resource client the dashboard's application type.** `apps/auth/src/bootstrap.ts:34` derives both registrations from `config.dashboard`, while the introspection client's redirect at line 32 derives from `config.resource`. With a valid HTTPS dashboard and an HTTP loopback MCP resource, the resource client becomes `web`. Better Auth rejects that HTTP redirect with `400 invalid_redirect_uri`, so bootstrap cannot finish. This was reproduced through the real provider against a disposable database in `security-probes.mjs`. Choose the application type from each client's actual redirect URI.

2. **P2. AUTH_URL and DASHBOARD_URL accept paths that the applications cannot serve.** `packages/config/src/index.ts:10` accepts an arbitrary pathname, and lines 19 and 35 use the result as an origin. An observed accepted configuration of `http://localhost:4100/auth` and `http://127.0.0.1:4321/panel` creates a callback of `/panel/auth/callback`; Astro exposes `/auth/callback`. It also compares native POST Origin `http://localhost:4100` against `http://localhost:4100/auth` at `apps/auth/src/http.ts:14`, which always denies the global-revoke form. `apps/dashboard/src/middleware.ts:9` has the same mismatch. Reject non-root paths for those two service origins. Retain resource-path support for MCP_URL.

3. **P2. Browser startup failure bypasses cleanup and can leave the proof command running.** `tests/browser.proof.ts:24` launches Chrome before the `try` at line 25, after starting the disposable auth/MCP servers and dashboard child. A rejected launch never reaches lines 69-74. The dashboard child and fixture listeners remain open. The README correctly names installed Chrome as a prerequisite, but a failed launch must still close the resources and exit. Source proves the cleanup omission; this failure path was not deliberately forced. Put the launch under cleanup ownership and close an optional browser in `finally`.

These findings do not invalidate the successful default-host runtime evidence. They should be repaired before claiming all accepted configuration combinations and failed proof runs behave correctly.

## Independent execution

| Command | Result |
| --- | --- |
| `pnpm test` | PASS, 12 tests, zero failures. Real HTTP OAuth/OIDC, disposable libSQL, replay, refresh, callback barrier, central deletion, identity mismatch, and MCP outage checks. |
| `pnpm check` | PASS. Zero errors and warnings. One deprecation hint for the local-HTTP `openid-client.allowInsecureRequests` escape hatch. |
| `pnpm test:browser` | PASS. Includes `pnpm build` and launches the built standalone dashboard through plain Node. Native login, panel logout, central SSO, global revoke, cookie deletion, old-token rejection, and mobile width assertion pass. |
| `node --import tsx /tmp/artifacts-identity-design/security-probes.mjs` | PASS. Confirms finding 1 and the additional boundary checks below. |
| `git diff --check` | PASS. |

The probe's first runs corrected assertion expectations after observing provider errors. Better Auth returns an APIError body rather than using the description as Error.message; its anonymous admin HTTP route is unavailable with 404; wrong PKCE returns 401; invalid redirect authorization returns an OAuth error URL in a 200 JSON response. The final probe checks those actual contracts. No failed probe is presented as a completed pass.

Additional probe results are literal checks against real fixture endpoints. Anonymous DCR cannot set `skip_consent` or use `client_credentials`. The generic `/api/auth/token` endpoint is disabled. A wrong PKCE verifier is denied. A changed loopback hostname or callback path receives an OAuth error without a code. Wrong resource introspection credentials yield MCP 503. Reading the auth session does not extend its persisted expiration. Expiring the central session yields MCP 401.

## Admission and revocation assessment

`apps/mcp/src/identity.ts:26` verifies signature, issuer, resource audience, expiration, required identity claims, and client/azp consistency. A nonempty sid is mandatory. Lines 35-51 perform authenticated, uncached introspection for every protected request, fail closed on an unavailable or malformed provider, and compare signed and live identity, client, expiration, and scopes. `apps/mcp/src/http.ts:17` wraps each MCP request before constructing its stateless handler. 401, 403 insufficient scope, and 503 behavior pass actual HTTP tests. The branded principal has one creation boundary.

`apps/dashboard/src/identity.ts:17` uses confidential OIDC discovery and signature checks. The durable transaction is claimed by one atomic DELETE before exchange at line 34. State, nonce, PKCE, issuer, and client audience are provider-library checks. The application checks the central session's exact canonical subject at line 44 and joins to live central state on every panel request at lines 53-55. Identity does not depend on email. Callback insertion is transactional, and the migration's panel-session foreign key cascades deletion. The explicit token-response barrier test proves a revoked callback cannot create an admitted panel session. A valid signature with a wrong subject is denied.

The cookie options are host-only, HttpOnly, SameSite=Lax, and Secure under HTTPS. Distinct auth/panel cookie hosts are enforced. Native mutation forms require exact Origin, and the built-browser proof confirms `Referrer-Policy: same-origin` preserves that Origin. Panel logout only deletes the panel session. Global revoke deletes central sessions first; grant cleanup is best effort. Existing JWTs fail introspection after deletion. A surviving refresh receives sid:null and fails the independent MCP claim gate.

Auth sessions have a configured absolute thirty-day lifetime without refresh or positive cookie caching. Access and refresh settings are five minutes and seven days with thirty-second rotation replay. The known Better Auth refresh-family race remains accurately documented as upstream behavior. The concurrent test starts both operations together, permits either provider outcome, then verifies tokens from either branch cannot bypass central deletion. It does not claim to force the provider's precise internal race window or repair that algorithm.

## Structure, comments, and delivery artifacts

The apps own their admission logic. Shared config owns static scope data and URL validation; the DB package owns schema and migrations. There is no extra policy framework or parallel auth implementation. The observed one-caller boundaries compress actual ownership rather than mirror another interface. No obsolete compatibility path was found. The native DCR fallback and stateless legacy MCP setting have explicit interoperability consumers.

The direct independent no-comments audit found zero authored narrative comments, zero lint/TypeScript suppressions, and no workaround comments or unenforced comment constraints in application code, tests, or scripts. The generated Drizzle `statement-breakpoint` delimiters are migration syntax. Deletions, restorations, reruns, encoding proposals, and code fixes by this reviewer are all zero. The three fixes above are handed to root under the read-only scope.

README startup commands match the scripts. Dashboard externalization preserves the native libSQL package resolution; the actual production build starts and serves the full browser flow. The workspace dependencies must remain beside that build, as documented. Migration ownership is singular, and repeated local migration plus foreign-key enforcement are tested. Bootstrap preserves existing owner and client IDs in its normal retry path. Its mixed-topology defect is finding 1. No remote deployment or Turso verification is inferred from local SQLite.

The provider audit's ISSUES verdict describes provider contract limits, not unhandled application bypasses. Application sid checks, native local registration, and panel session binding implement those limits. The archived root-assessment still says cross-judge pending, while the authoritative judgment and later TSV row supersede it. This is preserved provenance rather than a claim of a pending runtime gate.

## Attention

Reviewed by the independently assigned Codex security reviewer. The exact reviewer model ID is not exposed in this agent's context; root owns the cross-model routing record. Implementation was reported as `gpt-6-astra`.

- Repair findings 1-3 and rerun the relevant proof. This verdict covers source present during the review and cannot certify later edits without inspection.
- `.audit/identity.tsv:5`, `:6`, `:8`, `:10`, and `:11` use command descriptions instead of a resolving output artifact or committed-script/commit pointer. Current independent reruns corroborate present behavior, but they do not establish the historical timestamps. Append a final verification row pointing to the actual report/evidence. The existing trail also lacks run-boundary start rows required when another agent appends to it; preserve history and append a correcting provenance row rather than rewriting earlier rows.
- Root's `root-evidence.md` distinguishes actual Codex whoami success from Claude's successful MCP OAuth connection and the unverified Claude model tool invocation. Anthropic account credential expiry remains the actual external blocker. This reviewer did not independently rerun personal CLIs or inspect private CLI credentials and does not invent success.
- Remote Turso and cloud deployment remain unverified. No external deployment or personal CLI configuration was changed during this review.

Principle Prove It Works changed the review toward executing real HTTP and built-browser flows, plus a disposable provider probe. Principle Minimize Reader Load shaped the trace of each identity boundary and the judgment that the current app-local ownership does not need another abstraction.
