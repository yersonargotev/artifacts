# npm beta verification

Published version is `0.1.0-beta.1` for `@yargote/artifacts-contracts`, `@yargote/artifacts-client`, and `@yargote/artifacts-cli`. The command remains `artifacts`.

## Current verdict

PASS. All three inspected packages are published and downloadable at `0.1.0-beta.1` under `beta`. Four clean registry execution modes, registry dependency integrity, and authenticated first use against deployed REST passed. The committed [publication evidence](npm-beta-published.json) records exact versions, URLs, hashes, tags, platform, package managers, and all ten first-use checks. The registry processing and first-package tagging behavior required corrections described below.

## Baseline and endpoint

- The repository is private according to `gh repo view --json nameWithOwner,isPrivate,url`.
- Node `24.19.0`, npm `11.17.0`, and pnpm `12.8.1` are installed on this macOS host.
- All 30 existing REST and CLI tests passed before changes. Local evidence is `.test-artifacts/npm-beta/baseline.log`.
- Live deployed protected-resource metadata and issuer discovery returned 200. REST identity and list returned the expected unauthenticated 401. Local evidence is `.test-artifacts/npm-beta/endpoint.json`.
- All three candidate package names initially returned 404 from npm.
- After user login, `npm whoami --registry=https://registry.npmjs.org` returned `yargote`, matching the package scope. Successful publication established write authority for all three packages.

## Gates

| Gate | Result |
| --- | --- |
| Existing behavior baseline | PASS, 30 tests |
| Deployed anonymous REST and OAuth discovery | PASS |
| Coordinated package build and workspace consumers | PASS, typecheck, 89 tests, seven-package external proof |
| Exact public tarball contents and hashes | PASS, 11 contracts files, 5 client files, 11 CLI files |
| Authenticated first use of installed tarball CLI | PASS against deployed service with Chrome 155.0.8059.84 |
| Independent release review | PASS. Workflow retry collision and missing explicit latest-versus-beta rejection fixed and independently rechecked. |
| Registry ownership and publication | PASS, all three exact versions downloadable and verified |
| npm global install from registry | PASS |
| pnpm global install from registry | PASS |
| npx execution from registry | PASS |
| pnpm dlx execution from registry | PASS |
| Registry dependency resolution and integrity | PASS |
| Authenticated first use of registry CLI | PASS |

## Authenticated deployed evidence

The final installed local-tarball CLI completed native browser consent, persisted `whoami`, create, list, read, update, edit, three-revision history, historical publication, exact replay of four retained mutation commands, deterministic ZIP export with SHA-256, protected publication rendering, confirmed own-profile logout, and rejected `whoami` after logout. Evidence is `.test-artifacts/npm-beta/first-use-final-tarballs.json`. This run followed the final metadata rebuild. `.test-artifacts/npm-beta/final-local-install.json` binds that installed consumer to the final inventory and integrity values.

