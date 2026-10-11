# Artifacts identity

Run one personal account across an authorization server, a remote HTTP MCP server, and an Astro dashboard. This increment provides login, `whoami`, panel logout, and global revocation. It does not store or publish artifacts.

## Start locally

Use Node 24 or newer and pnpm 12.8.1. Run these commands from the repository root.

```sh
pnpm install --frozen-lockfile
pnpm configure
pnpm db:migrate
pnpm identity:bootstrap
pnpm dev
```

`configure` creates `.env` with random secrets and a local file database URL. It preserves an existing file. The file has mode `0600` and is ignored by Git. `identity:bootstrap` preserves the owner ID and existing client secrets when repeated.

Open `.env` in your local editor to read `OWNER_EMAIL` and `OWNER_PASSWORD`. Open [the dashboard](http://127.0.0.1:4321) and sign in. Keep the configured hostnames. Changing `127.0.0.1` to `localhost` changes cookie ownership.

Run each service independently when you need separate terminals.

```sh
pnpm dev:auth
pnpm dev:mcp
pnpm dev:dashboard
```

The authorization server listens at `http://localhost:4100`. The MCP resource is `http://127.0.0.1:4101/mcp`. Public signup is disabled.

## Connect a CLI

Add `http://127.0.0.1:4101/mcp` as a remote HTTP MCP server in Codex or Claude Code. Start its OAuth login and approve access. Request `artifacts:read` and `offline_access` when the CLI exposes a scope option. Call `whoami` to compare the user ID with the dashboard.

Panel logout closes only that browser session. **Cerrar todas las sesiones** opens the authorization app's confirmation form. Submit that form to revoke all browser and CLI access. A new login can authorize a new connection afterward.

## Verify the increment

```sh
pnpm check
pnpm build
pnpm test
pnpm test:browser
```

The integration suite uses disposable databases and actual HTTP requests. It checks PKCE, introspection, OAuth replay, refresh rotation, revocation, OIDC state, durable panel sessions, and callback races.

`test:browser` also starts the built dashboard against disposable auth and MCP servers. It uses an installed Google Chrome through Playwright. It checks real native forms, both logout paths, cookie deletion, and mobile overflow. It writes screenshots to ignored `.test-artifacts`. It does not change personal CLI configuration or revoke the normal local account.

## Configure separate hosts

Use `.env.example` as a configuration reference. For Turso, set `DATABASE_URL` to the libSQL URL and set `DATABASE_AUTH_TOKEN`. Run migrations once through `packages/db` before starting any service.

Set separate HTTPS public URLs for `AUTH_URL`, `MCP_URL`, and `DASHBOARD_URL`. `AUTH_URL` and `DASHBOARD_URL` must use different hostnames. Preserve the configured issuer and resource identifiers after issuing credentials. Register fresh confidential clients when their callback origin changes.

`AUTH_BIND_HOST`, `AUTH_PORT`, `MCP_BIND_HOST`, and `MCP_PORT` control internal listeners independently of the public URLs. The defaults bind loopback on ports 4100 and 4101. Configure the reverse proxy to forward the original host. Terminate HTTPS at the proxy. Each application requires only its own configuration and database access where applicable. The MCP server needs its introspection client ID and secret but no database credentials or owner password.

Build and start the dashboard separately with the environment already loaded.

```sh
pnpm build
node --env-file=.env apps/dashboard/dist/server/entry.mjs
```

The Astro Node adapter reads `HOST` and `PORT` for its listener. The workspace dependencies must remain installed beside the build. They preserve libSQL's native driver resolution.

The authorization and MCP entrypoints run with `pnpm dev:auth` and `pnpm dev:mcp` without a watcher. Their scripts load `.env`. Supply a protected environment file on the deployment host.

## Update the schema

Generate Better Auth's schema from the pinned plugin composition, review the result, then create a migration.

```sh
pnpm --filter @artifacts/auth exec auth generate --config ./schema.config.ts --adapter drizzle --dialect sqlite --output ../../packages/db/src/auth-schema.ts --yes
pnpm db:generate
pnpm db:migrate
```

Read [the identity decision](docs/decisions/identity.md) for ownership, availability, and the tracked Better Auth refresh-family race. Remote Turso and cloud deployment require separate verification.
