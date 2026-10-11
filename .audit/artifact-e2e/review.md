# Independent artifact review

This reviewer found three concrete defects. All three have verified corrections in the current implementation. A separate reviewer then reported WebRTC STUN traffic from sandboxed content. That finding remains open pending a supported browser restriction and independent verification. Production deployment and actual Claude and Codex acceptance remain separate gates.

The initial review covered `d54a5f4..3495070` and the uncommitted CLI verification runner. Follow-up review covered `d8df019`, `994d454`, `cd16905`, `f607f6e`, and the local publication startup correction. This reviewer changed only this report. Tests used temporary databases, synthetic credentials, temporary executable stubs, and fresh Chrome profiles. No personal environment file, database, CLI configuration, Cloudflare resource, or remote migration was accessed or changed.

## Corrected findings

### Preview code could send retained text to another origin

The original panel iframe allowed scripts and used a preview CSP with `connect-src 'none'`. That policy denied fetches, but it did not deny navigation of the frame itself. A script read a literal private paragraph and assigned `location.href` to a collector URL containing that paragraph. A fresh Chrome browser sent `/collect?bytes=retained-private-bytes` to the collector. Opening the preview response directly also sent the text and navigated the top-level page.

The original implementation was in `apps/publication/src/document.ts:4`, `apps/dashboard/src/pages/artifacts/[artifactId].astro:20`, and `apps/dashboard/src/pages/artifacts/[artifactId]/preview.ts:7` at `3495070`. The publication wrapper already enforced `frame-src 'self'`. The same probe against that wrapper sent no request and produced a Chrome CSP violation.

The correction adds `frame-src 'self'` to the panel wrapper in `apps/dashboard/src/middleware.ts:27`. The preview route requires `Sec-Fetch-Dest: iframe` in `apps/dashboard/src/pages/artifacts/[artifactId]/preview.ts:9`. The first restriction denies external frame navigation. The second denies direct browser navigation to executable preview content. The production dashboard browser proof passed independently after both changes.

### The CLI runner passed deployment secrets to both subprocesses

The original `spawn` call inherited the entire parent environment. A temporary `claude` executable received synthetic `DATABASE_AUTH_TOKEN` and `PUBLICATION_SERVICE_SECRET` values and wrote them into the runner's stderr evidence file. The runner rejected the stub's missing tool calls, but the subprocess had already received both secrets.

`scripts/verify-artifact-clients.ts:60` now removes artifact service and database variables before either subprocess starts. The subprocess also starts in the private evidence directory at line 64. Five independent synthetic runs confirmed that both tested secret variables were absent. No actual CLI acceptance run occurred during this reproduction.

### The modification gate accepted the wrong publication and an invalid export

The original modification phase accepted a valid revision-two update together with a publication result for an unrelated artifact that still selected revision one. It accepted base64 encoding the literal text `not a zip`, with no history call. The runner exited successfully and printed `historicalExport: true`.

The correction requires a history result at `scripts/verify-artifact-clients.ts:105`, checks publication artifact and revision identity at lines 112 and 113, validates retained revisions at lines 119 through 122, and verifies the archive hash, ZIP members, original content, attachment bytes, and metadata at lines 123 through 134. Independent synthetic checks accepted complete valid evidence and rejected each of the wrong artifact ID, wrong revision ID, missing history, and invalid ZIP cases.

## Verified behavior

`node --import tsx --test tests/artifacts.test.ts tests/publication.test.ts tests/identity-migration.test.ts` passed 22 of 22 tests. These tests use migrated temporary SQLite databases and actual local OAuth and MCP requests. They cover immutable snapshots, revision membership, competing writers, publication CAS, receipt replay, ownership, operation scopes, deterministic ZIP bytes, one-use grants, expired and revoked sessions, callback binding, cookie tampering, outage denial, and identity copy rollback.

`node --import tsx --test tests/worker-metadata.test.ts` passed two of two tests. A separate synthetic transport probe also confirmed the exact Codex and Claude metadata URLs, manual redirect handling, rejection of seven unapproved URL variants before fetch, rejection of POST, and rejection of redirects.

`tests/artifact-browser.proof.ts` passed independently against the compiled production Node dashboard. The test ran from an isolated temporary directory with an environment containing only `PATH`. It verified the clean one-use handoff, encrypted viewer cookie, stable updated publication URL, exact historical export, revision-bound attachment denial, tested sandbox restrictions, HTTP collector and external navigation denial, direct preview denial, mobile overflow, anonymous denial, central revocation, and backend outage denial. This execution did not test STUN or establish denial of every network protocol.

The store's transaction boundaries at `packages/artifacts/src/index.ts:75`, update CAS at line 122, publication CAS at line 138, and grant consumption at line 204 match the verified behavior. The migration copies and verifies rows inside one destination transaction at `scripts/migrate-identity.ts:80`. It rejects schema differences and conflicting destination rows rather than discarding source data.

## Native Worker review

The native MCP entrypoint at `apps/mcp/src/worker.ts:9` obtains its database and authorization configuration from the typed Worker environment. Authorization initialization awaits `auth.$context` at `apps/auth/src/worker.ts:13`. The metadata transport approves exact vendor document URLs and denies redirects at `apps/auth/src/metadata-worker.ts:17`.

Read-only inspection of all four generated Worker manifests and bundle evidence found no `node:dns`, `node:https`, or native `libsql` package imports. The viewer manifest declares only its two public origins and the two publication secrets. It declares no database or authoring credentials. `scripts/build-workers.ts:64` rejects the specified incompatible dependencies, and `scripts/cloudflare.ts:3` explicitly enables runtime environment bindings for the panel.

This reviewer did not execute `cf`, deploy a Worker, or validate actual workerd requests. Build evidence establishes bundle composition only.

The local publication entrypoint at `apps/publication/src/server.ts:5` now loads its environment file and defaults to IPv6 loopback port 4102, matching the generated publication origin. An independent startup probe used a temporary environment file with synthetic secrets, a reserved loopback port, and an inherited environment containing only `PATH`. A document GET returned 303 to the configured panel publication admission route without stderr output. The shared publication configuration change in `f607f6e` preserves explicit origin and secret validation.

## Comments and review limits

The comment audit found no added application-code narration, stale workaround comments, lint suppressions, or TypeScript suppressions that require removal. Drizzle SQL statement delimiters remain because the migration reader uses them. The reviewer deleted no comments, restored no comments, and made no application edits. No constraint encoding offer or architecture change was necessary for this audit.

The review applied Test Behavior, Not Implementation by asserting collector traffic and runner exit behavior. It applied Prove It Works by executing the production dashboard browser proof after the preview correction.

The remaining root-owned evidence gates are a supported browser restriction for the separately reported STUN traffic, native workerd runtime validation, public vendor metadata reachability, deployed OAuth and MCP requests, actual Claude creation and publication, actual Codex modification and publication, and the signed-in and anonymous browser checks against the deployed stable URL. The remote identity migration reported by the root agent was not independently rerun here.
