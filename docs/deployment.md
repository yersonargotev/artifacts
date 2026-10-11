# Deploy native Workers

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
