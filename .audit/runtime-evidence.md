# Verified identity increment

This increment implements a personal authorization server, remote MCP resource, and Astro dashboard. It provides shared identity, `whoami`, panel-only logout, and global revocation. Artifact storage and publication are the next increment.

## Root execution

The initial real CLI checks used the generated local owner in the isolated implementation worktree. Credentials, browser state, callback codes, and CLI transcripts remain private ignored files. They are not copied into this audit.

- Codex CLI 0.162.1 completed CIMD OAuth through a real browser. An actual `codex exec` invoked MCP `whoami`. Its canonical user ID matched the dashboard's displayed ID.
- Claude Code 2.1.296 completed CIMD OAuth through a real browser. Native `claude mcp get` reported Connected. The model tool call was not verified because the Anthropic account credential had expired and could not refresh. No replacement credential was available.
- Real browser login, panel logout, and SSO back into the panel passed. Codex called `whoami` afterward with the same central user and session. One earlier model response dispatched no tool and was inconclusive; the actual retry succeeded.
- Global revoke passed in the real browser. Both relevant cookies disappeared. Claude then reported Needs authentication. Codex's protected MCP startup received AuthRequired with the metadata challenge before any tool could execute.
- Native logout initially failed with Origin:null under Referrer-Policy:no-referrer. Changing the policy to same-origin preserved the native form Origin while retaining strict CSRF checks. The real browser and the production browser proof verified the correction.
- Temporary CLI credentials and the owned Claude project MCP entry were removed after verification. Existing personal CLI configuration was preserved.

The application implementation and review fixes were integrated into the requested workspace at commit `3b854bb`. From that workspace, root executed the following checks successfully.

| Command | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Installation succeeded with the committed lockfile. |
| `pnpm configure` | Created a fresh ignored local configuration with mode 0600. |
| `pnpm db:migrate` | Applied the owned migrations. |
| `pnpm identity:bootstrap`, twice | Both succeeded without replacing the account or confidential clients. The isolated subprocess regression also verifies IDs, secrets, and resource links. |
| `pnpm check` | Zero errors and warnings. One deprecation hint for the explicit local HTTP OIDC escape hatch. |
| `pnpm test` | Fourteen tests passed with zero failures or skipped tests. |
| `pnpm test:browser` | Fresh Astro production build and actual Chrome flow passed. Disposable services and database isolate this from the local account. |
| `fnm exec --using 24.12.0 node --import tsx tests/browser.proof.ts` | The built dashboard and browser flow also passed on Node 24.12.0. |

Root visually inspected desktop and mobile captures. The final mobile capture contains one header, welcome, identity card, tools section, and footer without horizontal overflow. A temporary Chrome repaint duplication and a Playwright owned-context error were corrected before the final proof. The runner now uses an explicit browser context and captures a newly navigated mobile page.

## Coupled development startup

The final workspace startup exposed Astro 7.3.8's automatic background mode under an agent environment. Astro's child exited successfully, so the supervisor stopped authorization and MCP while the background dashboard remained. Root reproduced the actual failure.

```text
http://127.0.0.1:4101/health unavailable
http://localhost:4100/health unavailable
http://127.0.0.1:4321 200
```

A fresh gpt-6.1-sol bug-fix agent independently reproduced the mechanism and committed only `--ignore-lock` in the dashboard command at `54f2ed5`. The installed Astro source explicitly makes this flag disable agent-inferred backgrounding. Root repeated `pnpm dev` on those final bytes. The command remained active and yielded these actual results.

```text
http://127.0.0.1:4101/health 200
http://localhost:4100/health 200
http://127.0.0.1:4321 200
```

Root then sent Ctrl+C. The supervisor exited with status 0 and `lsof` found no listeners on 4100, 4101, or 4321. The child pnpm process prints its SIGTERM shutdown message; it does not leave a running service. The script fix passed TypeScript and whitespace checks. [The independent handoff review](reviews/handoff-review.md) covers this final startup change and the documentation. Services are stopped at handoff.

## Independent review

Implementation used gpt-6-astra. The independently assigned gpt-6.1-sol security reviewer executed actual HTTP, integration, build, and browser checks. Its [first report](reviews/security-review.md) found three P2 issues. A fresh gpt-6.1-sol reviewer independently [closed all three](reviews/security-fix-review.md) at `3b854bb` and verified the mobile correction and a forced Chrome-launch failure. No scoped authentication or revocation bypass, accidental secret, or suppression remained.

