# Acceptance coverage

| Obligation | Actual boundary | Required observation | Evidence |
| --- | --- | --- | --- |
| CLI login | CLI subprocess, loopback callback, auth browser | DCR, PKCE, state and consent yield working persisted credentials without server secrets | `tests/cli-auth.test.ts`; `tests/rest-cli.browser.proof.ts` |
| CLI commands | CLI subprocess to actual REST HTTP server | create, list, read, update, history, publish, export return literal expected content | `tests/cli-client.test.ts`; `skill-forward.md` |
| Direct REST | fetch or curl to REST-only server | Same complete flow without MCP startup or protocol calls | `tests/rest.test.ts` REST-only fixture |
| Client package | Imported HTTP client to actual REST HTTP server | Domain responses and structured errors, no DB dependency in consumer bundle | `tests/packages.proof.ts` external client install and declarations |
| Existing MCP | JSON-RPC tools over HTTP | Sees REST/CLI writes and can update the same artifact | `tests/rest.test.ts` REST/MCP state and publication race |
| Existing panel | Built Astro app in actual Chrome | Shows created artifact, retained revision and publication; downloads identical historical ZIP | `tests/rest-cli.browser.proof.ts`; `integrated-browser.log` |
| Concurrent edits | Two actual HTTP clients against one database | Exactly one expected-head winner, one 409 and no extra revision | `tests/rest.test.ts` competing HTTP writers |
| Concurrent publication | Independent REST and MCP commands | Exactly one expected-version winner and preserved stable URL | `tests/rest.test.ts`; stale panel form in `tests/rest-cli.browser.proof.ts` |
| Uncertain create/update/publish | Drop response after transaction, repeat exact saved command | Same receipt, no extra revision or publication version | `tests/rest.test.ts`; `tests/cli-client.test.ts` dropped committed responses |
| Changed retry | Reuse request ID with changed body or response mode | request_conflict, unchanged state | `tests/rest.test.ts`; `tests/cli-client.test.ts` exact command conflicts |
| Ownership | Separate real OAuth account | Another owner's artifact reads/exports/history/mutations fail without leaking content | `tests/rest.test.ts`; `tests/cli-client.test.ts` outsider and owner-switch cases |
| Scopes | Real OAuth token with limited granted scopes | Writes/publish forbidden before mutation or receipt replay | `tests/rest.test.ts` real limited and write-only grants |
| Central revocation | Actual account revocation then request/replay | REST, CLI, MCP and panel deny access | `tests/oauth.test.ts`; `tests/rest.test.ts`; `tests/rest-cli.browser.proof.ts` |
| Credential refresh | Concurrent CLI processes | Credential rotation remains usable, atomic private persistence | `tests/cli-auth.test.ts`; `cli-node24-root.log` |
| Input and HTTP guards | Direct malformed, oversized, wrong-origin/host, redirect probes | Bounded and typed denial, secrets never forwarded on redirects | `tests/rest.test.ts`; `tests/cli-client.test.ts`; `tests/cli-auth.test.ts` |
| Packaging and skill | Documented command examples and independent skill run | Real commands succeed with claimed outputs; references and frontmatter validate | `tests/packages.proof.ts`; `skill-validation.md`; `skill-forward.md` |

Baseline evidence is baseline-tests.log, baseline-check.log, baseline-build.log and baseline-browser.log. Implementation outcomes and runtime versions are recorded in `runtime.md`, `implementation-runtime.md`, and the linked logs. Skill execution is recorded separately in `skill-forward.md`.
