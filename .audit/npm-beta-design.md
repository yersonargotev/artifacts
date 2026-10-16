# Public npm beta design

## Problem

The CLI already compiles to an ordinary Node executable, but local tarballs hardcode private package names and versions. Public distribution must preserve the runtime graph, workspace consumers, authentication, and retained operations. Only CLI, client, and contracts are authorized for public MIT distribution.

## Usage

```sh
npm install --global @yargote/artifacts-cli@0.1.0-beta.1
artifacts --version
artifacts login --server https://artifacts-mcp.yersonargotev.workers.dev/mcp
```

```ts
import { createArtifactHttpClient } from '@yargote/artifacts-client';
const client = createArtifactHttpClient({ resource, accessToken });
const identity = await client.identity();
```

These are the target release commands. Publication and authenticated first use remain separate evidence gates.

## Shape

The source manifests own package identity, version, dependencies, exports, and public metadata. A small package catalog owns paths and publication eligibility. The existing compiler remains the sole producer of the seven local packages. It emits an inventory of exact tarballs, contents, and hashes. Proofs and publication consume that inventory.

The three source packages use `@yargote/artifacts-{cli,client,contracts}` and `0.1.0-beta.1`. All workspace imports migrate together. Source manifests remain private to prevent accidental source publication. Only three staged manifests permit public publication. Other stages remain private. Public dependency versions are exact and derive from source manifests. The CLI bin remains `artifacts`.

The release command hides tarball validation, dependency ordering, beta-only publication, partial retry checks, and integrity comparison. Callers select an operation, not arbitrary packages or tags. A separate verifier installs the immutable registry graph in empty environments. Native OAuth and artifact operations run through the actual installed executable.

## Synthesis decision

Two independent inherited-model design agents compared source renaming and staging-only name translation. Both chose source renaming. An independent inherited-model cross-judge preferred candidate B because source manifests own versions. Candidate A contributed per-dependency registry integrity checks and before/after `latest` comparison. No model diversity is claimed.

Candidate B scored 5/5 for identity, build reuse, publication boundaries, and runtime proof, and 4/5 for publication retry safety before the graft. Candidate A scored 5/5 except build reuse at 4/5. The catalog uses `packages/rest`, correcting an illustrative path in candidate A.

## Tradeoffs accepted

- A coordinated source rename changes more files but avoids a permanent translation of JavaScript imports and declarations.
- Private source manifests require intentional staging, which prevents accidental publication of TypeScript sources.
- The private repository cannot supply npm provenance under current npm rules. Publication explicitly disables provenance.
- The first publication may require interactive authentication before trusted publishing can be configured for the new packages.

## Alternatives considered

Staging-only name mapping creates two package identities and requires permanent translation across executable code, declarations, manifests, and documentation. A bundled CLI introduces a second build shape while the client and contracts still need publication. Direct source publication exposes TypeScript entry points. All three alternatives add maintenance without a demonstrated consumer benefit.

## Risks and gates

Registry 404 responses do not establish scope ownership. Anonymous REST challenges do not establish successful authentication. Clean registry installs, authenticated operations, exact tarball inspection, and independent release review are required evidence. Platform claims must match actual runs. Windows is unverified. Homebrew is outside scope.

## Next implementation step

Rename source packages and callers, derive tarball metadata from the package catalog, and preserve the existing package-consumer proof.
