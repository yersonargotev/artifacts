# Deploy native Workers

## Deploy checked local bundles

Build the services from the repository root.

```sh
pnpm build:workers
pnpm deploy:worker auth --dry-run
pnpm deploy:worker mcp --dry-run
pnpm deploy:worker panel --dry-run
pnpm deploy:worker view --dry-run
```

`build:workers` accepts individual service names. It writes portable Cloudflare Build Output v0 directories under `dist/workers/<service>`. The panel uses the Astro Cloudflare adapter for this build. `pnpm build` retains the local Node adapter.

Create separate private JSON or dotenv secret files for each Worker. Include only the secrets declared by that service's `cloudflare.config.ts`. The viewer declares only `PUBLICATION_SERVICE_SECRET` and `PUBLICATION_COOKIE_SECRET`. It receives no database or authoring credentials. Keep both publication secrets at least 32 characters long.

Bootstrap the confidential clients against the selected private deployment environment before creating the service secret files.

```sh
ARTIFACTS_ENV_FILE=.env.deploy pnpm identity:bootstrap
```

The deployment environment must contain the public origins from `scripts/cloudflare.ts`. Bootstrap preserves the owner and existing configured clients. New confidential client credentials append to `.env.deploy` with mode 0600.

Deploy each checked bundle with its own secret file.

```sh
pnpm deploy:worker auth --secrets-file /absolute/private/auth.env
pnpm deploy:worker mcp --secrets-file /absolute/private/mcp.env
pnpm deploy:worker panel --secrets-file /absolute/private/panel.env
pnpm deploy:worker view --secrets-file /absolute/private/view.env
```

All services use distinct `workers.dev` hostnames. The configurations explicitly enable runtime `process.env` bindings through `nodejs_compat_populate_process_env`. The panel uses those bindings for its existing runtime and internal publication service checks. Auth and MCP also receive typed environment objects at their Worker entrypoints.

The authorization Worker's CIMD transport approves only the exact Codex and Claude metadata document URLs in `apps/auth/src/metadata-worker.ts`. It never follows redirects or fetches unapproved JWKS locations. The local Node service retains the pinned DNS transport. Codex metadata returned 403 in the earlier local workerd probe. Both actual deployed CLI OAuth flows subsequently succeeded through the exact vendor transport; Claude created and published a revision and Codex updated, published, read history, and exported its original revision. The local probe result did not establish production reachability. [Execution evidence](../.audit/artifact-e2e/runtime.md) records the final observed gates.

## Configure GitHub production releases

1. [Create a Cloudflare API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) for the production account. Grant `Account Workers Scripts Edit` and `Account Account Settings Read`. The account read permission supports release preflight. These Workers use `workers.dev` hostnames and require no zone routing permission.
2. Create the GitHub environment `production`. Restrict its deployment branches to `main` with a custom branch policy. The workflow separately requires a push to `main` and three successful validation jobs.
3. Add the environment variable `CLOUDFLARE_ACCOUNT_ID` with the intended account ID.
4. Add the environment secret `CLOUDFLARE_API_TOKEN`. [GitHub's environment secret instructions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions#creating-secrets-for-an-environment) cover the UI and CLI. The CLI prompts for the value without placing it in a command argument.

```sh
gh secret set --env production CLOUDFLARE_API_TOKEN
```

5. Prepare a private JSON object with the complete runtime binding union defined in the [CI/CD runtime secret contract](ci-cd.md#runtime-secret-contract). Use the existing production values and confidential clients. Do not pass owner credentials to CI.
6. Add that object as the environment secret `ARTIFACTS_RUNTIME_SECRETS`. Keep the input file outside the repository.

```sh
gh secret set --env production ARTIFACTS_RUNTIME_SECRETS < /absolute/private/runtime.json
```

7. Merge the checked changes into `main`. Production downloads that run's checked Worker artifact, preflights all services, deploys them in order, and performs read-only HTTP smoke checks.

The [CI/CD release contract](ci-cd.md) describes artifact integrity, current-main skips, retries, partial-release behavior, and manual database operations. Manual workflow dispatch runs validation without deploying production.
