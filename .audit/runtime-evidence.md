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

## Limits

The dashboard currently uses the Astro Node adapter. Deployments must retain the installed workspace packages beside its build so libSQL's native driver resolves correctly. Remote Turso, Cloudflare, and Vercel deployments were not exercised. The MCP process does not need database credentials.

Better Auth 1.7.7's refresh-family race remains an upstream limitation. Central-session deletion and the mandatory nonempty sid protect resource access, including a surviving refresh that issues sid:null. The concurrency test does not claim to force every internal provider interleaving.

Claude's successful MCP OAuth is distinct from its expired model-provider login. Its actual model-driven `whoami` remains an external acceptance gap. No remote Git repository is configured, so this work has local commits and no PR. No external service was deployed.
