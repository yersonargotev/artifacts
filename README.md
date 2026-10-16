# Artifacts

Create an artifact from Claude Code, Codex, the standalone CLI, or direct HTTP, retain every revision in Turso, and open its published revision at a stable authenticated URL. The Astro panel lists artifacts, displays revision history, previews selected revisions, and exports their original bytes.

`main` is the canonical branch and GitHub default. It contains the complete deployed implementation. Create short-lived feature branches from `main`, integrate completed work there, and remove those branches after integration. Worker deployments use the explicit commands in [deployment instructions](docs/deployment.md).

## Deployed services

| Service | URL |
| --- | --- |
| Panel | https://artifacts-panel.yersonargotev.workers.dev |
| MCP | https://artifacts-mcp.yersonargotev.workers.dev/mcp |
| Authorization | https://artifacts-auth.yersonargotev.workers.dev |
| Publication | https://artifacts-view.yersonargotev.workers.dev |

The publication Worker is separate from the panel. It receives no database or authoring credentials. Every document and attachment request checks the live central session and artifact owner through the authenticated internal service. Anonymous document requests redirect to login; anonymous attachments return 401. Revoked access returns 403. Backend failures return 503 without content.

## Connect a client

Register the deployed HTTP MCP and complete its OAuth browser login. Existing local registrations can remain under another name.

```sh
codex mcp add artifacts-cloud --url https://artifacts-mcp.yersonargotev.workers.dev/mcp
codex mcp login artifacts-cloud --scopes openid,profile,offline_access,artifacts:read,artifacts:write,artifacts:publish

claude mcp add --scope user --transport http artifacts-cloud https://artifacts-mcp.yersonargotev.workers.dev/mcp
claude mcp login artifacts-cloud
```

The Artifacts account authenticates the MCP connection. Each CLI also needs its own working model-provider login.

## Use the standalone CLI or REST client

The CLI uses REST under `${MCP_URL}/v1`. The complete `MCP_URL` remains its OAuth resource. MCP and REST share the artifact store and bearer policy. The deployed protected-resource metadata and REST routes were probed during beta preparation. Authenticated first-use evidence is recorded separately in the [release report](.audit/npm-beta-verification.md).

Use Node 24 or later. The public beta uses three MIT packages under `@yargote`; the application repository remains private. Install the CLI and its dependencies from npm:

```sh
npm install --global @yargote/artifacts-cli@0.1.0-beta.1
artifacts --version
export ARTIFACTS_SERVER='https://artifacts-mcp.yersonargotev.workers.dev/mcp'
artifacts login
artifacts whoami
```

Version `0.1.0-beta.1` is published under `beta` for all three packages. Clean registry installations and authenticated deployed operations passed in the [release report](.audit/npm-beta-verification.md). The [CLI installation and first-use guide](apps/cli/README.md) includes pnpm global, pinned `npx`, pinned `pnpm dlx`, artifact creation, and recovery. `@beta` follows prereleases. `latest` points to npm's empty `0.0.0-stage` reservation. Use an exact version or `@beta`.

The CLI has no implicit hosted default. Select the exact resource for your deployment. Local services also include REST. `pnpm dev:rest` is a REST-only listener and does not start MCP. It reads explicit environment variables. The [REST reference](packages/rest/README.md) lists configuration, direct HTTP examples, and errors.

The [CLI reference](apps/cli/README.md) documents every command, private credentials, exact retries, and export. The independent [artifacts-cli skill](skills/artifacts-cli/SKILL.md) can be copied as a complete directory into `~/.agents/skills`. It has no hosted default and does not require an MCP connection.

Library consumers install `@yargote/artifacts-client@0.1.0-beta.1` and, when needed directly, `@yargote/artifacts-contracts@0.1.0-beta.1`. The [client reference](packages/client/README.md) shows typed Fetch calls. Client-only installation has no database dependency. `pnpm build:packages` still produces the seven-package local distribution for workspace and server consumers. Its generated `dist/packages/manifest.json` identifies exact tarballs. Only CLI, client, and contracts are public. The [contracts reference](packages/contracts/README.md) describes the preserved exports. The [npm release guide](docs/npm-release.md) describes inspection, publication, and registry verification.

## Install the Artifacts skill

