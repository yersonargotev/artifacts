# npm beta verification

Release target is `0.1.0-beta.1` for `@yargote/artifacts-contracts`, `@yargote/artifacts-client`, and `@yargote/artifacts-cli`. The command remains `artifacts`.

## Current verdict

PREPARATION VERIFIED, PUBLICATION PARTIALLY COMPLETE. npm accepted contracts `0.1.0-beta.1`. Client and CLI publication remain pending. The registry processing and first-package tagging behavior required corrections described below.

## Baseline and endpoint

- The repository is private according to `gh repo view --json nameWithOwner,isPrivate,url`.
- Node `24.19.0`, npm `11.17.0`, and pnpm `12.8.1` are installed on this macOS host.
- All 30 existing REST and CLI tests passed before changes. Local evidence is `.test-artifacts/npm-beta/baseline.log`.
- Live deployed protected-resource metadata and issuer discovery returned 200. REST identity and list returned the expected unauthenticated 401. Local evidence is `.test-artifacts/npm-beta/endpoint.json`.
- All three candidate package names initially returned 404 from npm.
- After user login, `npm whoami --registry=https://registry.npmjs.org` returned `yargote`, matching the package scope. Publication of contracts established write authority for that package.

## Gates

| Gate | Result |
| --- | --- |
| Existing behavior baseline | PASS, 30 tests |
| Deployed anonymous REST and OAuth discovery | PASS |
| Coordinated package build and workspace consumers | PASS, typecheck, 89 tests, seven-package external proof |
| Exact public tarball contents and hashes | PASS, 11 contracts files, 5 client files, 11 CLI files |
| Authenticated first use of installed tarball CLI | PASS against deployed service with Chrome 155.0.8059.84 |
| Independent release review | PASS. Workflow retry collision and missing explicit latest-versus-beta rejection fixed and independently rechecked. |
| Registry ownership and publication | Contracts accepted and available. Client and CLI pending. |
| npm global install from registry | Pending publication |
| pnpm global install from registry | Pending publication |
| npx execution from registry | Pending publication |
| pnpm dlx execution from registry | Pending publication |
| Registry dependency resolution and integrity | Pending publication |
| Authenticated first use of registry CLI | Pending publication |

## Authenticated deployed evidence

The final installed local-tarball CLI completed native browser consent, persisted `whoami`, create, list, read, update, edit, three-revision history, historical publication, exact replay of four retained mutation commands, deterministic ZIP export with SHA-256, protected publication rendering, confirmed own-profile logout, and rejected `whoami` after logout. Evidence is `.test-artifacts/npm-beta/first-use-final-tarballs.json`. This run followed the final metadata rebuild. `.test-artifacts/npm-beta/final-local-install.json` binds that installed consumer to the final inventory and integrity values.

