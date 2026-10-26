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

## Enable Resend delivery

The production configurations select Resend for sign-in codes and invitations. Auth, MCP, and panel require `EMAIL_FROM` and `RESEND_API_KEY`. Auth alone also requires `OWNER_EMAIL`. The viewer receives no email bindings. Cloudflare account credentials remain separate deployment inputs.

Before deploying the S10 code and this provider replacement, apply the reviewed `0004_sweet_the_anarchist.sql` migration to the intended database. It adds an owner budget with no recipient or artifact data. CI does not run migrations. Deploy in the order auth, MCP, view, panel.

Configure the sender in your Resend account with this procedure:

1. Select the Free plan in the intended account and check its current restrictions on [Resend pricing](https://resend.com/pricing). The advertised allowance is 3,000 emails per month and 100 per day. Sign-in codes and invitations share that account allowance. Artifacts' application limits do not guarantee provider capacity. HTTP 429 can indicate a daily, monthly, or rate limit.
2. Add a sending subdomain under `sparkydevs.com` in the Resend dashboard. `mail.sparkydevs.com` is a proposed example, not a configured or verified hostname. Use the exact subdomain you choose in the account. Resend [recommends sending subdomains](https://resend.com/docs/dashboard/domains/introduction) to isolate sending reputation.
3. Copy the exact record names, types, priorities, and values that Resend gives your account into the authoritative DNS service. Preserve the existing SpaceMail MX records and SPF record at the root `sparkydevs.com`. Keep receiving disabled in Resend. Add the account-provided verification and sending records at their specified subdomain names. If a proposed record conflicts with SpaceMail, resolve the name or subdomain choice before changing DNS. Do not copy example DKIM keys or invent SPF values.
4. Inspect each account-provided record with `dig` using its exact name and type. Compare the full response with the Resend dashboard. Ask Resend to verify the sending domain and retain the DNS responses and verified dashboard state as operator evidence. No DNS values or verified domain state are supplied by this repository.
5. Create a [Resend API key](https://resend.com/docs/dashboard/api-keys/introduction) with sending permission. Restrict the key to the verified sending domain where available. Save it in your secret manager when Resend displays it, because the dashboard shows the secret only at creation.
6. Choose a bare sender address on that verified subdomain for `EMAIL_FROM`. Do not use a display-name form. Set `RESEND_API_KEY` and `EMAIL_FROM` in the private runtime secret files for auth, MCP, and panel. Set `OWNER_EMAIL` only for auth. For GitHub releases, update the exact runtime binding union in `ARTIFACTS_RUNTIME_SECRETS` as described in the [CI/CD runtime secret contract](ci-cd.md#runtime-secret-contract). Remove the obsolete Cloudflare email token and the runtime copy of the Cloudflare account ID. Keep the separate deployment account ID and deployment API token.
7. After deployment is separately authorized, verify one sign-in code and one disposable invitation with controlled recipients. Record provider acceptance separately from inbox delivery. A successful API response does not establish delivery.

The sender makes one bounded request and does not retry provider failures. Resend quota rejection preserves the uniform sign-in response and the committed invitation receipt. Replaying a share receipt does not attempt another email. Account readiness, sender verification, DNS changes, deployment, and production delivery remain unverified by local tests. This provider follow-up does not change the historical S10 evidence.

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
