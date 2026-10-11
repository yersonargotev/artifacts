# Independent review of identity fixes

Verdict **PASS** for the application fixes in commit `3b854bba2015decc7edfe1f1c7f5730ff396ad3b`. All three P2 findings in [the first independent review](security-review.md) are closed. The mobile proof regression found during this review is also closed. No remaining scoped source finding was found.

The reviewed base is `84fa7c5bd2938ab91e452b5fd4dc229c5e20c9df`. The five-file final diff contains bootstrap, configuration validation, browser proof, and two new tests. `git status --short` returned no entries after the implementation commit. The final browser runner blob is `c9ec388b19d935fea46b44639c7562f6da62284f`.

This review followed the installed poteto-mode instructions as a scoped, read-only investigation. Application code, personal CLI configuration, normal `.env`, account data, environment configuration, and Memory were not changed. No subagents were started under the explicit assignment. Disposable fixtures and an external failure-injection module were used.

throughput checkpoint: n/a, read-only investigation

## Closed findings

1. Bootstrap now computes each client's actual redirect URI at `apps/auth/src/bootstrap.ts:30` and derives its application type from that same URI at line 35. The new bootstrap test runs the real command twice in a temporary directory with a migrated disposable database. An HTTPS dashboard registers as `web`; the HTTP loopback MCP resource registers as `native`. The test confirms a single owner, the same owner ID, preserved client secrets, and one resource link after the retry.

2. `packages/config/src/index.ts:16` rejects a non-root pathname for `AUTH_URL` and `DASHBOARD_URL`. The new configuration test verifies those failures through the public config functions. `MCP_URL` retains its `/mcp` resource path. HTTPS and exact loopback HTTP validation remain in place.

3. Chrome launch now occurs inside `try` at `tests/browser.proof.ts:26`. The optional browser is closed in `finally` at line 84, followed by dashboard-child termination, its exit wait, and fixture cleanup. A forced launch rejection against the final runner exits naturally with status 1 and the expected sentinel error. It does not leave the proof command running.

The initial mobile change used `page.context().newPage()` after `browser.newPage()`. An independent real run failed with Playwright's `Please use browser.newContext()` error. The owner replaced that owned context with an explicit context at line 36 and creates both pages from it. The repeated real browser proof passes.

Mobile capture now sets a new page's viewport before navigating. It waits for fonts and two animation frames, asserts one header, heading, identity card, and footer, and checks horizontal overflow. The current mobile PNG was visually inspected at its original resolution. It shows one copy of each section, readable content, and the tool and logout controls. The desktop page is never resized into the mobile capture. This avoids the observed Chrome resize paint duplication in the verified run.

## Independent execution

| Check | Result |
| --- | --- |
| `node --import tsx --test tests/bootstrap.test.ts tests/configuration.test.ts` | PASS. Two tests and zero failures. |
| `node --import tsx tests/browser.proof.ts` after the explicit-context correction | PASS. Built standalone dashboard, actual Chrome, isolated HTTP services, native forms, panel logout, central SSO, global revocation, cookie deletion, old-token rejection, and mobile capture. |
| Final runner with forced Chrome launch rejection | Expected status 1. The sentinel exception reaches the caller and the command terminates. |
| `git diff --check 84fa7c5` | PASS. |
| Final source and comments audit | PASS. No authored comments, suppressions, or unsupported constraint comments in the five-file diff. |

The real browser proof used the existing built dashboard. The owner separately reported 14 tests, type checks, and a fresh built-browser proof passing. Those owner checks are not presented as this reviewer's independent executions. The broader previous independent check, build, 12-test suite, and browser evidence remain recorded in the first report.

The failure injection is retained in [security-fix-launch-failure.mjs](security-fix-launch-failure.mjs). It imports the same installed Playwright module and replaces only `chromium.launch` with an asynchronous sentinel exception. The exact command was:

```sh
node --import tsx --import /tmp/artifacts-identity-design/security-fix-launch-failure.mjs tests/browser.proof.ts
```

Its final execution used Node `26.10.0`, commit `3b854bba2015decc7edfe1f1c7f5730ff396ad3b`, and runner blob `c9ec388b19d935fea46b44639c7562f6da62284f`. The exception originated from runner line 26. There was no timeout, termination signal, or manual process cleanup in that execution.

## Boundaries and remaining delivery work

The fixes leave the reviewed admission boundaries intact. MCP still requires nonempty `sid`, verifies the JWT, and performs authenticated uncached introspection for each protected request. The panel still checks the verified subject against a live central session and joins to that central session on every load. The final diff does not change either identity module.

No deletion, restoration, rerun of a rejected comments report, code fix, constraint encoding, or encoding offer was made by this reviewer. All such counts are zero. The direct comments audit is independent of the implementation owner; no additional nested comments reviewer was used.

The earlier audit's historical command-only evidence does not establish those original timestamps. Root's final README, sanitized evidence, and correcting audit append are separate delivery work and are outside this application certificate. Historical records must remain preserved.

[Root runtime evidence](root-evidence.md) distinguishes the successful actual Codex MCP `whoami` from Claude's OAuth connection and `Connected` status. The actual Claude model tool invocation remains unverified because the Anthropic credential expired. This review did not run personal CLIs or inspect private credentials. Remote Turso and cloud deployment remain unverified. No deployment or remote PR was performed.

Principle Prove It Works changed the review toward a real Chrome run and a forced startup failure. That execution caught the temporary mobile-context regression before certification. Principle Minimize Reader Load shaped the source trace. Each client type derives beside its redirect URI, service-origin validation has one boundary, and cleanup ownership remains visible in the proof runner.
