> Historical record, archived on 2026-10-26. Status, authorization, worktree paths, and next-step instructions below describe earlier checkpoints. Use [the current handoff](sharing-session-handoff.md) for the completed program and retained evidence. This archive is not an active execution plan.

## Shipping complete — 2026-10-26

The operator authorized deployment and then correct PR integration. PR38–49 are all squash-merged into `main` at `355b0f85ff3588ed77783cfa7fef255eaa823b8b`. Its full tree `5ba6d1e1602bc5b07ef56af7bd18c4e62d80ef71` exactly equals the deployed source `d1a82a6f987b692094b7717c2aa53ba97f332ecc`. The earlier no-merge and missing-runtime gates below are historical and superseded.

Final main CI [40265886353](https://github.com/yersonargotev/artifacts/actions/runs/40265886353) passed all three jobs; production was skipped by the workflow_dispatch condition. All twelve intermediate main-push workflows ended cancelled with no production steps. The original production branch policy ID `62737085` was restored to `main`; the complete environment metadata and branch-policy list match their pre-shipping snapshots. All four active Worker deployments remain unchanged, and the read-only production smoke passed. No additional deployment or email was needed.

The twelve merged remote branches and the temporary supplemental-CI branch were deleted atomically with exact leases. Local feature branches, worktrees, original refs under `refs/shipping/original/`, and evidence remain preserved. Local main was fast-forwarded; all four local plan files were backed up and restored. The three tracked plan files remain local modifications, and this session handoff remains untracked. The generated Darwin native package was copied into an owned local directory, verified with `prepare-native --check`, and dependencies installed with the frozen lockfile under Node24.

Each PR has an independent gpt-6.1-sol Shipping verdict. PR42, PR44, and PR45 passed; PR38–41, PR43, and PR46–49 passed with the explicit notes in their reports. PR38's original CI covered its original head; supplemental post-merge CI [40255360886](https://github.com/yersonargotev/artifacts/actions/runs/40255360886) separately passed on its integrated tree. The rejected initial PR39 simulation, later corrected before merge, remains recorded. The first full-stack watcher stopped on absent CI for upper PRs; per-frontier monitoring continued, and the final queued watcher reported COMPLETE.

Evidence is retained under `/tmp/artifacts-shipping`: `final-readback.json`, `policy-restoration.json`, `remote-cleanup.json`, `local-sync.json`, `production-smoke.json`, `production-versions-final.json`, and per-PR verdict/merge receipts. PR49’s actual final patch changes only its concurrency test (6 insertions and 6 deletions). Its PR title/body reflect that scope; the squash commit retained the earlier subject mentioning header integration, which had already landed through PR39/46. Public main history was preserved. The final independent trail audit by gpt-6-astra is PASS+NOTES with no operational blockers; see `/tmp/artifacts-shipping/trail-audit-final.md`. Its notes retain PR38’s supplemental post-merge CI, PR49’s historical subject, unavailable root-model-family/full-transcript proof, and the absence of a full content hash audit of unrelated worktrees. Earlier portable/native limitations and one-attempt email semantics remain unchanged. No S11 or S12 was added, and no package publication occurred.

# Sharing program session handoff

Latest state on 2026-10-25 is recorded in [Production deployment complete](#production-deployment-complete). The release at `d1a82a6` is deployed and its real controlled invitation proof passed. Earlier checkpoints below preserve history and do not override the latest deployment authority or evidence.

## Resume contract

The user approved S9 with the exact answer `Aprobar S9 y continuar con S10`. S9 approval is complete. The user then asked for this handoff to continue in another session. That handoff request did not approve S10 visuals. In the resumed session, after the actual video and four screenshots were presented, the user explicitly answered `¿Apruebas visualmente S10 o hay algo que quieras ajustar? si aprobado`. **S10 visual approval is complete** at unchanged head `12b84c567d51bc47244cf2ef5023c23e3ac30bc4`. The canonical decision trail records this later approval.

The current sharing plan defines S1 through S10, followed by program closure. It defines **no S11**. Finish the remaining S10 operator gates before proposing another phase. Do not invent an S11 scope.

Use neutral Spanish in conversation and English for code, documentation, identifiers and commits. The user invoked `poteto-mode`; read the installed `.agents/skills/poteto-mode/SKILL.md` and confirmed roles in `~/.pstack/codex-models.md` when applying that workflow. Do not restart the completed design, implementation, full review or measurements merely because this is a new session.

No merge, rebase, retarget, close, auto-merge, deployment, DNS change, customer email or package publication is authorized by this handoff. The operator owns landing and the named external gates. Preserve the frozen PR and its verified production patch.

## Current verdict

**S10 is technically verified and visually approved by the operator. It is not CLEAN overall.** Production verification, SPF/DKIM and complete deployed Worker runtime acceptance remain unmet.

| Item | Exact state |
| --- | --- |
| PR | [#47](https://github.com/yersonargotev/artifacts/pull/47), open and ready |
| Branch | `feat/sharing-s10-invitations` |
| Final head | `12b84c567d51bc47244cf2ef5023c23e3ac30bc4` |
| Parent | S9, `93e0aca1e42b270dcbe15794c008a828afd6323a` |
| Parent branch | `feat/sharing-s9-shared-with-me` |
| Verified production source | `0c89987f8c8abad8d2aa2a6fa0b3d613f1524b3e` |
| Final head delta | Exactly `sharing-plan.md`, `sharing-handoff.md` and `sharing-decisions.tsv` under `docs/plans`; product, native, lock, tests, packages and runtime behavior unchanged |
| Final CI | [40212023076, attempt 2](https://github.com/yersonargotev/artifacts/actions/runs/40212023076/attempts/2), terminal success at the exact final head |
| CI results | Chrome, Check and test, and Build Workers successful; Release production skipped |
| Working trees | Feature, independent review and exact S9 parent clean at final inspection |

The first final-head Chrome attempt reached its unchanged 20-minute deadline. Actual logs show APT downloading 22 MB in 308 seconds. After independent classification, root authorized exactly one Chrome-job retry on the same head, same budget and full test chain. It succeeded. The first timeout remains retained; it was not relabeled as a pass. Other successful same-head checks were retained, not falsely described as newly rerun jobs. No further retry is needed.

The earlier source-head CI [40209329855](https://github.com/yersonargotev/artifacts/actions/runs/40209329855) also passed. It was not substituted for final-head CI. Superseded initial run `40209083011` was canceled deliberately and is never counted as a pass.

## First actions in the next session

1. Read this file, `sharing-plan.md`, the current owner/reviewer reports and the final trail audit below. Refresh actual PR head/base/readiness and final CI status once. Compare against the exact hashes above before modifying anything.
2. Preserve the completed S10 visual approval. The operator explicitly approved the actual media below in the resumed session. Do not request the same approval again for unchanged visuals.
3. The explicit visual answer and media evidence are recorded in the canonical decision trail and local plan/handoff status. Visual approval alone does not complete production/DNS/runtime gates or authorize landing/deployment. Do not create another documentation-only commit just to copy every later audit row into PR47.
4. Production lane 9 requires operator deployment and explicit production origins, identities, a disposable artifact/publication revision and private owner/guest browser states. Use the documented `scripts/verify-deployed-sharing.ts` workflow only within new authorization. Prepare concrete inputs before requesting an operator action. Do not expose browser state contents or reuse deleted local test states as production credentials.
5. DNS lane 10 requires the operator's actual sender domain and SPF/DKIM records. Verify those real names after setup. Placeholders in documentation are not evidence of configured DNS.
6. Keep S10 BLOCKED overall until the required gates are evidenced. Only after closure should a new session establish whether a separately approved next phase exists. If there is no approved S11, report that rather than inventing one.

## Review media

These are actual same-run recordings and captures, technically inspected by root and the independent reviewer. The operator subsequently approved these exact media in the resumed session. The original technical receipts retain their historical approval-pending status.

- [Video, 32.88 seconds](/tmp/artifacts-sharing-codex/s10-integration-owner/media/S10-review.mp4).
- [Panel with notification requested](/tmp/artifacts-sharing-codex/s10-integration-owner/media/S10-review-panel-notify.png).
- [Guest code sign-in](/tmp/artifacts-sharing-codex/s10-integration-owner/media/S10-review-guest-signin.png).
- [Invitation email at 390 pixels](/tmp/artifacts-sharing-codex/s10-integration-owner/media/S10-review-email-390.png).
- [Invitation email at 1440 pixels](/tmp/artifacts-sharing-codex/s10-integration-owner/media/S10-review-email-1440.png).

The video is 1440 by 900, SHA-256 `8e6e8f9f00273de3826d539796cbb08fd984fbbc4f0dca49c0f6ab9c0453617e`. `media/receipt.json`, `inputs.json` and `run/` retain original-speed chronological source segments, the actual HTML, input/output hashes, clean source, SDK/native and Node panel build provenance. Production source `0c89987` is unchanged by final metadata head `12b84c5`. The older 32.84-second video is historical and must not be substituted.

## Completed technical work

- Committed checks and 261 unit tests pass. The fresh independent reviewer also passed the full final unit suite.
- All four guarded Worker bundles pass. Valid native and guarded dynamic file-import bundles are rejected after successful bundling. Complete native Worker startup/deployed behavior is a separate unmet dimension; unchanged S9 also failed the local full Miniflare startup control.
- Real built Node browser flows, REST/CLI, public CLI first-use, plain S9/head compatibility, invitation rendering, the actual verification skill launcher and the callable/CLI deployed-verifier local races pass.
- Independently installed private packages pass 16 native ESM/CJS controls, 14 real authenticated API cases, immutable receipts/no resend, ArtifactError identity and bidirectional encrypted-file compatibility. Exact Linux CI proves the installed graph on x64/glibc 2.39.
- Ten semantic mutations were killed between green controls and restored. One actually removed the Rust reset, rebuilt the native source and caused real API recovery to return 503 instead of the expected 201. Compiler/setup failures were excluded.
- The reviewer built and installed the actual exact-S9 CLI, caused a real committed response loss, retained its emitted operation file and replayed it with the current CLI. The strict five-field result and saved bytes were preserved. This is stronger than the earlier handwritten legacy-record test.
- Root countersigned the complementary API proof criteria and the narrow Worker path correction at `2026-10-25T16:12:27Z`, after independent evidence. No retry budget, journal mode, busy timeout, auth policy or production check was weakened.

Gate A completes real successful introspections before releasing a fixture barrier, then proves actual writer contention, both first responses 201, quota 100, two grants/receipts, one sink message and immutable replay. Gate B proves actual precommand auth SELECT failure/500/identity503 with zero effects, releases the holder and succeeds once with the identical request on the same live clients/processes. These do not guarantee zero transient authentication failures. Natural race statuses remain diagnostic.

Model the Domain selected separate access and notification results. Make Operations Idempotent preserved receipt-backed retries. Fix Root Causes selected native statement cleanup. Prove It Works required real installed/authenticated API behavior and semantic mutations. Explain the Number limited performance acceptance to the named local budgets.

## Native repair and delivery constraints

Keep the original SDK `@libsql/client` 0.18.0 bytes. The current fix is a pinned libsql-js 0.5.29 Rust statement-error reset, not the superseded SDK-control patch. Source commit is `55bee86d1c284f1ddf2b9e280e870d2b6cef884a`; patch SHA-256 is `312d235d904b0eed9906f1467ca2f5b88392a1f878c9c2b18c6efa70dc9f6d5b`. Read `native/libsql/README.md` and `/tmp/artifacts-sharing-codex/s10-native-integration.md` before any related change.

The normal workspace selects an owned generated package through `libsql: link:./.native/libsql`. A fresh tree requires `node scripts/prepare-native.mjs` before normal database use and `pnpm install --frozen-lockfile`. Preparation uses pinned Rust/Cargo 1.93.0, source/patch/archive hashes and owned CMake 3.31.6 tooling. An existing tree can validate with `pnpm prepare:native --check`. Missing native output fails closed. Never mutate shared installed hardlinks, add module hooks, force GC, reconnect around the defect, replay SQL for cleanup, restore the insufficient SDK-only patch or silently select upstream.

The default portable seven-package distribution is preserved and **still has its inherited native lifecycle defect**. The opt-in private native-fixed profile delivers the repair for its producer target with bundled SDK/Drizzle/runtime closure, ordinary npm installation and no consumer compiler/install script/fallback. The public CLI/client/contracts tarballs are byte-identical between profiles and remain the only public packages. The CLI credential store uses Node built-in SQLite, separately from this server-native graph.

Actual accepted targets are local Darwin arm64 and Linux x64 glibc 2.39. Older glibc, other targets, replica runtime, successful abandoned iterators and inherited active-transaction close behavior remain unverified or unchanged. No native publication service was authorized. Both alternative backends were rejected after real encryption/error/locking incompatibilities; do not reopen them without a new concrete requirement.

Invitations make one bounded postcommit attempt. `requested` is not delivery confirmation. A crash before the attempt can lose the message, and exact receipt replay never resends. New notification requests intentionally consume another daily reservation. Existing access remains listable/revocable beyond the growth caps.

## Performance evidence

No new benchmark is needed for resumption. The accepted run contains 150 distinct successful mutations: 50 S9 plain, 50 S10 plain and 50 S10 notify. Root and the reviewer independently reconciled every response with its actual receipt/current grant, all 50 message projections/hashes and budget 50. Cleanup is recorded.

| Local p95 | Milliseconds |
| --- | ---: |
| S9 plain | 5.133125 |
| S10 plain | 4.443459 |
| S10 notify | 5.133042 |

Original budgets pass. Plain fails only above both 10 percent and 3 ms over S9; notify fails above the local 300 ms threshold. This is not a speedup or production-latency claim. Five blocks are not five independent benchmark repetitions.

The first counted pass numerically passed but retained only aggregate state counts, so it remains incomplete acceptance evidence. It is preserved unchanged. Root authorized one corrected measured run after inspecting an outside-interval projection-only delta, with no workload/timer/budget/source change. Do not cherry-pick the first numbers or repeat until faster. The excluded profile observed native row work, not an exclusive bottleneck or cause of p95 outliers.

Accepted raw file is `/tmp/artifacts-sharing-codex/s10-integration-owner/performance-measured-state.json`, SHA-256 `0bc3dd6279531c40654e1e133129981b56c383eb4f9b18b76d601ac0f93c8bd1`. Root recomputation is `s10-perf-root-recompute.json`; independent audit is `s10-review-evidence/performance-audit.json` and its rerunnable `audit-performance.mjs` under the same scratch root.

## Files and local environment

| Purpose | Location |
| --- | --- |
| Main checkout | `/Users/argote/Documents/dev/artifacts` |
| Feature tree | `/tmp/artifacts-sharing-codex/s10-worktree` |
| Clean exact S9 parent | `/tmp/artifacts-sharing-codex/s10-parent` |
| Independent review tree | `/tmp/artifacts-sharing-codex/s10-review-worktree` |
| Owner report | `/tmp/artifacts-sharing-codex/s10-integration-owner-report.md` |
| Independent source review | `/tmp/artifacts-sharing-codex/s10-review-report.md` |
| Final trail audit | `/tmp/artifacts-sharing-codex/s10-trail-audit.md` |
| Root accessible-run reconstruction | `/tmp/artifacts-sharing-codex/s10-root-run.md` |
| Final CI terminal receipt | `/tmp/artifacts-sharing-codex/s10-ci-handoff-status.json` |
| Actual successful Chrome retry log | `/tmp/artifacts-sharing-codex/s10-ci-12b-chrome-attempt2.log` |
| Attempt 1 timeout/log/annotations | `/tmp/artifacts-sharing-codex/s10-ci-12b-attempt1.json`, `s10-ci-12b-chrome-attempt1.log`, `s10-ci-12b-chrome-attempt1-annotations.json` |
| Retained attempt 1 artifact | `/tmp/artifacts-sharing-codex/s10-integration-owner/ci-final-attempt-1-artifact-12606666692.zip` |

Use explicit Node 24 for local accepted commands:

```sh
export PATH=/Users/argote/.local/share/fnm/node-versions/v24.12.0/installation/bin:$PATH
```

Canonical main documents are `docs/plans/sharing-plan.md`, `sharing-handoff.md` and append-only `sharing-decisions.tsv`. They were deliberately kept local/untracked in the main checkout. PR47 contains their frozen pre-handoff snapshots. This new handoff and later root audit rows are local additions, not another PR commit. Do not indiscriminately add unrelated `.claude/worktrees/` or create recursive documentation-only commits that restart CI.

Detailed media, source archives and proofs remain under `/tmp`. A remote session or another machine will not receive them merely by fetching the PR; retain or deliberately transfer them before relying on their paths. Disposable services/databases/sinks/browser states were cleaned up; retained evidence was not deleted. No background monitoring is promised after this session.

## Stack

| Step | PR | Verdict at handoff |
| --- | --- | --- |
| S1 | [#38](https://github.com/yersonargotev/artifacts/pull/38) | Verified; base main |
| S2 | [#39](https://github.com/yersonargotev/artifacts/pull/39) | Verified; base S1 |
| S3 | [#40](https://github.com/yersonargotev/artifacts/pull/40) | Verified; base S2 |
| S4 | [#41](https://github.com/yersonargotev/artifacts/pull/41) | Verified; base S3 |
| S5 | [#42](https://github.com/yersonargotev/artifacts/pull/42) | Verified; base S4 |
| S6 | [#43](https://github.com/yersonargotev/artifacts/pull/43) | Verified; repeat auth-error verification when updating authentication dependencies |
| S7 | [#44](https://github.com/yersonargotev/artifacts/pull/44) | Verified and operator approved |
| S8 | [#45](https://github.com/yersonargotev/artifacts/pull/45) | Verified and operator approved |
| S9 | [#46](https://github.com/yersonargotev/artifacts/pull/46) | Verified and explicitly operator approved |
| S10 | [#47](https://github.com/yersonargotev/artifacts/pull/47) | Technically verified and visually approved at final head; runtime/production/DNS gates unmet |

At final inspection remote main was `9896e9e2b6d13bfe6ae20829df6082aca983211d`. It had moved after S1 branched. Do not rebase or land during resumption. The operator still owns landing; any authorized future landing must assess the current base and follow the stack shipping procedure.

## Next-session starter

```text
Read docs/plans/sharing-session-handoff.md and the canonical plan before acting.
Continue from the Resend provider follow-up PR48 at7ad05da, based on frozen PR47 at12b84c5.
S10 exact-head CI and visual approval are recorded. PR48 local checks and independent review are complete; its remote CI is not claimed complete.
Do not repeat finished work or alter the frozen PR unnecessarily.
Prepare Resend sender verification and runtime secret inputs using PR48 docs/deployment.md. Preserve SpaceMail reception. Do not request S10 visual approval again.
Production/DNS/runtime remain operator-gated. Do not infer deployment/merge permission.
The existing plan defines no S11; establish any next phase explicitly after S10 closure.
```

## Attention

reviewed by gpt-6-astra

The final artifact-based trail audit found no new material contradiction or demonstrated product defect. It preserves the portable/native target limitations, external/runtime gates, one-attempt email semantics, limited performance claim, retained timeout/retry and local evidence requirements described above. The complete raw transcript and root model identity were unavailable; a verified different-model-family relationship to root cannot be claimed. The independent source reviewer was configured gpt-6.1-sol. The user's later explicit S10 visual approval is recorded in the resume contract and canonical decision trail. This historical audit itself did not supply that approval.

## Resend follow-up ready for review

The operator selected Resend and authorized the required code changes with `poteto-mode` on 2026-10-25. The follow-up branch is `feat/sharing-resend`, created from frozen S10 head `12b84c567d51bc47244cf2ef5023c23e3ac30bc4`, in `/tmp/artifacts-resend/worktree`. PR47 remains unchanged. This is an authorized provider replacement, not a newly invented S11.

The replacement covers codes, invitations, Worker bindings, release validation fixtures, and operator documentation. Cloudflare remains the hosting provider. SpaceMail remains the incoming email provider for `sparkydevs.com`. Exact Resend DNS records, API credentials, deployment, and real delivery remain unverified. The implementation must preserve the one-attempt invitation and immutable receipt rules.

Read `/tmp/artifacts-resend/plan.md`, `grounding.md`, and `provider-contract.md` for the active scope. The provider decision supersedes earlier instructions to configure Cloudflare Email Sending for the next release. Historical S10 evidence remains valid only for the provider and environment it tested.

The provider replacement is committed at `7ad05daaf6ee673577974f58515644794ccf7498` and published as ready PR [#48](https://github.com/yersonargotev/artifacts/pull/48), based on PR47. The worktree is clean. Local check, the 280-test suite, final 29 focused tests, three Chrome proofs, and all four Worker builds passed. See `/tmp/artifacts-resend/verification.md` and the independent `/tmp/artifacts-resend/review.md`. Remote CI is not claimed complete.

The next operational step is to verify the selected sending subdomain in Resend, store its sending key and sender address in the runtime secret union, and complete the existing migration/runtime/deployment gates under the operator's authority. `docs/deployment.md` on PR48 contains the procedure. No DNS, secrets, remote database, real email, merge, or deployment changed in this follow-up.

The independent provider trail audit by gpt-6-astra found no flags in the inspected evidence. See `/tmp/artifacts-resend/trail-audit.md` for its transcript and model-identity limits.

## Resend runtime secret prepared

After the operator added `RESEND_API_KEY` and `EMAIL_FROM` to the local `.env.deploy`, the root validated all 12 runtime bindings through PR48 `projectRuntimeSecrets` and confirmed the local public origins match the production declarations. The complete declared runtime union was uploaded to GitHub environment `production` as `ARTIFACTS_RUNTIME_SECRETS`. GitHub accepted the update and its metadata timestamp advanced to `2026-10-25T18:29:11Z`. The temporary JSON was removed. No values were printed. Evidence is `/tmp/artifacts-resend/runtime-secret-receipt.json`.

This supersedes the missing-runtime-secret preparation gate above. It does not compare local values with the previous opaque GitHub secret or validate remote credentials. No deployment, migration, DNS change or email send ran. The updated union targets PR48 and must be used with that reviewed code. Domain verification, runtime/deployment and real delivery gates remain open.

## Authorized production deployment in progress

The operator subsequently authorized deployment with "Ok, despliega y demas." The operator supplied a controlled guest address for one real invitation and code sign-in proof. This supersedes earlier instructions to wait for deployment permission. Stack landing remains a separate task.

The release branch `release/sharing-resend` in `/tmp/artifacts-production-resend/worktree` merges current main `9896e9e` into the reviewed provider head. Integration commit `43aabdb` preserves main's compact publication header and the sharing projection. PR [#49](https://github.com/yersonargotev/artifacts/pull/49) records the integration without changing frozen PR47 or PR48. The independent integration and preflight review passed with operational notes in `/tmp/artifacts-production-resend/preflight-review.md`.

Resend's API confirms the selected root domain is verified and sending is enabled. Existing SpaceMail root records remain intact. All four Worker builds and real CLI dry runs passed. A private consistent database snapshot contains 20 tables and 1041 rows and passes integrity and foreign-key checks. Only additive migrations 0003 and 0004 are pending. Current deployment versions and the backup receipt are retained under `/tmp/artifacts-production-resend/`.

Exact-head CI run [40222335557](https://github.com/yersonargotev/artifacts/actions/runs/40222335557) passed the 281 source tests, 16 portable package tests, and Worker build. Its native packed same-request proof failed because one request received a real introspection 500 before entering the share command while the other committed. The failure excerpt is retained in `ci-failure-excerpt.log`. A bounded correction to test coordination is in progress. No production migration or deployment has run. Complete fresh exact-head CI after the correction before applying migrations or deploying.

Operational scripts and the real-email browser proof are private ignored files below `.test-artifacts/deployment/` in the release worktree. The migration script and dry-run receipt currently pin `43aabdb`; update their exact source guard after the reviewed test correction. Read `/tmp/artifacts-production-resend/plan.md` and the latest evidence before continuing. Never rerun the email proof blindly after a partial failure.

## Production deployment complete

The operator-authorized release is deployed at `d1a82a6f987b692094b7717c2aa53ba97f332ecc` on `release/sharing-resend`. The panel is https://artifacts-panel.yersonargotev.workers.dev. PR [#49](https://github.com/yersonargotev/artifacts/pull/49) contains the current-main integration and a six-line test coordination correction. Frozen PR47 and PR48 remain unchanged. The sharing stack and follow-ups remain open; no PR was merged, rebased, or force-pushed. A future main release must account for this deployed release branch before replacing production.

Full exact-head [CI40223765252](https://github.com/yersonargotev/artifacts/actions/runs/40223765252) passed checks, source tests, portable and native installed package proofs, Chrome flows, and all Worker builds. The prior native test failure remains recorded. Independent review accepted the test-only correction in `/tmp/artifacts-production-resend/ci-race-review.md`. Fix Root Causes changed the correction to synchronize authentic responses before strict command races without changing product retry or authentication policy.

The private snapshot passed integrity checks before additive migrations 0003 and 0004 applied. The resulting journal has all five expected hashes, foreign keys are valid, and existing artifact, revision, and publication counts were unchanged. Evidence is `/tmp/artifacts-production-resend/migration-receipt.json`. The database backup remains private at `/tmp/artifacts-production-resend/database-before.sqlite`, mode0600.

The deployed versions are:

| Service | Version |
| --- | --- |
| auth | `cd7d9a50-949b-4a8d-ac8d-84d659760c6b` |
| mcp | `03e8eb2a-6aab-4cfb-9827-a524699a34b9` |
| view | `9109975d-c8ab-4279-997b-c053683dc685` |
| panel | `8bc8de59-2d7f-4a71-a3c4-78de2993dc60` |

All four deployments carry 100 percent of traffic. `/tmp/artifacts-production-resend/deployment-receipt.json` records their deployment IDs and timestamps. The source and 40 local bundle file hashes are pinned in `bundle-manifest.json`. All four exact-source dry runs passed before deployment. Production endpoint smoke passed.

The real Chrome155 proof passed at `/tmp/artifacts-production-resend/worktree/.test-artifacts/deployment/run-1792956023111-d7d2ec04-57de-4aa5-bd9f-0fb0b77450d3/result.json`. It exercised owner password login, native OAuth, HTTP create and publish, a real Resend invitation to the controlled guest, exact receipt replay, guest email-code sign-in, the exact published revision, the shared library, and owner-only read/history/export denial. Resend recorded exactly one invitation with `last_event=delivered`. Exactly one code was requested and verified. This proves provider delivery, not inbox placement or user reading. Prove It Works required this actual deployed flow rather than relying on local tests.

The independent existing sharing verifier also passed against the deployed Workers. It proved established viewer-cookie denial after revocation and cleaned its share. The outer proof deleted its exact artifact, new OAuth clients, and new browser sessions and closed Chrome. No cleanup errors remain. It preserves the real guest account. Temporary projected secret files were removed. The user's `.env.deploy` remains available with mode0600. See `/tmp/artifacts-production-resend/cleanup-receipt.json`.

Three initial browser-proof attempts stopped before creating any artifact or sending any email. The operational runner initially expected local JSON authorization instead of the real HTTP302 consent redirect, then sent browser cookies without an Origin on the native token exchange. The runner now validates the actual consent destination and uses a cookie-free token request. Product code did not change. All temporary clients and sessions from those attempts were cleaned. Their private logs and failed results remain under `/tmp/artifacts-production-resend/`.

Resend sending uses the verified root domain `sparkydevs.com`. SpaceMail reception and DNS records were preserved. Prior portable native-package limitations and one-attempt email semantics remain as documented. Full native Worker capability and unrelated live agent-client integrations are not inferred from this bounded production proof. No ongoing monitoring is promised after this session.
