# Runtime evidence

## Baseline

At base `95a1fc6`, root ran `pnpm test` (59 tests), `pnpm check`, `pnpm build`, and `node --import tsx tests/artifact-browser.proof.ts`. All passed. Outputs are `baseline-tests.log`, `baseline-check.log`, `baseline-build.log`, and `baseline-browser.log`. The real provider logout experiment is recorded in `oauth-probe.md`.

## Final implementation

The implementation was developed in an isolated worktree and integrated without changing its source into `feat/rest-cli`. The main workspace uses Node `v24.12.0`; the isolated worktree's default shell selected Node `v26.11.1`. Explicit Node 24 checks below cover the declared minimum major version.

| Check | Execution and result | Evidence |
| --- | --- | --- |
| Full unit and integration suite | Implementation owner used Node 24.12.0, 89 tests passed | `implementation-tests-node24.log` |
| Final REST assertions | Owner ran seven REST tests on Node 24 after adding chunked body and write-only-scope assertions | `implementation-runtime.md`; `tests/rest.test.ts` |
| Root CLI/auth verification | Root used absolute Node 24.12.0 binary, 23 tests passed after the owner-switch fix | `cli-node24-root.log` |
| Independent boundary review | Reviewer ran 14 REST/client tests on Node 26 and reproduced the owner-switch defect | `review-boundaries.md` |
| Independent auth review | Reviewer ran 15 auth tests on Node 26 and filesystem privacy checks | `review-auth.md` |
| Integrated frozen install | Root ran `pnpm install --frozen-lockfile --ignore-scripts` successfully | `integrated-install.log` |
| Integrated static checks | Root ran `pnpm check`, zero errors or warnings and one existing OIDC deprecation hint | `integrated-check.log` |
| Integrated Node panel | Root ran `pnpm build` successfully | `integrated-build.log` |
| Existing Chrome regression | Root ran `node --import tsx tests/artifact-browser.proof.ts` after integration; all assertions passed | `integrated-browser.log` |
| New CLI and panel Chrome proof | Root ran `tests/rest-cli.browser.proof.ts` successfully after integration on Node 24 and actual Chrome; owner also passed it on Node 26 | `integrated-cli-browser.log`; `browser-panel.png`; `browser-publication.png` |
| Package runtime and declarations | Root ran `pnpm test:packages` on Node 24 after correcting portable docs; external consumers, declarations, installed CLI, real HTTP conflict and database-free client graph passed | `integrated-package-proof.log`; `tests/packages.proof.ts` |
| Integrated package build | Root ran `pnpm build:packages` on Node 24; compiled tarballs exist under `dist/packages/tarballs` | `integrated-packages.log` |
| Worker build | Owner built all four Workers sequentially; root inspected outputs and confirmed REST is bundled in MCP while CLI/Node SQLite is absent | `implementation-runtime.md`; `worker-inspection.json` |
| Skill forward evaluation | Fresh agent used only the skill, its reference and installed help, then completed real CLI operations | `skill-forward.md`; `skill-evidence.zip` |
| Root skill interoperability | Root compared the CLI-created artifact through REST and MCP, including identical ZIP bytes across all three | `skill-root-check.json`; `skill-export.zip` |

The earlier root runs `rest-root.log` and `cli-client-root.log` passed seven tests each under Node 26. They are intermediate evidence, not additional unique tests in the final count.

## Resolved findings and preserved guarantees

The boundary reviewer reproduced one P1 account-switch race. Commit `45298c5` fixed it by resolving one credential per CLI invocation. Root inspected the fix and ran the regression for create, retry and edit on Node 24. The other account's library remains empty. The auth review found no material issue. The trail reviewer found repository-relative links in shipped README files. They now use immutable source URLs. Root rebuilt the packages and verified all four links against committed source files; `package-doc-links.json` records the check. CI now runs both the external package proof and the new CLI/panel browser proof.

The skill evaluator found missing complete-command JSON examples. The reference now contains the exact fields and complete update/publication examples. The evaluator executed those commands with unchanged request IDs and arguments in a second private state directory, recovered the original receipts, and confirmed no additional revision or publication version.

Real HTTP tests cover REST-only creation, listing, reading, updating, history, publication and export. REST and MCP share immutable state and compete on publication versions. Socket loss after committed create, update and publication is recovered by exact REST and CLI retries. Ownership, missing scopes and central revocation are checked before receipt replay. CLI subprocesses cover concurrent refresh/logout, late browser callbacks and SIGKILL after provider rotation. The marker survives and a new process sends no unsafe second refresh.

The new Chrome proof uses real native OAuth consent and persisted CLI credentials. It verifies CLI content in the built panel and protected publication, historical export equality, a stale panel publication form returning 409 after a CLI publication, and post-revocation denial. Root inspected both saved screenshots. The existing browser regression additionally covers original panel actions, comparison, retained history, sandboxing, attachments, mobile layout and backend outage.

The skill fixture and both known temporary credential directories were removed after root archived credential-free evidence. No production deployment, npm publication, or normal-account mutation occurred. The private compiled tarballs are local distribution artifacts. Node's experimental SQLite API is confined to CLI credential storage. Local logout cannot revoke an already copied self-contained access JWT; existing central-session revocation remains immediate.
