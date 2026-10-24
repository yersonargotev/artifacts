# Release the public npm beta

This procedure publishes only `@yargote/artifacts-contracts`, `@yargote/artifacts-client`, and `@yargote/artifacts-cli`. Their exact versions match. The binary is `artifacts`. The repository and other packages remain private. MIT applies only to the three package directories and their distributed contents.

## Prepare a version

1. Set the three source manifest versions to an unused `X.Y.Z-beta.N` version. Keep their source `private: true` guards. Keep workspace dependencies as `workspace:*`.
2. Run the checks with Node 24 and the repository's pinned pnpm:

```sh
	pnpm install --frozen-lockfile
	pnpm check
	pnpm test
	pnpm test:packages
	pnpm exec playwright install chrome
	pnpm test:cli-first-use
	pnpm release:npm:check
```

The package build is the only tarball producer. `dist/packages/manifest.json` records names, versions, dependencies, exact contents, and integrity. The release check reads actual tarballs and refuses stable versions, private dependencies, unexpected files, and mismatched metadata. Inspect the three public inventories and package READMEs before publication. The four private local tarballs remain available for existing package proofs.

3. Install the three public tarballs in an empty external consumer. Run the first-use proof against its installed `artifacts` binary with a supported resource and an existing account:

```sh
	pnpm exec tsx scripts/verify-cli-first-use.ts \
	  --binary /absolute/consumer/node_modules/.bin/artifacts \
	  --server https://artifacts-mcp.yersonargotev.workers.dev/mcp \
	  --env-file /private/path/account.env \
	  --expected-version 0.1.0-beta.5 \
	  --report .test-artifacts/npm-beta/first-use-local.json
```

The explicitly selected environment file supplies `OWNER_EMAIL` and `OWNER_PASSWORD`. The proof uses an isolated Chrome context and temporary CLI state. It records safe evidence, creates a clearly named verification artifact, and retains it. It logs out only its own CLI profile. It does not revoke other sessions. Do not upload account files, tokens, raw browser state, or credential databases.

4. Obtain an independent release review of the diff, exact tarballs, license scope, behavior checks, and endpoint proof. Record its verdict with the release evidence. Publication requires passing gates. The first beta has explicit user authorization once those gates pass.

## Bootstrap npm access

The package names must be available and the authenticated npm account must own `@yargote` or have organization publication rights. An anonymous 404 is not proof of that authority.

```sh
	npm login --registry=https://registry.npmjs.org
	npm whoami --registry=https://registry.npmjs.org
```

Complete browser login and any npm 2FA challenge yourself. Never paste passwords, OTPs, or tokens into source files or release reports. For the first publication, the local command below uses the same inspected tarballs and release gates as CI. It does not require a repository visibility change.

## Publish the inspected beta

```sh
	pnpm release:npm:check
	pnpm release:npm:publish
```

The publisher uses contracts, client, then CLI order. It supplies public access, the `beta` tag, and disabled provenance. It verifies downloaded registry bytes before proceeding to the next dependency. A repeated invocation accepts an existing version only when its integrity matches the inspected tarball. A mismatch stops publication. Do not rebuild between inspection and publication.

npm scans new packages before making them installable. A successful `npm publish` can therefore precede public registry availability. The publisher records accepted submissions in `dist/packages/publication-state.json` and waits up to 20 minutes for each package's metadata and tarball. It does not resubmit an accepted package while waiting. If this deadline expires, retain the exact build directory and inspect npm's processing state before retrying. [npm's publication scanning announcement](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/) explains this availability delay.

The publisher checks `latest` before and after. Never tag the beta release as `latest`. There is no stable promotion in this workflow. The only first-publication correction allowed below targets npm's existing empty reservation.

The first public publish can receive both `beta` and `latest` from npm despite `--tag beta`. On this registry, removing `latest` returned HTTP 400. When npm has already created its empty `0.0.0-stage` reservation, the publisher can restore `latest` to that existing reservation after verifying the beta's bytes and the reservation's `stub` metadata. After a successful correction, it waits up to 60 seconds for reads to show the new tags without repeating the write. It never creates a reservation or points `latest` at the beta. Later releases preserve that pointer. Install the exact beta version or use `@beta`; bare installation does not select a supported stable release. The [npm CLI issue](https://github.com/npm/cli/issues/8490) records this first-publish tagging behavior, and [staged publishing documentation](https://docs.npmjs.com/staged-publishing/) describes the registry reservation.

If publication stops after one package, retain the exact build directory and rerun the same command after resolving the specific authentication or registry error. Do not change versions independently. A published version cannot be overwritten, even after unpublishing. If bytes are defective, publish a new coordinated beta and consider deprecating the defective version with a clear migration message.

## Configure subsequent trusted releases

1. Commit and review the release automation in the private repository.
2. Configure the `npm-beta` GitHub environment with required reviewers and branch restrictions. The environment name in the workflow alone does not configure protection.
3. For each of the three npm packages, configure a GitHub trusted publisher for owner `yersonargotev`, repository `artifacts`, workflow `npm-beta.yml`, and environment `npm-beta`. Explicitly permit direct `npm publish` and `npm dist-tag` under npm's current allowed-actions controls. The publication job uses npm CLI 11.21.0 on Node 24 because OIDC dist-tag operations require that version or later.
4. Dispatch **Public npm beta** with the exact version already committed in all three manifests. Review the uploaded tarballs before approving the protected publication job.

The workflow builds once, uploads that output, and publishes the downloaded artifacts without rebuilding. It does not deploy application services. The first publication can occur locally before trusted publishers are configured. npm's current trusted-publisher setup requires package settings and validates new configurations on first use. Complete that first use before the configuration expires.

The repository remains private, so npm provenance is disabled. [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) documents the supported identity flow, allowed actions, expiry, and private-repository provenance limitation. No workflow run or protection configuration is claimed merely because the YAML exists.

## Verify registry consumers

```sh
	pnpm verify:npm --report .test-artifacts/npm-beta/registry.json --keep
```

This check uses separate empty homes, npm caches, pnpm stores, global prefixes, and working directories outside the checkout. It verifies npm global installation, pnpm global installation, `npx`, and `pnpm dlx`, with the exact version and help output. It verifies registry dependency resolution and integrity. `--keep` retains the isolated installation and reports a binary path for authenticated first use. Remove that reported temporary directory after verification.

The isolated PATH includes both `PNPM_HOME` and `PNPM_HOME/bin`. The verifier asks `pnpm bin --global` for the executable directory. Current pnpm uses the `bin` subdirectory, as documented in [pnpm global packages](https://pnpm.io/global-packages).

Run `verify-cli-first-use.ts` again against the registry-installed binary. Builds and local tarballs do not replace this gate. Save the safe JSON results with exact versions, package-manager versions, platform, and tarball hashes. The workflow prepares macOS and Linux installation checks. Only a completed run establishes coverage. Windows is unverified.

[pnpm's documented security policies](https://pnpm.io/cli/pnx#security-and-trust-policies) can delay a fresh release. Record any rejection and follow the account or organization's policy. Do not claim that default installation passed after silently disabling that policy.

If registry credentials, ownership, or account authorization are missing, retain all prepared evidence and report the exact missing action. Do not mark the release complete until registry publication and authenticated registry first use pass.
