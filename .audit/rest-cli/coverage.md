# Acceptance coverage

| Obligation | Actual boundary | Required observation |
| --- | --- | --- |
| CLI login | CLI subprocess, loopback callback, auth browser | DCR, PKCE, state and consent yield working persisted credentials without server secrets |
| CLI commands | CLI subprocess to actual REST HTTP server | create, list, read, update, history, publish, export return literal expected content |
| Direct REST | fetch or curl to REST-only server | Same complete flow without MCP startup or protocol calls |
| Client package | Imported HTTP client to actual REST HTTP server | Domain responses and structured errors, no DB dependency in consumer bundle |
| Existing MCP | JSON-RPC tools over HTTP | Sees REST/CLI writes and can update the same artifact |
| Existing panel | Built Astro app in actual Chrome | Shows created artifact, retained revision and publication; downloads identical historical ZIP |
| Concurrent edits | Two actual HTTP clients against one database | Exactly one expected-head winner, one 409 and no extra revision |
| Concurrent publication | Independent REST and MCP commands | Exactly one expected-version winner and preserved stable URL |
| Uncertain create/update/publish | Drop response after transaction, repeat exact saved command | Same receipt, no extra revision or publication version |
| Changed retry | Reuse request ID with changed body or response mode | request_conflict, unchanged state |
| Ownership | Separate real OAuth account | Another owner's artifact reads/exports/history/mutations fail without leaking content |
| Scopes | Real OAuth token with limited granted scopes | Writes/publish forbidden before mutation or receipt replay |
| Central revocation | Actual account revocation then request/replay | REST, CLI, MCP and panel deny access |
| Credential refresh | Concurrent CLI processes | Credential rotation remains usable, atomic private persistence |
| Input and HTTP guards | Direct malformed, oversized, wrong-origin/host, redirect probes | Bounded and typed denial, secrets never forwarded on redirects |
| Packaging and skill | Documented command examples and independent skill run | Real commands succeed with claimed outputs; references and frontmatter validate |

Baseline evidence is baseline-tests.log, baseline-check.log, baseline-build.log and baseline-browser.log. New rows need executable tests and recorded output before they count as verified.