The canonical skill is [skills/artifacts](skills/artifacts/SKILL.md). It includes
the MCP contract, HTML authoring guidance, and Codex connection metadata. Update
these files with the service contract. The skills under `.agents/skills` support
development of this repository.

Review any existing local edits before replacing an installed copy. For a
personal Codex installation, copy the complete directory from this checkout:

```sh
mkdir -p ~/.agents/skills
cp -R skills/artifacts ~/.agents/skills/
```

Installed copies are not the source for future changes.

The skill defaults to the hosted `artifacts-cloud` connection listed above.
Installing the skill does not register the MCP server or complete OAuth login.
Complete [Connect a client](#connect-a-client) before using it. To use another
deployment, register its MCP endpoint under a distinct connection name and name
that connection in your request. The bundled Codex dependency metadata describes
the default hosted connection.

Distribution through
[packy-catalog](https://github.com/yersonargotev/packy-catalog) is pending. Packy
requires a publicly accessible upstream commit, and this application repository
is private. Keep the canonical source here and use the personal installation
above until a verifiable distribution source is available.

## Call the MCP tools

Ask a client to call `artifacts_create` with a complete snapshot and a unique `requestId`. The snapshot contains:

```json
{
  "metadata": { "title": "Example", "description": "My first artifact" },
  "content": { "kind": "html", "text": "<h1>Hello</h1>" },
  "files": []
}
```

Use `artifacts_read`, `artifacts_list`, and `artifacts_history` to retrieve artifacts. `artifacts_update` saves a complete snapshot with `expectedRevisionId`. `artifacts_publish` selects a retained `revisionId` with `expectedPublicationVersion`, using zero for the first publication. Its returned URL stays unchanged when you publish another revision. `artifacts_export` returns a deterministic ZIP for an explicit retained revision. `whoami` still returns the canonical account and session.

Matching mutation retries use the same `requestId` and arguments. Changed arguments under that ID fail. Concurrent updates and publication changes reject stale expected versions. [The store contract](packages/artifacts/README.md) describes the schemas, limits, pagination, permissions, and archive format.

Snapshots support self-contained HTML, Markdown, and text, plus downloadable attachments. The initial limit is 1 MiB decoded total and 32 files per revision. Relative executable assets and multi-file websites are outside this increment. Markdown and text display as inert text.

Interactive HTML runs in an opaque sandbox with no parent access, cookies, storage, forms, popups, or top navigation. Chrome 152 and newer receives the enforced connection allowlist; current acceptance uses Chrome 154. Other browsers receive escaped HTML source with scripts disabled. This compatibility fallback preserves authentication, downloads, and export. [Chrome's documentation](https://developer.chrome.com/blog/connection-allowlist-announcement) explains why CSP alone does not cover WebRTC and all navigation channels.

## Run locally

Use Node 24 or newer and pnpm 12.8.1.

```sh
pnpm install --frozen-lockfile
pnpm configure
pnpm db:migrate
pnpm identity:bootstrap
pnpm dev
```

`configure` creates an ignored mode-0600 `.env` and preserves an existing file. Read the owner credentials in your editor. Bootstrap preserves existing identities and configured client secrets.

Local hosts are authorization `http://localhost:4100`, MCP `http://127.0.0.1:4101/mcp`, panel `http://127.0.0.1:4321`, and publication `http://[::1]:4102`. Keep these distinct cookie hosts. `pnpm dev` supervises all four services. Each also has a `dev:<service>` command; use `dev:dashboard` for the panel.

This workspace's existing account has been migrated to Turso. A fresh clone configured with `pnpm configure` starts with a local database. For a remote database, set `DATABASE_URL` and `DATABASE_AUTH_TOKEN` in the private environment file.

Panel logout closes only the panel session. **Cerrar todas las sesiones** opens the authorization app's confirmation form and revokes browser and CLI access together.

## Migrate an existing identity

Stop source writers and back up the source database and environment file. Apply the same committed schema to source and target, then run:

```sh
pnpm identity:migrate --source-env .env --target-env .env.turso
```

The migration uses a consistent source snapshot and one destination transaction. It preserves all application tables and typed values, checks exact rows and foreign keys, rejects incompatible or conflicting target state, and can replay before destination writers start. It does not change either environment file. Change the database configuration only after verification.

Preserve `BETTER_AUTH_SECRET` with the copied signing keys. Public issuer or callback changes require fresh confidential clients and fresh CLI OAuth, using the same canonical owner. The bootstrap supports an explicitly selected private file:

```sh
ARTIFACTS_ENV_FILE=.env.deploy pnpm identity:bootstrap
```

## Verify

```sh
pnpm check
pnpm test
pnpm test:browser
pnpm test:rest-cli:browser
pnpm test:packages
pnpm build:workers
```

The tests use disposable identities and databases. `test:rest-cli` exercises real REST and CLI subprocesses. `test:rest-cli:browser` proves native login, retained revisions, panel publication conflicts, historical ZIP equality, and revocation in Chrome. `test:packages` compiles and installs tarballs into temporary external consumers. Run Node panel and Worker builds sequentially. `dev:rest-cli:fixture` starts a disposable combined service, authorization server, publication viewer, and a copy of the built Node panel. It prints the path to a private connection manifest for independent CLI checks and removes that temporary state on shutdown. Run `pnpm build` before starting the fixture. `test:browser` builds the Node panel and runs actual Chrome proofs for identity, artifact publication, revision history, historical ZIP bytes, anonymous and revoked access, native forms, sandbox isolation, HTTP and UDP containment, and mobile layout. It never revokes the normal account.

The live acceptance runners retain private ignored evidence and require authenticated CLI registrations. The browser runner also requires the selected deployment origins and owner credentials. They create a real artifact and retain its revisions.

```sh
node --env-file=.env.deploy --import tsx scripts/verify-artifact-clients.ts create
node --env-file=.env.deploy --import tsx scripts/verify-deployed-artifact.ts first
node --env-file=.env.deploy --import tsx scripts/verify-artifact-clients.ts modify
node --env-file=.env.deploy --import tsx scripts/verify-deployed-artifact.ts final
```

Use a fresh `ARTIFACTS_PROOF_RUN` and `ARTIFACTS_PROOF_DIR` for another end-to-end acceptance run. The final browser proof checks the stable URL, both revisions, exact panel/CLI archive equality, anonymous denial, and revocation of a separate test browser session while preserving the original client session.

See [deployment instructions](docs/deployment.md), [artifact architecture](docs/decisions/artifacts.md), [execution evidence](.audit/artifact-e2e/runtime.md), and the independent [domain review](.audit/artifact-e2e/review.md) and [publication review](.audit/artifact-e2e/publication-review.md).

## Review and publish a saved revision

Open an artifact in the panel to see the selected, latest, and published revisions. The list identifies unpublished changes. Each selected revision has an attachment inventory and an escaped comparison of content, metadata, and changed files. History navigation keeps the selected revision and comparison.

Choose **Publicar revisión** to publish the revision you reviewed. The form pins its revision, observed publication version, and request ID. A conflict requires another deliberate review. An uncertain result offers the same command for retry. The resulting page independently reads the publication and reports a concurrent replacement. Publication still requires the owner's Artifacts login.

For client edits, use the [prepared editing helper](packages/artifacts/README.md#prepare-and-retry-an-edit) to preserve fields and attachment bytes you did not change. MCP responses remain complete by default. Optional compact responses and summarized history omit content and attachment payloads. A full read or export still verifies the retained bytes.

To verify an existing saved revision in its actual panel and optional protected publication, use an independently fetched full `artifacts_read`, a preauthenticated private browser state, and declarative content expectations:

```sh
pnpm verify:retained-artifact --config /absolute/private/verification.json --storage-state /absolute/private/browser-state.json
```

The [retained verification recipe](.agents/skills/verify-artifacts/features/retained.md) defines the config and evidence. The verifier checks the actual sandbox, exact preview response and ZIP, publication identity, attachment bytes, interactions, console errors, and mobile overflow. It does not create or publish artifacts or revoke sessions. Current deployments without identity markers use exact legacy evidence. Partial markers fail.

`pnpm test:browser` includes the retained verifier's browser contracts and a real local Astro proof. `pnpm test:retained-browser` runs that subset. Unit tests do not require Chrome. Deployed verification remains separate from local feature proof.
