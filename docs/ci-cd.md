# CI and production release contract

`.github/workflows/ci-cd.yml` validates pull requests to `main`, pushes to `main`, and manual dispatches. Manual dispatch validates the selected revision. It never releases production.

## Validation jobs

Each job runs in its own Ubuntu 24.04 workspace with Node 24 and the package manager declared in `package.json`.

| Job | Commands and evidence |
| --- | --- |
| `checks` | Frozen dependency installation, `pnpm check`, and `pnpm test`. A newer validation can cancel stale checks for the same ref. |
| `browser` | Frozen installation, `playwright install --with-deps chrome`, and `pnpm test:browser`. The existing proofs require real Google Chrome, IPv6 loopback, and an active UDP control. |
| `workers` | Frozen installation, `pnpm build:workers`, and `deploy:worker --dry-run` for all four services without production credentials. |

The browser and Worker jobs use different workspaces because their Astro build targets replace the same panel output directory. Browser evidence includes only three fixture screenshots and `publication-network.json`. Uploads exclude authentication state, traces, databases, browser profiles, and downloaded artifacts.

The Worker artifact contains only `dist/workers/auth`, `mcp`, `panel`, and `view`. Uploads retain the hidden `.cloudflare` directories. Its name contains the source SHA, run ID, and run attempt. Production downloads the immutable artifact ID emitted by the successful `workers` job in the same run. Download v8 treats a digest mismatch as an error.

## Production eligibility

Production requires a push to `refs/heads/main` and successful `checks`, `browser`, and `workers` jobs. The `production` GitHub environment restricts deployments to `main`. See [Configure GitHub production releases](deployment.md#configure-github-production-releases) for setup.

The fixed `artifacts-production` concurrency group permits one running release. It does not cancel that release when a newer push arrives. GitHub can replace a pending run with a newer pending run, so the workflow does not promise to release every push. [GitHub concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) describes the pending-run behavior.

Production installs frozen dependencies without a package cache. Only the release step receives deployment credentials and runtime secrets. It does not rebuild the downloaded Workers.

## Runtime secret contract

| Production environment entry | Kind | Contract |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret | Cloudflare deployment authorization with access to the selected account. |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | The selected account's 32-character hexadecimal ID. |
| `ARTIFACTS_RUNTIME_SECRETS` | Secret | A JSON object containing exactly the union of declared runtime secret bindings. Every value is a nonempty string. |

The runtime bindings come from the [auth](../apps/auth/cloudflare.config.ts), [MCP](../apps/mcp/cloudflare.config.ts), [panel](../apps/dashboard/cloudflare.config.ts), and [viewer](../apps/publication/cloudflare.config.ts) configurations. The current union has nine keys. This command lists the declarations.

```sh
rg "type: 'secret'" apps/{auth,mcp,dashboard,publication}/cloudflare.config.ts
```

`scripts/release-production.ts` derives each service's allowlist from those configurations. It rejects missing bindings, extra keys, invalid value types, short application secrets, and a local database URL. It writes separate mode-0600 JSON files in a private runner temporary directory and removes that directory in `finally`.

The viewer receives only its declared publication secrets. It receives no database or authoring credentials. The complete runtime JSON and GitHub read token do not enter the deployment subprocess environment. The release command suppresses CLI output to keep secret values out of logs.

## Release behavior

The release command validates all inputs and all four downloaded configurations before creating temporary secret files. It checks token access through the read-only Cloudflare account-details API. The configured token grants `Account Settings Read` for this check. A successful read does not prove every deployment permission. [Cloudflare account-details documentation](https://developers.cloudflare.com/api/resources/accounts/methods/get/) lists accepted account permissions.

All four `deploy:worker --dry-run` commands must succeed before the first deployment. Dry runs validate the local bundles but do not validate Cloudflare API authorization. Immediately before deployment, the release command reads the current `main` SHA through GitHub. A superseded revision logs a successful skip and deploys no Workers.

The command deploys `auth`, `mcp`, `panel`, and `view` in that order through the existing `pnpm deploy:worker` command. Once deployment starts, it completes that quartet without checking `main` again. A newer eligible release waits for the running release to finish.

The four deployments are separate Cloudflare operations. A failure after an earlier service succeeds leaves a partial release. The command stops and reports the failed service. It does not roll back. A retry reruns preflight, all dry runs, and the quartet while the revision remains current `main`. An older revision skips after `main` advances. A failed current release can be retried through the original push run; manual dispatch remains validation-only.

`pnpm release:production --dry-run` validates the runtime JSON and checked bundles, creates projected secret files, and runs the four CLI dry runs. It makes no account-access request, requires no deployment token, and deploys nothing.

## Read-only production smoke

After all deployments, bounded HTTP probes check auth and MCP health, OIDC discovery at `/api/auth/.well-known/openid-configuration`, MCP discovery and anonymous denial, the anonymous panel and its CSS, and the viewer's stateless publication transaction. The panel currently inlines its CSS. The probe requires nonempty inline styles or a successful response for a referenced CSS asset. Anonymous requests must fail at the canonical revision attachment route, callback, and internal panel read route.

An authenticated internal panel read uses a random nonexistent user and session, matching artifact identifiers, and a future viewer expiry. The probe requires the exact database-backed 403 body `No se puede abrir este artefacto.`. The earlier service-authorization denial returns the distinct body `Access denied`. Each probe allows four attempts, a five-second request timeout, and a 1.5-second pause between failures.

The smoke performs no login, authoring, grant consumption, or production data mutation. The absent-session read proves session-table connectivity and fail-closed admission. It does not prove every table, schema version, or authenticated authoring flow. A smoke failure leaves the deployed quartet in place and fails the release job.

## Manual database operations

This change requires no database migration. Ordinary releases never run `db:migrate`, `identity:bootstrap`, or `identity:migrate`. Future production schema changes require a separately reviewed manual migration against the intended production database before deploying dependent code. The operator owns migration timing and compatibility with the currently deployed services. CI does not acknowledge or apply a production schema revision.