The first report and its preliminary root evidence are historical records. Their pending statements describe that review stage. The final review and this document state the later verified results. Commands in the original TSV do not independently establish the historical timestamps; the final append links these resolving reports instead of rewriting earlier entries.

## Principles that changed choices

| Principle read during this run | Concrete choice |
| --- | --- |
| Foundational Thinking | Generate and verify the provider schema before building the applications that share its state. |
| Model the Domain | Represent MCP admission as a discriminated decision and construct a branded verified principal at one boundary. |
| Boundary Discipline | Parse and reconcile external credentials at resource entry; check canonical live session ownership in the panel callback. |
| Laziness Protocol | Select app-local admission logic instead of a generic shared policy framework. |
| Sequence Work into Verifiable Units | Commit the database foundation, working identity increment, review fixes, and startup correction separately after relevant verification. |
| Prove It Works | Use real CLI calls, native browser forms, production output, and coupled startup. Those executions exposed defects that type checking alone missed. |

## CLI acceptance follow-up — 2026-10-11

After the owner renewed the Anthropic login, root registered the local `artifacts` HTTP MCP in both CLIs. Codex retains a global registration; Claude retains a local registration private to this repository in the owner's CLI configuration. The running development services and existing owner account were preserved.

- Codex completed OAuth during `codex mcp add`. An ephemeral, read-only `codex exec` emitted a completed `artifacts.whoami` tool call.
- Claude completed `claude mcp login artifacts` in an interactive terminal. A nonpersistent `claude --print` run, restricted to this MCP and its read-only `whoami` tool, emitted the actual tool use and successful tool result.
- Both tool results returned the same user ID and central session ID, with their respective CIMD client IDs. Root read the already-open dashboard in the real browser and verified that its displayed user ID matched both CLI results.
- Private JSONL evidence remains under ignored `.test-artifacts/cli-acceptance/`. No tokens, passwords, callback codes, or personal account identifiers are included here. These retained CLI connections use the normal local account; no global revocation was performed.

The earlier expired-Anthropic limitation is closed by these actual model-driven calls. This follow-up verifies local identity and MCP connectivity, not artifact creation or publication, which remain unimplemented.

Cloudflare's `cf auth whoami` reported a valid OAuth session; a read-only `cf r2 buckets list --per-page 5` succeeded and returned no buckets. No Cloudflare resources were created or deployed. The project's database still uses a local file, has no remote database token configured, and `turso auth whoami` reported no CLI login.

## Remote Turso database follow-up — 2026-10-11

After the owner logged into the Turso CLI, root provisioned a dedicated `artifacts` libSQL database in the existing default group. The pre-existing database was not modified. A database-scoped token and URL were written to ignored `.env.turso` with mode `0600`; normal `.env`, running local services, and CLI credentials were preserved.

Root applied the committed migrations twice, then added and ran the repeatable `pnpm verify:turso` proof against that actual remote database. It passed:

- Repeatable migrations and foreign-key enforcement through the existing Node database factory.
- Drizzle transaction rollback, with absence of rolled-back rows confirmed through both Node and web libSQL clients.
- A committed synthetic user, central session, and panel session visible through the separate web client.
- The actual `revokeUserIdentity` application function removing central sessions and cascading to panel sessions, with the deletion also visible through the web client.
- Rejection of a panel session referring to the deleted central session.
- Cleanup of all synthetic proof identities, confirmed through the web client.

`pnpm check` passed with zero errors and warnings and the existing local-HTTP OIDC deprecation hint. This follow-up proves remote database connectivity and semantics, not deployed applications or a model-driven MCP connection backed by Turso. No Cloudflare service was deployed.

## Deployment limits

The dashboard currently uses the Astro Node adapter. Deployments must retain the installed workspace packages beside its build so libSQL's native driver resolves correctly. Remote Turso's database boundary passed the follow-up above; cloud application deployments were not exercised. The MCP process does not need database credentials.

Better Auth 1.7.7's refresh-family race remains an upstream limitation. Central-session deletion and the mandatory nonempty sid protect resource access, including a surviving refresh that issues sid:null. The concurrency test does not claim to force every internal provider interleaving.

Claude's earlier model-provider login gap was closed in the CLI acceptance follow-up above. Cloud deployment and end-to-end identity flows using the remote database remain unverified. No remote Git repository is configured, so this work has local commits and no PR. No external service was deployed.
