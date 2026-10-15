# REST, client, CLI, and package boundary review

Reviewed `/tmp/artifacts-rest-cli-implementation` against base `8314dfd`. The implementation HEAD was `dd67734668eca265828e28e81dfc68a669fde951`, with additional uncommitted distribution and verification files. This review uses the accepted `implementation-contract.md` and `docs/decisions/rest-cli.md`.

Throughput checkpoint is n/a for a read-only investigation.

## Finding

### P1. Bind owner verification and mutation submission to the same token

Source is `apps/cli/src/index.ts:132-137`. Retry repeats the problem at `apps/cli/src/index.ts:193-196`. The HTTP client resolves the token supplier once per HTTP call at `packages/client/src/index.ts:115`.

The CLI constructs a client whose token supplier rereads the mutable credential profile. It verifies owner A with `identity()`, retains a command for A, then obtains credentials again when submitting. A concurrent login can install owner B between those calls. A create then succeeds under B even though the retained operation belongs to A. Retry has the same gap after checking the retained owner. An account switch can therefore send a retained create under a different owner rather than retrieve its original receipt.

This is reproduced, not inferred. The temporary `/tmp/artifacts-owner-race-proof.mts` starts the real disposable REST/OAuth fixture, grants tokens to two owners, seeds a private CLI credential profile for A, and spawns the actual CLI create command. Its HTTP fixture switches the profile to B after processing `/identity` and before returning that response. No implementation or build output is changed.

The command was `node --import tsx /tmp/artifacts-owner-race-proof.mts`. The CLI exited with code 0. The operation file contained owner A, while the returned persisted artifact contained owner B. The proof asserts those exact identities differ. Observed output was:

```json
{"verifiedOwner":"a3K7PpcRTXx4RO4RsKCGEyZfwvrUK2AA","retainedOwner":"a3K7PpcRTXx4RO4RsKCGEyZfwvrUK2AA","actualCreatedOwner":"XmXm3m79q3ktawNSftSCn09OGPhNva91","exitCode":0,"switched":true}
```

The smallest fix is to resolve the invocation's access token once, construct a client using that fixed token, and use it for identity verification and mutation or retry submission. Convenience edit preparation must use that same client. The retained command should remain unchanged. A new regression should exercise the real CLI account switch at the identity/submission boundary and assert that the retained owner equals the actual mutation owner. The owner is implementing this fix. This report does not claim the fix has passed review.

## Verified behavior and scope

### Root verification of the correction

Commit `45298c5` memoizes the access-token promise for the entire CLI invocation. Root inspected the change and its real CLI/REST regression. The regression changes the selected profile after identity for create and retry, and after preparation read for edit. All operations remain under the verified owner and the other owner's library remains empty. Root ran `tests/cli-auth.test.ts` and `tests/cli-client.test.ts` with the absolute Node `v24.12.0` binary after this correction. All 23 tests passed, including this regression. Output is in `cli-node24-root.log`. The P1 finding is resolved.

`node --import tsx --test tests/rest.test.ts tests/cli-client.test.ts` passed all 14 tests during this review. These tests use real HTTP and CLI subprocesses. They cover complete snapshots and attachments, full/compact/summary projections, omitted versus explicit `response`, exact lost-response replay, original receipts after state changes, conflict details, concurrent head/publication writers, owner isolation, scope checks, central-session revocation, malformed HTTP, redirect refusal, response bounds, archive digest validation, operation-file exclusivity, and separate resource namespaces.

No additional material finding was found in the inspected contracts extraction, REST dispatch, shared bearer authorizer, HTTP client, operation-file handling, or package staging code. The original store remains the sole artifact transaction owner. Compatibility re-exports preserve the canonical schemas, error identity, workflow helpers, and serialization. REST projections happen after complete store receipts return. Export decodes the existing archive rather than rebuilding it.

Distribution source and existing staged ESM/declarations were inspected. The package proof includes a plain Node external consumer, an installed binary without `tsx`, a database-free client dependency graph, and a real packed store/REST conflict with shared `ArtifactError` identity. That proof was inspected but not rerun, and the staging output was not rebuilt. Its current execution remains a separate verification gate, not a code finding.

CLI authentication and credential internals were outside this review. Only the exported token supplier behavior needed to reproduce the owner-binding race was inspected. Browser, panel, publication, full-suite, and Worker gates were not rerun. No implementation files, lockfiles, build outputs, external messages, deployments, or Memory state were modified.

## Comment audit and principles

The scoped source and tests contain no standalone code comments, TypeScript suppressions, or ESLint suppressions. The independent direct audit therefore has zero MUST KILL, zero RESHAPE, and zero KEEP findings. No deletions, restorations, reruns, architecture sketches, encoding offers, or application-code edits were made.

Boundary Discipline focused the review on transport validation and preserved store ownership. Make Operations Idempotent focused it on exact commands, retained receipts, and the owner identity spanning a retry. Prove It Works changed the account-switch concern into a deterministic real CLI/HTTP reproduction. Their leaf skills were read in this session, alongside the requested poteto-mode and no-comments skills.
