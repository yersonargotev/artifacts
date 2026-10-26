# Deploy native Workers

## Deploy checked local bundles

Build the services from the repository root.

```sh
pnpm build:workers
pnpm deploy:worker auth --dry-run
pnpm deploy:worker mcp --dry-run
pnpm deploy:worker view --dry-run
pnpm deploy:worker panel --dry-run
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
pnpm deploy:worker view --secrets-file /absolute/private/view.env
pnpm deploy:worker panel --secrets-file /absolute/private/panel.env
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

5. Prepare a private JSON object with the complete runtime binding union defined in the [CI/CD runtime secret contract](ci-cd.md#runtime-secret-contract). Use the existing production values and confidential clients. Do not pass an owner password or bootstrap credentials to CI. Auth alone receives the OWNER_EMAIL admission address.
6. Add that object as the environment secret `ARTIFACTS_RUNTIME_SECRETS`. Keep the input file outside the repository.

```sh
gh secret set --env production ARTIFACTS_RUNTIME_SECRETS < /absolute/private/runtime.json
```

7. Merge the checked changes into `main`. Production downloads that run's checked Worker artifact, preflights all services, deploys them in order, and performs read-only HTTP smoke checks.

The [CI/CD release contract](ci-cd.md) describes artifact integrity, current-main skips, retries, partial-release behavior, and manual database operations. Manual workflow dispatch runs validation without deploying production.

## Enable Cloudflare invitation delivery

The production configurations enable Cloudflare Email Sending for auth, MCP, and panel. Put `EMAIL_FROM`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_EMAIL_API_TOKEN` in each service's private secret file. Auth alone also requires `OWNER_EMAIL`. The viewer receives none of these bindings. Use an Email Sending token for the selected account. Do not substitute the deployment token.

Before deploying S10, apply the reviewed `0004_sweet_the_anarchist.sql` migration to the intended database. It adds an owner budget with no recipient or artifact data. CI does not run migrations. Deploy in the order auth, MCP, view, panel.

Onboard the sending domain through Cloudflare Email Service, Email Sending. Cloudflare manages Sending SPF on `cf-bounce` and DKIM on `cf-bounce._domainkey`. The DKIM public key must come from the selected account's domain settings. Email Routing uses different records. See [Cloudflare domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/).

Set `SENDING_DOMAIN` to the operator-selected domain, then inspect the actual records.

```sh
read -r SENDING_DOMAIN
dig +short TXT "cf-bounce.${SENDING_DOMAIN}"
dig +short TXT "cf-bounce._domainkey.${SENDING_DOMAIN}"
```

The Sending SPF value is `v=spf1 include:_spf.mx.cloudflare.net ~all`. Compare the complete DKIM TXT value with the account-specific value from Cloudflare, including its public key. Do not copy an example key. Record both DNS responses and the matching account settings before accepting the DNS gate. No account-specific domain or key is supplied by this repository.

## Verify a disposable deployed share

Production verification and DNS acceptance remain blocked until the operator deploys and supplies the two private browser states and domain records. Use a dedicated disposable publication and verified guest pair. The verifier refuses existing access and conditional creation prevents it from adopting a concurrent grant.

Create a private JSON configuration with `authOrigin`, `panelOrigin`, `publicationOrigin`, expected `ownerId`, distinct `guestId`, normalized `guestEmail`, `artifactId`, selected published `revisionId`, `sha256`, `publicationVersion`, `disposable: true`, and `evidenceDirectory`. Supply independently verified values. Both states must contain live central and panel sessions for those exact identities. Make the state files private with mode 0600.

```sh
node --import tsx scripts/verify-deployed-sharing.ts \
  --config /absolute/private/sharing.json \
  --owner-state /absolute/private/owner.json \
  --guest-state /absolute/private/guest.json
```

The script validates identities and publication markers before mutations. It captures one request and the exact returned share ID, opens the publication as the guest, revokes that ID, and requires 403 on the next request with the established viewer cookie. An uncertain creation retries the identical request. Cleanup never substitutes a share ID from a later listing. Evidence includes private creation receipts, `deployed.png`, `revoked.png`, and `result.json`. Do not publish browser states or raw authentication traces.

Invitations reserve one budget unit atomically with the share and its receipt. The bounded send attempt begins after commit. A crash before sending can lose the message; failures and crashes do not refund the budget. Exact request replay never sends again, and `requested` is not a delivery confirmation. A revoke after the final invitation lookup cannot retract a message that has already started.

## Local native database correction

The workspace keeps `@libsql/client` 0.18.0 unchanged and selects a prepared `libsql` 0.5.29 package through ordinary pnpm resolution. The pinned native source patch resets the original statement when an operation fails. It covers failed transaction controls and warmed failed reads without changing Config, encryption, persisted data, SQL execution, journal mode, or application retries.

Run `node scripts/prepare-native.mjs` before `pnpm install --frozen-lockfile`. The [native preparation guide](../native/libsql/README.md) lists the pinned inputs, tool requirements, target limits, and cache validation. Run `node --import tsx --test tests/libsql-control.test.ts tests/libsql-read.test.ts` for both strict native regressions. The earlier SDK transaction-control patch is obsolete and removed.

The portable package distribution retains its upstream registry graph and known native statement-retention limitation. The optional private native-fixed distribution carries the corrected host-specific graph. Active-transaction client close and replica runtime recovery remain outside the demonstrated correction.

Build the optional private server profile with `pnpm build:packages:native`. Its separate inventory is `dist/packages-native-fixed/manifest.json`. Install all required tarballs from that inventory together with `npm install --ignore-scripts`. Native tarball names identify the host target, and the DB package rejects a different OS or CPU. Linux output records its build-host glibc version and has no claim of compatibility with older untested libc versions. Use the portable profile when a fixed build for the deployment host is unavailable, with its inherited limitation explicitly retained.

`pnpm test:packages:native` builds both profiles, verifies the bundled dependency bytes, and installs them in external projects with scripts disabled. It exercises both SDK entrypoints, failed-read recovery through another process, encrypted-file compatibility in both directions, and the actual installed auth and REST invitation gates. The original portable graph is a negative recovery control, not a repaired profile. The native profile remains private, and `release:npm:check` and `release:npm:publish` reject its inventory before registry access.
