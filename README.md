# Artifacts

Create an artifact from Claude Code or Codex, retain every revision in Turso, and open its published revision at a stable authenticated URL. The Astro panel lists artifacts, displays revision history, previews selected revisions, and exports their original bytes.

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
pnpm build:workers
```

The tests use disposable identities and databases. `test:browser` builds the Node panel and runs actual Chrome proofs for identity, artifact publication, revision history, historical ZIP bytes, anonymous and revoked access, native forms, sandbox isolation, HTTP and UDP containment, and mobile layout. It never revokes the normal account.

The live acceptance runners retain private ignored evidence and require authenticated CLI registrations. The browser runner also requires the selected deployment origins and owner credentials. They create a real artifact and retain its revisions.

```sh
node --env-file=.env.deploy --import tsx scripts/verify-artifact-clients.ts create
node --env-file=.env.deploy --import tsx scripts/verify-deployed-artifact.ts first
node --env-file=.env.deploy --import tsx scripts/verify-artifact-clients.ts modify
node --env-file=.env.deploy --import tsx scripts/verify-deployed-artifact.ts final
```

Use a fresh `ARTIFACTS_PROOF_RUN` and `ARTIFACTS_PROOF_DIR` for another end-to-end acceptance run. The final browser proof checks the stable URL, both revisions, exact panel/CLI archive equality, anonymous denial, and revocation of a separate test browser session while preserving the original client session.

See [deployment instructions](docs/deployment.md), [artifact architecture](docs/decisions/artifacts.md), [execution evidence](.audit/artifact-e2e/runtime.md), and the independent [domain review](.audit/artifact-e2e/review.md) and [publication review](.audit/artifact-e2e/publication-review.md).