The final retained verification artifact is `dfb8026f-8525-40d0-a51d-c6d1c15e9b4b`. Its [protected publication](https://artifacts-view.yersonargotev.workers.dev/a/dfb8026f-8525-40d0-a51d-c6d1c15e9b4b) displayed the original revision while the draft head remained revision 3. Export SHA-256 is `d78da90ed00d3b340e6232b07a5336cbbe1703d92ad09e2d4b24383024ba959d`. This proves deployed first use from the inspected local distribution. It does not replace registry-installed first use. The earlier pre-metadata run also passed and retained artifact `ef3c182d-0f52-4c0f-92ee-4974876b575d`.

The initial browser attempt failed before sending credentials because the system Chrome executable was absent. Playwright's Chrome installer required sudo. The run instead downloaded official Chrome for Testing 155.0.8059.84 into ignored local evidence and used the verifier's explicit browser-executable option. No system installation or administrator access was required.

`tests/cli-first-use.proof.ts` also passed against the real disposable application with an external installation of the three public tarballs. It runs the same native login and artifact operation verifier. Evidence is `.test-artifacts/npm-beta/first-use-fixture.json`. CI runs this installed-package proof before publication.

The final metadata rebuild passed `pnpm test:packages`; its log is `.test-artifacts/npm-beta/packages.log`. Earlier full-suite logs prove the unchanged runtime source, and are not presented as runs after the metadata-only edit. The final fixture proof and deployed first-use run both followed that rebuild. npm's own `publish --dry-run` accepted all three final tarballs with public access and beta tagging. Evidence is `.test-artifacts/npm-beta/publish-dry-run.json`; this did not publish or establish ownership.

Exact-content evidence is `.test-artifacts/npm-beta/inspected-tarballs.json`. The scanner found no credential patterns in the three package contents. Only compiled JavaScript, declarations, manifests, READMEs, and package MIT licenses appear. Release checks also verify executable mode, bin, export paths, dependency edges, metadata, and exact license bytes.

## Policy limits

MIT applies only to the three distributed packages. The repository remains private. npm provenance is unavailable from a private repository under the current [trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/#automatic-provenance-generation). Publication explicitly uses `beta`, since [npm publish defaults to latest](https://docs.npmjs.com/cli/v11/commands/npm-publish/#tag).

The two design agents and design judge inherited the parent model. Their reviews were independent. The final fix and trail reviewer uses `gpt-5.6-sol`; different model-family coverage is unavailable and is not claimed. The host has no installed `control-cli` or `deslop` skill. Direct installed-command execution and explicit diff review provide the available equivalents.

## Research assumptions checked

The three-package runtime graph, compiled ESM packaging, `artifacts` bin, Node 24 baseline, and external state paths match current source and installed runtime checks. The historical claim that REST was undeployed is contradicted by live HTTP and authenticated first use. The old public-package default is not relied upon. The publisher supplies `--access public` and `--tag beta` explicitly under the current [npm publish reference](https://docs.npmjs.com/cli/v11/commands/npm-publish/). [npm exec](https://docs.npmjs.com/cli/v11/commands/npm-exec/) and [pnpm dlx](https://pnpm.io/cli/pnx) remain registry execution modes, with separate clean-install checks prepared. No registry success is inferred from their documentation.

The packages expose the verified public maintainer profile as homepage and support entry. The repository URL remains the actual private source repository. No public issue tracker or public GitHub release asset is promised.

## Registry behavior observed during first publication

The contracts publish command explicitly supplied `--tag beta` and returned success with npm's processing notice. Immediate metadata readback returned 404, so the publisher stopped before sending either dependent. npm's [publish-time scanning announcement](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/) confirms that successful submission can precede installability. The publisher now records accepted submissions and waits up to 20 minutes for exact metadata and downloadable bytes. Independent review passed the availability correction and its deterministic regressions.

While metadata was unavailable, npm's dist-tags endpoint already returned both `beta` and `latest` pointing to `0.1.0-beta.1`. Removing `latest` failed with HTTP 400 twice after successful interactive authentication. A diagnostic invocation captured the same generic rejection body. The [npm CLI issue](https://github.com/npm/cli/issues/8490) records matching first-publish behavior.

The registry had created an empty `0.0.0-stage` reservation containing only package.json and README. Its manifest has `stub: true`. That reservation is described by [npm staged publishing](https://docs.npmjs.com/staged-publishing/). After inspection and user-completed authentication, `npm dist-tag add @yargote/artifacts-contracts@0.0.0-stage latest` succeeded. Current tags are `beta: 0.1.0-beta.1` and `latest: 0.0.0-stage`. No stable executable version was created. The beta briefly received npm's automatic initial latest tag before correction; this is reported explicitly rather than presented as unchanged tags.

Evidence is `.test-artifacts/npm-beta/registry-processing.json`, `.test-artifacts/npm-beta/contracts-bootstrap.json`, and `.test-artifacts/npm-beta/contracts-verified.json`. Independent review passed the automated bootstrap correction, typecheck, and release regression proof before dependent publication. The source package tarballs remain unchanged.