The final local-tarball verification artifact is `dfb8026f-8525-40d0-a51d-c6d1c15e9b4b`. Its [protected publication](https://artifacts-view.yersonargotev.workers.dev/a/dfb8026f-8525-40d0-a51d-c6d1c15e9b4b) displayed the original revision while the draft head remained revision 3. Export SHA-256 is `d78da90ed00d3b340e6232b07a5336cbbe1703d92ad09e2d4b24383024ba959d`. This proves deployed first use from the inspected local distribution. It does not replace registry-installed first use. The earlier pre-metadata run also passed and retained artifact `ef3c182d-0f52-4c0f-92ee-4974876b575d`.

The initial browser attempt failed before sending credentials because the system Chrome executable was absent. Playwright's Chrome installer required sudo. The run instead downloaded official Chrome for Testing 155.0.8059.84 into ignored local evidence and used the verifier's explicit browser-executable option. No system installation or administrator access was required.

`tests/cli-first-use.proof.ts` also passed against the real disposable application with an external installation of the three public tarballs. It runs the same native login and artifact operation verifier. Evidence is `.test-artifacts/npm-beta/first-use-fixture.json`. CI runs this installed-package proof before publication.

The final metadata rebuild passed `pnpm test:packages`; its log is `.test-artifacts/npm-beta/packages.log`. Earlier full-suite logs prove the unchanged runtime source, and are not presented as runs after the metadata-only edit. The final fixture proof and deployed first-use run both followed that rebuild. npm's own `publish --dry-run` accepted all three final tarballs with public access and beta tagging. Evidence is `.test-artifacts/npm-beta/publish-dry-run.json`; this did not publish or establish ownership.

Exact-content evidence is `.test-artifacts/npm-beta/inspected-tarballs.json`. The scanner found no credential patterns in the three package contents. Only compiled JavaScript, declarations, manifests, READMEs, and package MIT licenses appear. Release checks also verify executable mode, bin, export paths, dependency edges, metadata, and exact license bytes.

## Policy limits

MIT applies only to the three distributed packages. The repository remains private. npm provenance is unavailable from a private repository under the current [trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/#automatic-provenance-generation). Publication explicitly uses `beta`, since [npm publish defaults to latest](https://docs.npmjs.com/cli/v11/commands/npm-publish/#tag).

The two design agents and design judge inherited the parent model. Their reviews were independent. The final fix and trail reviewer uses `gpt-5.6-sol`; different model-family coverage is unavailable and is not claimed. The host has no installed `control-cli` or `deslop` skill. Direct installed-command execution and explicit diff review provide the available equivalents.

## Research assumptions checked

The three-package runtime graph, compiled ESM packaging, `artifacts` bin, Node 24 baseline, and external state paths match current source and installed runtime checks. The historical claim that REST was undeployed is contradicted by live HTTP and authenticated first use. The old public-package default is not relied upon. The publisher supplies `--access public` and `--tag beta` explicitly under the current [npm publish reference](https://docs.npmjs.com/cli/v11/commands/npm-publish/). [npm exec](https://docs.npmjs.com/cli/v11/commands/npm-exec/) and [pnpm dlx](https://pnpm.io/cli/pnx) remain registry execution modes, and both passed separate clean-install checks. No registry success is inferred from their documentation.

The packages expose the verified public maintainer profile as homepage and support entry. The repository URL remains the actual private source repository. No public issue tracker or public GitHub release asset is promised.

## Registry behavior observed during first publication

The contracts publish command explicitly supplied `--tag beta` and returned success with npm's processing notice. Immediate metadata readback returned 404, so the publisher stopped before sending either dependent. npm's [publish-time scanning announcement](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/) confirms that successful submission can precede installability. The publisher now records accepted submissions and waits up to 20 minutes for exact metadata and downloadable bytes. Independent review passed the availability correction and its deterministic regressions.

While metadata was unavailable, npm's dist-tags endpoint already returned both `beta` and `latest` pointing to `0.1.0-beta.1`. Removing `latest` failed with HTTP 400 twice after successful interactive authentication. A diagnostic invocation captured the same generic rejection body. The [npm CLI issue](https://github.com/npm/cli/issues/8490) records matching first-publish behavior.

The registry had created an empty `0.0.0-stage` reservation containing only package.json and README. Its manifest has `stub: true`. That reservation is described by [npm staged publishing](https://docs.npmjs.com/staged-publishing/). After inspection and user-completed authentication, `npm dist-tag add @yargote/artifacts-contracts@0.0.0-stage latest` succeeded. Final registry reads verify these tags for all three packages: `beta: 0.1.0-beta.1` and `latest: 0.0.0-stage`. No stable executable version was created. The beta briefly received npm's automatic initial latest tag before correction; this is reported explicitly rather than presented as unchanged tags.

Evidence is `.test-artifacts/npm-beta/registry-processing.json`, `.test-artifacts/npm-beta/contracts-bootstrap.json`, and `.test-artifacts/npm-beta/contracts-verified.json`. Independent review passed the automated bootstrap correction, typecheck, and release regression proof before dependent publication. The source package tarballs remain unchanged.

## Registry-installed consumer evidence

All three publication commands succeeded. Each downloaded tarball matched the approved SHA-512 inventory in [npm-beta-tarballs.json](npm-beta-tarballs.json). No package bytes changed during registry recovery. Registry-resolved client and contracts dependencies use the same exact beta version.

| Published package | Version | beta | latest |
| --- | --- | --- | --- |
| [@yargote/artifacts-cli](https://www.npmjs.com/package/@yargote/artifacts-cli/v/0.1.0-beta.1) | 0.1.0-beta.1 | 0.1.0-beta.1 | 0.0.0-stage |
| [@yargote/artifacts-client](https://www.npmjs.com/package/@yargote/artifacts-client/v/0.1.0-beta.1) | 0.1.0-beta.1 | 0.1.0-beta.1 | 0.0.0-stage |
| [@yargote/artifacts-contracts](https://www.npmjs.com/package/@yargote/artifacts-contracts/v/0.1.0-beta.1) | 0.1.0-beta.1 | 0.1.0-beta.1 | 0.0.0-stage |

`pnpm verify:npm --report .test-artifacts/npm-beta/registry.json --keep` passed on macOS arm64 with Node 24.19.0, npm 11.17.0, and pnpm 12.11.2. The external empty environment selected pnpm 12.11.2, while repository development uses its pinned 12.8.1. Each mode had separate empty home, config, cache, store, prefix, and working directory. Every mode returned `0.1.0-beta.1` and the CLI help. No registry credentials, release-age exceptions, workspace links, or local tarballs were supplied. The consumer lockfile resolved every dependency through `https://registry.npmjs.org/` with SHA-512 integrity. JavaScript imports and a strict TypeScript consumer also passed.

The first verifier run passed npm global installation, then failed because its PATH lacked pnpm's current `PNPM_HOME/bin`. Evidence is `.test-artifacts/npm-beta/registry-pnpm-path-failure.json`. The verifier now includes `PNPM_HOME/bin` and asks `pnpm bin --global` for the executable path. The complete rerun used fresh environments and passed all four modes. This changed the proof harness only; the published packages were unchanged.

The npm-global registry binary then passed the native browser and deployed artifact verifier. Evidence is `.test-artifacts/npm-beta/first-use-registry.json`, with portable fields committed in [npm-beta-published.json](npm-beta-published.json). Its retained artifact is `5e33f7cd-b046-47eb-84f0-90c2158479ae`. Its [protected publication](https://artifacts-view.yersonargotev.workers.dev/a/5e33f7cd-b046-47eb-84f0-90c2158479ae) displayed original revision `501e95f3-415b-4735-8079-6d1a02cd95ca` while the draft head remained revision 3. Deterministic historical export SHA-256 is `e5cd7dbec563591f5410bddc799c6eb417036068fa9960935d7163b835592490`. All ten checks passed, including four exact retained mutation replays and confirmed logout of only the proof profile. Both generated registry consumer workspaces were removed after the independent review. Raw report paths identify the installations at test time and no longer refer to retained binaries.

Working commands require Node 24 or newer. Choose one installation or execution mode:

```sh
npm install --global @yargote/artifacts-cli@0.1.0-beta.1
pnpm add --global @yargote/artifacts-cli@0.1.0-beta.1
npx --yes @yargote/artifacts-cli@0.1.0-beta.1 --version
pnpm dlx @yargote/artifacts-cli@0.1.0-beta.1 --version
```

For global installation, `artifacts --version` returns `0.1.0-beta.1`. If pnpm has no configured global bin directory, run `pnpm setup` and reopen the shell. For deployed first use:

```sh
export ARTIFACTS_SERVER='https://artifacts-mcp.yersonargotev.workers.dev/mcp'
artifacts login
artifacts whoami
```

## Remaining operational limits

There is no unresolved blocker to this published beta. The manual GitHub workflow is implemented but was not run for this local first publication. Protected environment reviewers and per-package trusted publisher configuration still require activation before OIDC releases. No OIDC or provenance success is claimed. macOS registry installation and authentication were verified. Linux checks are prepared in the workflow but have not run. Windows remains unverified. The source changes are on [PR 12](https://github.com/yersonargotev/artifacts/pull/12), without merging or deploying services. Homebrew is outside scope.

The [final independent review](npm-beta-final-review.md) confirmed live registry bytes and actual proof results. Its two mechanical trail findings are resolved by the final evidence commit and append-only successful-rerun entry. Review with a different model family was unavailable. The reported independent reviewer is `gpt-5.6-sol`.
