# REST and CLI implementation evidence

The accepted shared-core design is implemented. Domain schemas, workflow helpers, serialization, and `ArtifactError` now have one database-free contracts runtime. The store's transaction and receipt semantics are unchanged. REST and MCP call that store directly. The default host composes both, and `apps/rest/src/server.ts` starts REST alone without loading a normal environment file.

The implementation sequence was contracts, REST with real HTTP acceptance, client and CLI, then installed-package and browser proof. OAuth and credential storage had exclusive ownership separate from client and command implementation. Root manifests, HTTP integration, and builds stayed with the implementation owner.

## Runtime observations

| Gate | Executed command or boundary | Result |
| --- | --- | --- |
| Existing domain and workflow after extraction | `node --import tsx --test tests/workflow.test.ts tests/artifacts.test.ts` | 17 passed on Node 26.11.1 |
| REST, domain, OAuth, and workflow milestone | `node --import tsx --test tests/rest.test.ts tests/artifacts.test.ts tests/workflow.test.ts tests/oauth.test.ts` | 31 passed on Node 26.11.1 |
| Complete unit suite | Node 24.12.0 with `--import tsx --test tests/*.test.ts` | 89 passed, zero failures. See implementation-tests-node24.log |
| Additional streaming and route-scope assertions | Node 24.12.0 with `--import tsx --test tests/rest.test.ts` | Seven passed, including chunked bodies without Content-Length and write-only create |
| Frozen install | `pnpm install --frozen-lockfile --ignore-scripts` | Passed with the final manifests and lockfile |
| Static validation | `pnpm check`, followed by `pnpm exec tsc --noEmit` after proof changes | Passed. Existing Astro OIDC deprecation hint remains |
| Native distribution | `pnpm build:packages`, then `node --import tsx tests/packages.proof.ts` | Passed on Node 26.11.1, then the same external-consumer proof passed on Node 24.12.0 |
| Actual Chrome | `pnpm build`, then `node --import tsx tests/rest-cli.browser.proof.ts` | Passed on Node 26.11.1 with installed Chrome |
| Worker distribution | `pnpm build:workers` | All four Workers built after the Node build and browser proof |

No deployment, production account mutation, npm publication, push, or merge occurred. Existing release unit tests print simulated deployment messages through their test adapters.

## HTTP and interoperability

`tests/rest.test.ts` starts an actual REST-only HTTP listener with the real OAuth provider and migrated disposable database. It verifies complete commands, full and compact reads, history, publication, ZIP manifests and attachment bytes. It rejects mismatched route/body IDs, malformed and repeated query parameters, malformed JSON, unsupported methods and content types, wrong origin/host, and bounded oversized bodies. Exact root resource audiences remain compatible.

Two actual HTTP writers share a head and produce one success, one 409, and exactly two retained revisions. Independent REST and MCP publication requests share an expected version and produce one winner. REST-created state is read and changed through MCP. Response-loss tests destroy the actual HTTP socket after the store commits create, update, and publish. Exact retries recover their receipts without another revision or publication version. Changed arguments and response omissions produce `request_conflict`. Real outsider and limited-scope grants, plus actual central revocation, deny access before receipt replay.

`tests/cli-client.test.ts` uses actual CLI subprocesses for every command and persisted recovery. It verifies resource and owner binding, request ID traversal safety, exclusive output paths, parallel retention, attachment/custom metadata preservation, exact conflict retention, and a maximum ten-revision response. A root independent reviewer found a credential switch between identity and submission. Commit 45298c5 pins one lazily resolved token per invocation. Its real HTTP regression switches the SQLite profile from owner A to B after identity for create/retry and after read for edit. The retained command and result remain owned by A, and B's library stays empty.

## Native authentication and local coordination

`tests/cli-auth.test.ts` contains 15 real provider and subprocess cases. Native DCR registration, PKCE, nonce, EdDSA ID token signature, callback path/state/issuer, registration reuse, refresh rotation, and logout are exercised. SIGKILL after provider rotation leaves the durable uncertainty marker and releases the coordination lock. A second process requires login without sending the old refresh token. The suite also proves simultaneous refresh, logout during refresh, a late callback after logout, cancellation before and after callback, a bounded stalled token request, endpoint constraints, redirect refusal, and issuer changes.

Private credential state uses two SQLite files. `credentials.sqlite` commits the pre-refresh marker with synchronous FULL while `credentials-lock.sqlite` holds the process lock without secrets. Browser interaction holds no writer transaction. Login and logout advance the profile epoch. Node's experimental SQLite API stays confined to these CLI files and is documented in the CLI reference. The full credential suite passed on Node 24.12.0.

## Installed consumers and browser

`tests/packages.proof.ts` installs local tarballs in external temporary projects. Ordinary Node imports the compiled client and invokes real HTTP. A client-only dependency tree contains no database, server, CLI, or tsx package. Separate packed store and REST imports share `ArtifactError` and return an actual stale-command 409. TypeScript compiles client and server consumer examples, including the legacy workflow export. The installed `artifacts` executable creates an artifact without a TypeScript loader.

The Chrome proof starts the CLI as a subprocess, follows its printed native authorization URL, signs in through the actual account page, and accepts consent. Subsequent CLI commands use persisted credentials. The built Astro panel displays the CLI head and historical revision. Its downloaded historical ZIP exactly equals the CLI export. The protected publication shows the chosen revision. A panel form opened at publication version 1 returns 409 after the CLI publishes version 2. Actual central revocation then denies CLI reads and retries and sends the panel back to account login. Screenshots are `.test-artifacts/rest-cli-panel.png` and `.test-artifacts/rest-cli-publication.png`.

The independent skill evaluator can use `pnpm dev:rest-cli:fixture` after a Node panel build. This process serves disposable auth, combined REST/MCP, panel, and publication. It prints a private manifest path. The token in that file refreshes once a minute, so consumers read the manifest before a new batch. The fixture copies the Node panel output and removes its database and credential manifest on shutdown. No normal account credentials are used.

Root owns final skill validation, independent reviews, integrated existing-browser regression, and PR preparation. Those are separate evidence gates and are not claimed by this implementation report.
