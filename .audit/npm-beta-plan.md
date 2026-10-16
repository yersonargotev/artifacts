# Public npm beta workflow

## Todo

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame.
- [x] Phase B: Design the workflow.
- [ ] Phase C: Run the loop.
- [ ] Phase D: Keep the audit trail.
- [ ] Phase E: Verify and hand back.

## Definition of done

The private monorepo produces exactly three intentionally public MIT packages under `@yargote`. A prerelease is published under `beta`, with no `latest` promotion. Empty npm and pnpm environments resolve dependencies from the registry, support global installs and ephemeral execution, and complete authenticated artifact operations against an explicitly supported REST endpoint.

## Designed phases

1. Ground package boundaries, current endpoint behavior, official registry rules, and available authentication.
2. Compare two release designs and obtain an independent design judgment.
3. Implement package metadata, deterministic staging, exact-content verification, beta-only publication automation, and clean-environment verification.
4. Verify workspace consumers, existing CLI behavior, installed executable, and authenticated operations. Inspect exact tarball contents and hashes.
5. Obtain independent release review and resolve findings.
6. Publish contracts, client, then CLI using the inspected tarballs. Read registry metadata and compare integrity.
7. Run clean registry installations and authenticated first use. Record exact versions, commands, results, and any remaining blockers.

## Throughput checkpoint

- Blocking first steps. Ground the package graph, endpoint, registry identity, and release design before implementation.
- Independent workstreams. Read-only package and endpoint investigations run in parallel. Design candidates write separate temporary files.
- Shared mutable state. A single implementation owner changes packaging and its callers. Publication runs in dependency order from one inspected artifact set.
- Smallest safe decomposition. One packaging owner prevents drift among manifests, staging, and proofs. A separate reviewer owns the release verdict.

## Execution status

- [x] Ground current package graph, official documentation, registry availability, and deployed endpoint.
- [x] Compare two designs and accept an independent design judgment.
- [x] Implement packaging, beta release automation, installation docs, and clean-registry verifier.
- [x] Verify workspace consumers, exact tarballs, installed CLI native OAuth, and authenticated artifact operations against disposable and deployed services.
- [x] Resolve independent review findings and obtain a passing follow-up verdict.
- [ ] Authenticate to npm, establish scope authority, and publish the inspected versions under beta.
- [ ] Verify four clean registry modes, dependency integrity, and authenticated registry first use.

## Rigor and boundaries

Registry publication is irreversible, so exact tarball inspection, runtime checks, and an independent review are required gates. The user explicitly authorized publication once these gates pass. Homebrew and repository visibility changes are outside scope. npm authentication is currently absent. Name availability does not establish scope ownership.

The local host has no configured pstack model preferences, control-cli skill, or deslop skill. Implementation and initial design/release reviews inherit the host model. The final trail and fix review uses the available `gpt-5.6-sol` model. Different model-family coverage is unavailable and is not claimed. Direct installed-command execution supplies CLI evidence.
