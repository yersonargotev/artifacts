# Owner access review

The account owner keeps password, email-code, CLI, HTTP MCP, panel, and protected publication access. Other accounts are suspended unless the server explicitly enables guest access. Existing cookies and tokens do not bypass the closed policy.

## Policy and scope

`AccessPolicy` contains `ownerEmail` and `allowGuests`. `OWNER_EMAIL` is required even without email delivery. Missing `ALLOW_GUEST_ACCESS` means false. Only literal `true` and `false` values are accepted. Auth, MCP, and panel must use the same policy. Worker defaults are closed. Configuration changes require a restart or Worker configuration update.

Open mode preserves the existing admission rule. A guest needs a current email share or an owned artifact. An account alone is insufficient. Per-artifact ownership, sharing, and verified-email checks still apply.

The policy is checked at session creation and use, OAuth issuance and introspection, panel identity loading, and publication grant and viewer reads. The refresh replay check runs before the provider can return its cached response. Explicit token hashing matches the installed provider's previous SHA-256/base64url default.

Changing the flag does not delete accounts, sessions, shares, or token records. Normal expiry, explicit sign-out, single-use code consumption, and revocation still apply. The same saved guest cookies and bearer token worked after reopening in the browser proof.

## Design decision

| Candidate | Decision | Reason |
| --- | --- | --- |
| Shared admission at identity boundaries | Selected after independent review | Covers existing central sessions, bearer tokens, panel sessions, and publication cookies with one rule. |
| Auth HTTP guard plus panel check | Rejected | Misses publication cookies and internal auth API calls unless it duplicates boundary checks. |

Model the Domain concentrated admission in a shared predicate. Fix Root Causes replaced environment-dependent, in-memory throttling with explicit activation and atomic database counters. Prove It Works required replaying existing credentials against actual HTTP services and the built panel.

The throughput checkpoint kept policy implementation with one code owner. Read-only design investigations ran independently. Each verification instance used its own disposable database. A separate reviewer checked the security boundaries, provider hook order, hash compatibility, comments, and test evidence.

## Verification

- `pnpm test` passed all 293 tests with zero failures, skips, or cancellations. Evidence is `.test-artifacts/owner-access/test-complete.tap`.
- `pnpm check` passed. Astro reported one existing deprecation hint. Evidence is `.test-artifacts/owner-access/check-complete.log`.
- `pnpm test:owner-access` covers nine HTTP regressions. It checks closed defaults, owner recovery, old access and refresh tokens, cached refresh replay, pending OAuth codes, userinfo, publication grants, revoked invitations, and atomic quotas across Node and Worker runtimes.
- `pnpm build` and auth, MCP, and panel Worker builds passed. Evidence is `.test-artifacts/owner-access/build-final.log`, `workers.log`, and `panel-worker.log`.
- `pnpm test:packages` passed release validation, offline skills, external package installation, REST invitation behavior, and the installed CLI. Evidence is `.test-artifacts/owner-access/packages.log`.
- The migrated verification helper passed launch, doctor, disposable guest account setup, and cleanup. Evidence is `.test-artifacts/verify-artifacts/owner-access-helper/doctor.json` and `cleanup.json`.

Run the browser proof with a Chromium 152+ executable. This session used the installed Brave Browser with a disposable profile.

```sh
CHROME_EXECUTABLE='/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' pnpm test:owner-access:browser
```

The browser reported Chromium `156.0.8078.48`. Open mode admitted the invited guest through the real code form and interactive publication. Closed mode denied existing guest panel and viewer cookies, old bearer access, content, and attachments. Owner session, publication, code, CLI, and HTTP MCP remained usable. Reopened mode accepted the same saved guest credentials. Browser errors were empty. All proof processes stopped and the disposable database and credentials were removed.

Final browser evidence is `.test-artifacts/owner-access/browser-94a70c4b-1705-43ff-b8c0-5cc9104e4ebe/result.json` with screenshots and accessibility snapshots alongside it. Raw private evidence stays ignored. The initial missing-Chrome attempt and unsupported Chrome 148 attempt are retained as failed runs, not counted as passing evidence.

## Review notes

The general limiter baseline returned eight consecutive 401 responses in the captured concurrent test. After the fix, only three attempts reached password authentication and the remaining five returned 429. A separate manual baseline used five requests. The append-only decision trail corrects the earlier mismatched evidence count.

Existing cross-owner test fixtures now establish legitimate admission before testing artifact isolation. The invitation subprocess fixture also copies Hono request fields explicitly because Node 26 rejects the lazy request object as RequestInit. Its 17 concurrency scenarios passed after that fixture correction.

Independent review found no production security blocker and no new comment or suppression finding. Review used the inherited host model. A review across different model families was unavailable and is not claimed.

No production account, database, configuration, deployment, or public package was changed. Live Claude and Codex client sessions and production edge behavior were outside this local proof. The CLI proof uses the actual source and installed CLI against disposable HTTP services.
