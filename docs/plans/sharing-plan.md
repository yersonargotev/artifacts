# Email sharing plan

An owner grants view access to a published artifact for an exact email address. The invited person signs in with a one-time email code and opens the existing publication URL. Revoking a share takes effect on the next request.

The rule is that a viewer sees the published revision and its attachments, and nothing else. History, export, editing, project moves, and owner account details stay owner-only. S9 exposes only the owner display name for attribution.

The program lands ten PRs in this order. S1 adds the share table. S2 authorizes viewers. S3 adds MCP tools. S4 adds REST and client methods. S5 adds CLI commands. S6 adds email-code sign-in. S7 adds the sign-in form. S8 adds the panel share dialog. S9 adds the invited person's views. S10 adds invitation emails and the deployed check.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `/Users/argote/Documents/dev/artifacts/.claude/skills/poteto-mode/playbooks/autopilot-stack.md`. The PRs form one linear chain, S1 at the root and S10 at the tip. Each link targets its parent's branch. The root agent appends verified links. The operator lands the chain bottom-up, so every PR from S1 to S10 stops at stack-ready.

In every perf and regression lane, "trunk" means the PR's base branch, which is `main` for S1 and the parent link for the rest.

A viewer without access sees one of two denials. A fresh open ends at the panel's `/publication/open` with 404 and `No se puede abrir este artefacto.` A request that still carries a viewer cookie gets the Worker's 403 and the cookie is cleared.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [x] Settle the three operator decisions in Appendix B before S1 starts. Record each answer in the decision trail.
- [ ] Read these from their installed locations at program start. Re-read them at every tick.
  - [ ] Read `/Users/argote/Documents/dev/artifacts/.claude/skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] Read `/Users/argote/Documents/dev/artifacts/.claude/skills/poteto-mode/playbooks/autopilot-full.md`
  - [ ] Read the sibling `swarm/SKILL.md`
  - [ ] `git show origin/main:.agents/skills/verify-artifacts/SKILL.md`
  - [ ] `cat /Users/argote/Documents/dev/artifacts/.claude/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] Read each required sibling skill from this host installation, including `show-me-your-work/SKILL.md` and `playwright-cli`.
- [ ] On the operator's go, arrange an hourly audit with the tick prompt below, using active-session monitoring or a verified host scheduler. Respect the host's maximum wait and keep the operator informed. Report missing scheduling and do not promise ticks after this session ends. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the installed execution playbook. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names. Owners run on `opus` at `xhigh` per `~/.pstack/claude-models.md`. S2 and S6 change authorization, so their owners run on `fable` at `xhigh`.
- [ ] Follow this dependency graph. Each owner branches from its parent's branch.
  - [ ] S1 is first and branches from `main`.
  - [ ] S2 after S1. S3 after S2. S4 after S3. S5 after S4.
  - [ ] S6 after S5. S7 after S6. S8 after S7. S9 after S8. S10 after S9.
- [ ] Hold the file boundaries.
  - [ ] S1 and S2 touch only `packages/db/**`, `packages/artifacts/src/**`, `apps/publication/src/**`, `docs/decisions/sharing.md`, `scripts/bench-publication.ts`, `.agents/skills/verify-artifacts/**`, and `tests/**`.
  - [ ] S3 to S5 touch only their transport (`apps/mcp/**`, `packages/rest/**`, `packages/client/**`, `apps/cli/**`), its docs and skills, and `tests/**`.
  - [ ] S6 and S7 touch only `apps/auth/**`, `packages/config/**`, `packages/db/src/auth-schema.ts`, and `tests/**`.
  - [ ] S8 and S9 touch only `apps/dashboard/**`, `apps/publication/src/document.ts`, the read methods in `packages/artifacts/src/index.ts`, `package.json` scripts, and `tests/**`.
- [ ] Hold the review gate. S7, S8, S9, and S10 change an interaction. They wait for the operator's review in chat with screenshots and a video before the root appends them.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**. Use the run's built-in PR tool when it has one, else `origin pr create --status open --base <parent-branch>` or `gh pr create --base <parent-branch>` according to the resolved forge. A stack child targets its parent branch.
- [ ] Run `pnpm check` and `pnpm test` once before the PR-facing push. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review. `deslop` comes from `cursor-team-kit`, which this host lacks. Run the same cleanup by hand and record that in the PR.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] Never rebase onto another branch. The root owns the chain and rebases it bottom-up when trunk drifts.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head. Run each full swarm per `pstack/skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. S2 and S6 add an authorization audit lane that tries to read history, export, or another owner's artifact as the guest. The root audits the receipts in the stack-ready report before the verdict.
- [ ] Clean only when every lane is `PASS`. Findings go back to the owner, including a defect that a lane filed as a note. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] Append each clean PR to the chain in dependency order with `gh pr edit <pr> --base <parent-branch>`. A link whose patch-id is unchanged after a root rebase keeps its verdict per `playbooks/shipping.md`. The operator lands the chain bottom-up. Nobody writes to the chain once landing starts.

### Boot recipe, for every live lane

Each live lane runs in an available isolated environment at the PR head; separate worktrees suffice when the scenario does not require a VM. Record unavailable runtime infrastructure as an unmet gate. Drive through `control-ui` or `control-cli` from `cursor-team-kit`. This host lacks `cursor-team-kit`, so lanes drive the browser through `.agents/skills/verify-artifacts/scripts/control.ts` and `playwright-cli`, and the terminal through captured `pnpm artifacts` runs. Appendix C records this gap.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] Run `pnpm install --frozen-lockfile && pnpm build` in the lane worktree.
- [ ] Run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --run .test-artifacts/verify-artifacts/<pr-id>-<n>`. Wait for `ready: true` in its JSON output.
- [ ] Run `control.ts doctor` with the same `--run` path. Continue only when `doctor.json` passes.
- [ ] From S2 on, run `control.ts drive sharing` to create the guest account. Before S2 merges, lanes use the existing drives only.
- [ ] Deliver input only through `control.ts drive <feature>`, `playwright-cli` against the run's panel and viewer URLs, MCP calls with the run's token, and `pnpm artifacts` against the run's REST URL. Read-only diagnostics are `doctor.json`, `<feature>/result.json`, `actions.jsonl`, and `sqlite3` with `SELECT` only on the run's database, which lives at `$TMPDIR/artifacts-identity-*/identity.db` and not under `runtime/`.
- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report. A terminal lane saves a rendered capture of the command and its output as the PNG.
- [ ] Run `control.ts cleanup` with the same `--run` path after pass or fail.

## Add the share table and owner share methods (S1)

**Depends on.** None.

**Files.**

- [ ] Edit `packages/db/src/schema.ts`.
- [ ] Create `packages/db/migrations/0003_*.sql` and its `meta/` snapshot with `pnpm db:generate`.
- [ ] Edit `packages/artifacts/src/index.ts`.
- [ ] Create `docs/decisions/sharing.md`.
- [ ] Create `tests/sharing.test.ts`.
- [ ] Create `scripts/bench-publication.ts`.

**Build.**

- [ ] Add table `artifactShare` in `schema.ts` with `artifactId` (foreign key with cascade delete), `kind` (only `email` for now), `value`, `createdBy`, and `createdAt`. Add a unique index on `(artifact_id, kind, value)`.
- [ ] Add store methods `share`, `unshare`, and `listShares` to `createArtifactStore`. Each one authorizes `artifacts:publish`, requires ownership through `owned`, and records a `requestId` receipt like the existing mutations. `share` parses the email with zod and stores it in lowercase.
- [ ] Write `docs/decisions/sharing.md` with the rules from Appendix D and the enterprise domain-sharing boundary.
- [ ] Write `scripts/bench-publication.ts`. It takes two run paths, admits one viewer per run, alternates 200 `GET /a/{id}` requests between the runs, and prints p50 and p95 per run as JSON.

**You see.**

- [ ] `pnpm db:migrate` on a fresh database prints the `0003` migration and `sqlite3 <db> '.schema artifact_share'` shows the unique index.
- [ ] Publication, panel, MCP, REST, and CLI behave exactly as on `main`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `tests/sharing.test.ts` covers `share` storing `Ana@Example.com` as `ana@example.com`, a duplicate share returning the existing row, a retry with the same `requestId` returning the same receipt, `unshare` removing the row, `listShares` returning only the owner's shares, a non-owner getting `not_found`, an invalid email getting a validation error, and deleting the artifact leaving zero `artifact_share` rows. Run `node --import tsx --test tests/sharing.test.ts`.
- [ ] `tests/publication.test.ts`, `tests/artifacts.test.ts`, and `tests/database.test.ts` pass unchanged. Run `pnpm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `control.ts drive publication` at trunk and head. Save `publication-trunk.png` and `publication-head.png`. Pass when both `result.json` files pass and the viewer shows the same revision.
- [ ] Lane 2. Run `control.ts drive authoring`. Save `authoring.png`. Pass when `result.json` passes.
- [ ] Lane 3. Run `control.ts drive projects`. Save `projects.png`. Pass when `result.json` passes and the moved artifact appears under its project.
- [ ] Lane 4. Run `control.ts drive export`. Save `export.png`. Pass when the browser ZIP and the MCP ZIP have the same SHA-256.
- [ ] Lane 5. Create a share through a store call in a lane script, then delete the artifact through the panel's **Eliminar artefacto** page. Save `delete-cascade.png`. Pass when `SELECT count(*) FROM artifact_share` returns 0.
- [ ] Lane 6. Migrate a database at trunk, seed three artifacts, check out head, and run `pnpm db:migrate`. Save `migrated-library.png` of the panel library. Pass when all three artifacts and their revisions are intact.
- [ ] Lane 7. Run `control.ts drive preview`. Save `preview.png`. Pass when `Interaction verified` appears.
- [ ] Lane 8. Run `control.ts drive cli`. Save `cli.png`. Pass when the CLI export matches the MCP export.
- [ ] Lane 9. Run `control.ts drive identity`. Save `identity.png`. Pass when logout and global revocation both pass.
- [ ] Lane 10. Run `control.ts drive screens`. Save `screens-390.png`. Pass when no page overflows at 1440 or 390 pixels and the browser logs no errors.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. The p50 and p95 latency of an owner's `GET /a/{id}`, plus the wall time of `pnpm db:migrate` applying `0003` to a database with 1,000 artifacts.
- [ ] Probe. Launch one trunk run and one head run. Run head's `scripts/bench-publication.ts <trunk-run> <head-run>`, which interleaves requests. Time the migration with `/usr/bin/time` at head.
- [ ] Baseline. Record the trunk p50 and p95 first.
- [ ] Rule. Fail when head p50 exceeds trunk p50 by more than 10 percent and 3 ms. Fail when the migration takes longer than 2 seconds.

**Review gate.** None. S1 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Chain rebased by the root after the verdict, patch-id unchanged.
- [ ] The root appends S1 to the chain. The operator lands it bottom-up.

## Authorize viewers through shares (S2)

**Depends on.** S1.

**Files.**

- [ ] Edit `packages/artifacts/src/index.ts`.
- [ ] Edit `apps/publication/src/http.ts`.
- [ ] Edit `.agents/skills/verify-artifacts/scripts/control.ts`.
- [ ] Create `.agents/skills/verify-artifacts/features/sharing.md`.
- [ ] Edit `.agents/skills/verify-artifacts/features/README.md`.
- [ ] Edit `tests/sharing.test.ts`.

**Build.**

- [ ] Add `canView(connection, userId, artifactId)` in `packages/artifacts/src/index.ts`. It returns true when the user owns the artifact, or when the user's email is verified and matches an `email` share.
- [ ] Replace the owner checks in `issuePublicationGrant`, `consumePublicationGrant`, and `readPublished` with `canView`. `readPublished` returns a viewer projection without owner-only fields.
- [ ] Remove the `artifact.ownerId !== viewer.userId` comparison in `apps/publication/src/http.ts` and trust the backend decision.
- [ ] Add the `sharing` drive to `control.ts`. It creates a second disposable account with a verified email, publishes as the owner, shares through the store, and saves the guest's view. S3 switches the share step to MCP.

**You see.**

- [ ] A guest whose verified email has a share opens `/a/{id}` and sees the published revision.
- [ ] The same guest gets `Tu sesión o esta publicación ya no están disponibles.` with status 403 on the first request after revocation.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `tests/sharing.test.ts` gains an owner and a seeded guest. It covers an exact match, a match in different letter case, an unverified email denied, revocation on the next read, a never-published artifact returning `not_found` with the share kept, deletion, and the guest getting `not_found` from `history` and `export`. Run `node --import tsx --test tests/sharing.test.ts`.
- [ ] `tests/publication.test.ts` passes unchanged. Run `pnpm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `control.ts drive publication` at trunk and head for the owner. Trunk lacks shares and the guest account route, so record that and gate the guest's admission at head. Save `owner-trunk.png`, `owner-head.png`, and `guest-head.png`. Pass when both owner runs pass and the guest sees the revision at head.
- [ ] Lane 2. Run `control.ts drive sharing`. Save `guest-view.png`. Pass when the guest's iframe renders the artifact's marker text.
- [ ] Lane 3. Share with `GUEST@Example.com` while the guest's account email is lowercase. Save `case-match.png`. Pass when the guest is admitted.
- [ ] Lane 4. Create the guest with `control.ts account --unverified`, then open the publication fresh. Save `unverified.png`. Pass when the open ends at `/publication/open` with 404 and `No se puede abrir este artefacto.`
- [ ] Lane 5. With the guest viewing, revoke the share and reload. Save `revoked.png`. Pass when the reload returns 403 and clears the viewer cookie.
- [ ] Lane 6. With the guest viewing, publish a new revision as the owner and reload as the guest. Save `republished.png`. Pass when the guest sees the new revision at the same URL without a new share.
- [ ] Lane 7. With the guest viewing, delete the artifact as the owner, reload as the guest, then open the URL fresh in a new context. Save `deleted.png`. Pass when the reload gets 403 with the viewer cookie cleared, the fresh open ends at the panel's 404, and `artifact_share` has no rows for it.
- [ ] Lane 8. Sign the guest into the panel and open `/artifacts/{id}`. Save `guest-panel.png`. Pass when the panel shows not found.
- [ ] Lane 9. Call `artifacts_history` and `artifacts_export` with the guest's MCP token. Save `guest-mcp.png` of the responses. Pass when both return `not_found`.
- [ ] Lane 10. Open the publication fresh as a third account with no share, at 390 pixels wide. Save `stranger-390.png`. Pass when the open ends at `/publication/open` with 404 and the page does not overflow.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. The p50 and p95 latency of an owner's `GET /a/{id}`. Trunk lacks guest reads, so also measure the guest's p95 at head as diff-added work.
- [ ] Probe. Run `scripts/bench-publication.ts <trunk-run> <head-run>` for the owner, interleaved. Run it again at head with the guest's cookie.
- [ ] Baseline. Record the trunk owner p50 and p95 first.
- [ ] Rule. Fail when head owner p50 exceeds trunk by more than 10 percent and 3 ms. Fail when the guest p95 exceeds the head owner p95 by more than 5 ms.

**Review gate.** None. S2 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Chain rebased by the root after the verdict, patch-id unchanged.
- [ ] The root appends S2 to the chain. The operator lands it bottom-up.

## Expose sharing through MCP tools (S3)

**Depends on.** S2.

**Files.**

- [ ] Edit `apps/mcp/src/http.ts`.
- [ ] Edit `skills/artifacts/SKILL.md`.
- [ ] Edit `packages/artifacts/README.md`.
- [ ] Edit `.agents/skills/verify-artifacts/scripts/control.ts`.
- [ ] Edit `tests/artifacts.test.ts`.

**Build.**

- [ ] Register `artifacts_share`, `artifacts_unshare`, and `artifacts_shares_list` next to `artifacts_publish` in `apps/mcp/src/http.ts`. Each calls the S1 store method and requires `artifacts:publish`.
- [ ] Document the three tools in `skills/artifacts/SKILL.md` and the contract reference in `packages/artifacts/README.md`.
- [ ] Switch the `sharing` drive's share step from the store to `artifacts_share`.

**You see.**

- [ ] `tools/list` returns the three tools. `artifacts_share` returns the share with `value` in lowercase.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `tests/artifacts.test.ts` gains cases for each tool, a retry with the same `requestId`, a token without `artifacts:publish` getting `forbidden` with `requiredScope`, and a non-owner getting `not_found`. Run `node --import tsx --test tests/artifacts.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `control.ts drive authoring` at trunk and head. Trunk lacks the tools, so record that and gate `artifacts_share` followed by the guest opening the publication at head. Save `authoring-trunk.png` and `share-head.png`. Pass when both authoring runs pass and the guest sees the revision.
- [ ] Lane 2. Run `control.ts drive sharing`. Save `mcp-share.png`. Pass when `actions.jsonl` shows the `artifacts_share` request and the guest is admitted.
- [ ] Lane 3. Call `artifacts_share` twice with the same `requestId`. Save `retry.png`. Pass when both responses are identical and `artifact_share` has one row.
- [ ] Lane 4. Call `artifacts_unshare`, then reload as the guest. Save `mcp-unshare.png`. Pass when the reload returns 403.
- [ ] Lane 5. Share with three emails in mixed case and call `artifacts_shares_list`. Save `list.png`. Pass when the list has three lowercase values.
- [ ] Lane 6. Call `artifacts_share` with a token that lacks `artifacts:publish`. Save `scope.png`. Pass when the error is `forbidden` with `requiredScope` set to `artifacts:publish`, the same as the existing tools.
- [ ] Lane 7. Call `artifacts_share` with the guest's token on the owner's artifact. Save `non-owner.png`. Pass when the error is `not_found`.
- [ ] Lane 8. Call `artifacts_share` with `not-an-email`. Save `invalid.png`. Pass when the tool returns a validation error and writes no row.
- [ ] Lane 9. Share an unpublished artifact, open it as the guest, then publish and open again. Save `unpublished-share.png`. Pass when the first open is 404 and the second admits the guest.
- [ ] Lane 10. After sharing, run `control.ts drive preview` as the owner. Save `owner-preview.png`. Pass when the owner's panel preview still passes.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. The p95 latency of `artifacts_read` at trunk and head. Trunk lacks sharing tools, so also measure the p95 of `artifacts_share` at head.
- [ ] Probe. Run 100 `artifacts_read` calls alternating between the trunk run and the head run. Run 100 `artifacts_share` calls with distinct emails at head.
- [ ] Baseline. Record the trunk `artifacts_read` p95 first.
- [ ] Rule. Fail when head `artifacts_read` p95 exceeds trunk by more than 10 percent and 3 ms. Fail when `artifacts_share` p95 exceeds 150 ms locally.

**Review gate.** None. S3 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Chain rebased by the root after the verdict, patch-id unchanged.
- [ ] The root appends S3 to the chain. The operator lands it bottom-up.

## Expose sharing through REST and the typed client (S4)

Verified at `8cf6433` with exact-head CI. Runtime and performance receipts are at source head `739ade0`; the final change only strengthens a test and corrects verification documentation. Local evidence is in `/tmp/artifacts-sharing-codex/s4-owner-report.md`, `s4-review-report.md`, and `s4-test-fix-report.md`. API-only lanes use structured response receipts; browser lanes retain actual screenshots.

**Depends on.** S3.

**Files.**

- [x] Edit `packages/rest/src/index.ts`.
- [x] Edit `packages/client/src/index.ts`.
- [x] Edit `packages/rest/README.md`.
- [x] Edit `packages/client/README.md` so the shipped methods and retry reference includes sharing.
- [x] Edit `tests/rest.test.ts`.
- [x] Edit `tests/cli-client.test.ts`.

**Build.**

- [x] Add `GET /v1/artifacts/{id}/shares`, `POST /v1/artifacts/{id}/shares`, and `DELETE /v1/artifacts/{id}/shares/{shareId}` to `packages/rest/src/index.ts` under `artifacts:publish`.
- [x] Add `share`, `unshare`, and `listShares` to the client interface and implementation in `packages/client/src/index.ts`.

**You see.**

- [x] `POST /v1/artifacts/{id}/shares` with `{"email":"ana@example.com","requestId":"..."}` returns 201 and the share.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] `tests/rest.test.ts` gains each route, a retry, scope enforcement, a wrong content type, and a non-owner. `tests/cli-client.test.ts` gains the three client methods. Run `pnpm test:rest-cli`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet` at the PR head, per the boot recipe.

- [x] Lane 1. Regression lane against trunk. Run `control.ts drive cli` at trunk and head. Trunk lacks share routes, so record that and gate `POST` followed by the guest opening the publication at head. Save `cli-trunk.png` and `rest-share-head.png`. Pass when both CLI runs pass and the guest sees the revision.
- [x] Lane 2. `POST` a share. Save `post.png`. Pass when the status is 201 and the guest is admitted.
- [x] Lane 3. `GET` the shares. Save `get.png`. Pass when the body lists the share from lane 2.
- [x] Lane 4. `DELETE` the share and reload as the guest. Save `delete.png`. Pass when the status is 204 and the reload returns 403.
- [x] Lane 5. `POST` twice with the same `requestId`. Save `rest-retry.png`. Pass when both bodies are identical and one row exists.
- [x] Lane 6. `POST` with a token that lacks `artifacts:publish`. Save `rest-scope.png`. Pass when the status is 403 with JSON code `forbidden`, `details.requiredScopes`, and a `WWW-Authenticate` challenge containing `insufficient_scope`.
- [x] Lane 7. `POST` with a foreign `Origin` header. Save `origin.png`. Pass when the status is 403 with `forbidden`.
- [x] Lane 8. `POST` with `content-type: text/plain`. Save `media-type.png`. Pass when the status is 415.
- [x] Lane 9. `POST` with the guest's token on the owner's artifact. Save `rest-non-owner.png`. Pass when the status is 404.
- [x] Lane 10. Run a script that calls the typed client's `share`, `listShares`, and `unshare` against the run. Save `client.png`. Pass when each call returns the typed result and the guest's access follows each step.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. The p95 latency of `GET /v1/artifacts` at trunk and head. Trunk lacks share routes, so also measure the p95 of `GET /v1/artifacts/{id}/shares` at head.
- [x] Probe. Run 100 `GET /v1/artifacts` requests alternating between the trunk run and the head run. Run 100 share-list requests at head.
- [x] Baseline. Record the trunk `GET /v1/artifacts` p95 first.
- [x] Rule. Fail when head p95 exceeds trunk by more than 10 percent and 3 ms. Fail when the share-list p95 exceeds 100 ms locally.

**Review gate.** None. S4 is not review-gated.

**Merge.**

- [x] Root's clean verdict at the exact head SHA.
- [x] Bugbot triage done. No reviews, issue comments, or inline review comments at the root inspection recorded in `/tmp/artifacts-sharing-codex/root-pr-review-state.json`.
- [ ] Chain rebased by the root after the verdict, patch-id unchanged.
- [ ] The root appends S4 to the chain. The operator lands it bottom-up.

## Add CLI share commands (S5)

Verified at `f537c64` with exact-head CI. Runtime and performance receipts are at source head `447d7b5`; the final change only corrects two README sentences. Local evidence is in `/tmp/artifacts-sharing-codex/s5-owner-report.md`, `s5-review-report.md`, and `s5-doc-fix-report.md`. API/CLI-only lanes use structured response receipts; browser lanes retain actual screenshots.

**Depends on.** S4.

**Files.**

- [x] Edit `apps/cli/src/index.ts`.
- [x] Edit `apps/cli/src/operations.ts`.
- [x] Edit `apps/cli/README.md`.
- [x] Edit `skills/artifacts-cli/SKILL.md`.
- [x] Edit `skills/artifacts-cli/references/commands.md` so the bundled reference matches the commands.
- [x] Edit `README.md` so its tool and command lists include the MCP sharing tools from S3 and the CLI commands from S5.
- [x] Edit `tests/cli-client.test.ts`.

**Build.**

- [x] Add the cases `share <id> --email <email>`, `unshare <id> <shareId>`, and `shares <id>` to the command switch in `apps/cli/src/index.ts`. Route `share` and `unshare` through the existing retry receipts so `artifacts retry` replays them.
- [x] Document the commands in `apps/cli/README.md` and `skills/artifacts-cli/SKILL.md`. The npm release stays a separate step.

**You see.**

- [x] `pnpm artifacts share <id> --email ana@example.com` prints the share as JSON and exits 0.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] `tests/cli-client.test.ts` gains each command, `retry` of a share, and an invalid email exiting non-zero. Run `pnpm test:rest-cli`.
- [x] Run `pnpm test:cli-skills` and check that the skill proof passes.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet` at the PR head, per the boot recipe.

- [x] Lane 1. Regression lane against trunk. Run `control.ts drive cli` at trunk and head. Trunk lacks the commands, so record that and gate `share` followed by the guest opening the publication at head. Save `cli-trunk.png` and `cli-share-head.png`. Pass when both CLI runs pass and the guest sees the revision.
- [x] Lane 2. Run `pnpm artifacts share <id> --email <guest>`. Save `share.png`. Pass when it exits 0 and the guest is admitted.
- [x] Lane 3. Run `pnpm artifacts shares <id>`. Save `shares.png`. Pass when the output lists the guest's email.
- [x] Lane 4. Run `pnpm artifacts unshare <id> <shareId>` and reload as the guest. Save `unshare.png`. Pass when it exits 0 and the reload returns 403.
- [x] Lane 5. Interrupt a `share` after the request leaves, then run `pnpm artifacts retry`. Save `retry.png`. Pass when the retry returns the same share and one row exists.
- [x] Lane 6. Run `share` with `--email nope`. Save `invalid.png`. Pass when it exits non-zero with a validation message and writes no row.
- [x] Lane 7. Run `pnpm artifacts --help`. Save `help.png`. Pass when the help lists `share`, `unshare`, and `shares`.
- [x] Lane 8. Run `share` after `pnpm artifacts logout`. Save `logged-out.png`. Pass when it exits non-zero and asks for `login`.
- [x] Lane 9. Run `pnpm build:packages`, install the packed CLI in a temp directory, and run `share`. Save `packed.png`. Pass when the packed CLI shares and the guest is admitted.
- [x] Lane 10. Run `pnpm artifacts list` and `pnpm artifacts publish` as on trunk. Save `existing.png`. Pass when the output matches the trunk format.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. The wall time of `pnpm artifacts list` at trunk and head. Trunk lacks share commands, so also measure the wall time of `pnpm artifacts shares <id>` at head.
- [x] Probe. Run `list` 20 times, alternating between trunk and head worktrees against their runs. Run `shares` 20 times at head.
- [x] Baseline. Record the trunk `list` median first.
- [x] Rule. Fail when the head `list` median exceeds trunk by more than 10 percent. Fail when the `shares` median exceeds the head `list` median by more than 100 ms.

**Review gate.** None. S5 is not review-gated.

**Merge.**

- [x] Root's clean verdict at the exact head SHA.
- [x] Bugbot triage done. No reviews, issue comments, or inline review comments at the root inspection recorded in `/tmp/artifacts-sharing-codex/root-pr-review-state.json`.
- [ ] Chain rebased by the root after the verdict, patch-id unchanged.
- [ ] The root appends S5 to the chain. The operator lands it bottom-up.

## Let invited people sign in with an email code (S6)

**Depends on.** S5.

Verified at `c5cc8da` with exact-head CI and a fresh independent PASS. Evidence is in `/tmp/artifacts-sharing-codex/s6-redemption-fix-report.md` and `s6-redemption-review-report.md`. Original runtime/performance evidence at `ef5a2b9` is carried only for unchanged password/send paths. The final head reran all ten browser lanes and an independent 96-outcome failure matrix. API-only lanes retain structured receipts. Deployed provider delivery remains an S10 gate.

**Files.**

- [x] Edit `apps/auth/src/auth-core.ts`.
- [x] Edit `packages/config/src/index.ts`.
- [x] Create `packages/config/src/email.ts`.
- [x] Skip: no schema edit is needed; the existing verification table suffices.
- [x] Use focused `tests/email-code.test.ts`, `tests/email-code-runtime.test.ts`, and `tests/email-code-worker.test.ts` for the new behavior, including actual OAuth callbacks. Existing OAuth tests remain unchanged and pass.

**Build.**

- [x] Prove the spike in Appendix A first. Commit its result to the decision trail before any other box. Evidence is local prototype `d253377` on verified S5, its 21-case root repeat, and the canonical prototype row.
- [x] Add a sender type in `packages/config/src/email.ts` with a Cloudflare Email Service provider and a file sink for local runs and tests.
- [x] Enable `emailOTP` in `createAuth` in `apps/auth/src/auth-core.ts`. Keep `disableSignUp` for passwords.
- [x] Prove that every path that creates or updates a `user` row stores the email in lowercase, including `emailOTP` sign-in. `canView` compares the share with `lower(user.email)` while the unique index on `user.email` is case-sensitive, so two accounts that differ only in case would both match one share. Add a test that signs in by code as `Ana@Example.com` and asserts the stored email is `ana@example.com`.
- [x] Send a code only to normalized `OWNER_EMAIL`, an email covered by an active share, or an existing user who owns at least one artifact. A former invitee retains code sign-in while owning artifacts. An existing user alone does not qualify. Return the same response for every email. Rate-limit code requests per email and per IP.

**You see.**

- [x] An invited email requests a code, the file sink records it, and signing in with it creates the account and returns a session.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] The focused email-code suites cover an invited email receiving a code, sign-in and the dashboard callback, uninvited equal responses without delivery, per-email and per-IP limits, and rejected password signup. All 26 focused tests and all 201 full-suite tests pass. Four final redemption regressions fail on the preceding head and pass on the final head.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet` at the PR head, per the boot recipe.

- [x] Lane 1. Regression lane against trunk. Run `control.ts drive identity` at trunk and head. Trunk lacks email codes, so record that and gate an invited guest signing in by code and opening the publication at head. Save `identity-trunk.png`, `identity-head.png`, and `otp-guest.png`. Pass when both identity runs pass and the guest sees the revision.
- [x] Lane 2. Request a code for an invited email through the auth API. Save `sink.png` of the file sink. Pass when the sink holds one code for that email.
- [x] Lane 3. Request a code for an uninvited email. Save `uninvited.png`. Pass when the response body equals lane 2's and the sink holds no code.
- [x] Lane 4. Request a code for the owner and sign in with it. Save `owner-otp.png`. Pass when the owner reaches the panel library.
- [x] Lane 5. Request codes for one email past the per-email limit. Save `email-limit.png`. Pass when the request over the limit gets 429.
- [x] Lane 6. Request codes for many emails from one IP past the per-IP limit. Save `ip-limit.png`. Pass when the request over the limit gets 429.
- [x] Lane 7. Submit wrong codes until the plugin's attempt limit. Save `attempts.png`. Pass when the correct code no longer works after the limit.
- [x] Lane 8. `POST` to the password sign-up endpoint. Save `signup.png`. Pass when the status is 4xx and no user row appears.
- [x] Lane 9. Revoke the guest's share and request a code. Save `revoked-otp.png`. Pass when the sink holds no new code.
- [x] Lane 10. Complete an MCP OAuth authorization as the guest using a code. Save `guest-oauth.png`. Pass when `whoami` returns the guest.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. The p95 latency of password sign-in at trunk and head. Trunk lacks email codes, so also measure the p95 of a code request with the file sink at head.
- [x] Probe. Run 50 password sign-ins alternating between the trunk run and the head run. Run 50 code requests at head under the rate limit.
- [x] Baseline. Record the trunk sign-in p95 first.
- [x] Rule. Fail when head sign-in p95 exceeds trunk by more than 10 percent and 5 ms. Fail when the code request p95 exceeds 200 ms locally.

**Review gate.** None. S6 is not review-gated.

**Merge.**

- [x] Root's clean verdict at the exact head SHA.
- [x] Bugbot triage done. No reviews or comments at the root inspection recorded in `/tmp/artifacts-sharing-codex/root-pr-review-state.json`.
- [ ] Chain rebased by the root after the verdict, patch-id unchanged.
- [ ] The root appends S6 to the chain. The operator lands it bottom-up.

## Add the email-code form to the sign-in page (S7)

**Depends on.** S6.

Technical verification passed at `323d1f8` on PR44. Owner and independent evidence are in `/tmp/artifacts-sharing-codex/s7-owner-report.md` and `s7-review-report.md`. The independent run passed all ten lanes and eight source mutations. Exact final CI passed and the operator explicitly approved the actual screenshots and video with “Sí, continuar con S8”. Media is in `/tmp/artifacts-sharing-codex/s7-worktree/.test-artifacts/review/`; S8 has not started.

**Files.**

- [x] Edit `apps/auth/src/pages.ts`.
- [x] Edit `apps/auth/src/http-core.ts` only to pass the server-known email-code capability to the renderer.
- [x] Create `tests/sign-in-code.browser.proof.ts`.
- [x] Edit `package.json`.

**Build.**

- [x] Add a **Recibir código** form to the sign-in page in `apps/auth/src/pages.ts`. After the request, show a code field. Continue the OAuth flow the same way password sign-in does.
- [x] Add `tests/sign-in-code.browser.proof.ts` to the `test:browser` script.

**You see.**

- [x] The sign-in page shows **Recibir código** under the password form. Submitting it shows `Te enviamos un código` and a code field.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] `tests/sign-in-code.browser.proof.ts` signs a guest in by code and lands in the panel. Run `pnpm build && node --import tsx tests/sign-in-code.browser.proof.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet` at the PR head, per the boot recipe.

- [x] Lane 1. Regression lane against trunk. Sign in with a password at trunk and head. Trunk lacks the form, so record that and gate a guest signing in by code and landing in the panel at head. Save `password-trunk.png`, `password-head.png`, and `code-head.png`. Pass when both password runs land in the panel and the code sign-in does too.
- [x] Lane 2. Click **Recibir código** with an invited email. Save `code-sent.png`. Pass when `Te enviamos un código` and the code field show.
- [x] Lane 3. Enter the code from the sink. Save `code-landed.png`. Pass when the guest lands in the panel library.
- [x] Lane 4. Run `pnpm artifacts login` as the guest and finish it with a code. Save `cli-login.png`. Pass when `pnpm artifacts whoami` returns the guest.
- [x] Lane 5. Enter a wrong code. Save `wrong-code.png`. Pass when a Spanish error shows next to the field and focus moves to it.
- [x] Lane 6. Request a code for an uninvited email. Save `uninvited-form.png`. Pass when the page looks the same as lane 2.
- [x] Lane 7. Run lanes 2 and 3 at 390 pixels wide. Save `mobile.png`. Pass when nothing overflows.
- [x] Lane 8. Complete the flow with the keyboard only. Save `keyboard.png`. Pass when every control is reachable by Tab and the focus ring is visible.
- [x] Lane 9. Hit the per-email limit from the form. Save `limited.png`. Pass when the page shows a Spanish wait message.
- [x] Lane 10. From the code step, go back to the password form. Save `back.png`. Pass when the password form shows with the email kept.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. The time from navigation to the sign-in page's load event at trunk and head.
- [x] Probe. Load the sign-in page 30 times with Playwright, alternating between the trunk run and the head run.
- [x] Baseline. Record the trunk median first.
- [x] Rule. Fail when the head median exceeds trunk by more than 10 percent and 20 ms.

**Review gate.** The operator reviews before merge.

- [x] Copy lane 2, 3, 5, and 7 screenshots into `.test-artifacts/review/S7-review-<slug>.png`.
- [x] Launch the email-code runtime with `control.ts launch --email-code`, then record a 30 to 60 second video with the committed S7 proof in `--run PATH --headed` mode on those same live services. This substitutes for a control recipe that does not exist and avoids duplicating the lane. Save it as `.test-artifacts/review/S7-review.mp4`.
- [x] Post the screenshots and the video in chat. Operator approved the actual media for `323d1f8` and authorized S8.

**Merge.**

- [x] Root's clean verdict at the exact head SHA.
- [x] Bugbot triage done. No issue comments, review records or inline comments at the final root inspection.
- [ ] Chain rebased by the root after the verdict, patch-id unchanged.
- [ ] The root appends S7 to the chain. The operator lands it bottom-up.

## Add the share dialog to the panel (S8)

**Depends on.** S7.

Technical verification passed at `3fd5f00` on PR45, including fresh independent review and exact-head CI40162987967 with production skipped. Owner and review reports are `/tmp/artifacts-sharing-codex/s8-denial-fix-report.md` and `s8-fix-review-report.md`. Fresh final-head timing and media replace the historical e3 evidence. The operator approved continuation in chat with "continua" after the media handoff. Root inspected the five PNGs and video frames and accepted S8 at this exact head. S9 is authorized; landing remains with the operator.

**Files.**

- [x] Edit `apps/dashboard/src/components/ArtifactMenu.tsx`.
- [x] Edit `apps/dashboard/src/components/detail/DetailHeader.astro`.
- [x] Create `apps/dashboard/src/components/share/ShareDialog.tsx`.
- [x] Create `apps/dashboard/src/components/share/ShareForm.tsx`.
- [x] Create `apps/dashboard/src/share.ts`.
- [x] Create `apps/dashboard/src/pages/artifacts/[artifactId]/share.astro`.
- [x] Create `tests/share-form.test.ts`.
- [x] Create `tests/panel-share.browser.proof.ts`.
- [x] Edit `package.json`.
- [x] Edit `apps/dashboard/src/runtime.ts` to expose the existing sharing store operations to the panel.
- [x] Edit `apps/dashboard/src/layouts/Panel.astro` to mount one explicitly enabled dialog.
- [x] Edit `apps/dashboard/src/pages/index.astro` and `apps/dashboard/src/pages/artifacts/[artifactId].astro` to enable that capability.
- [x] Edit `apps/dashboard/src/components/library/ArtifactCard.astro` to provide the menu action and native link.
- [x] Edit `apps/dashboard/src/components/detail/PublicationCard.astro` to correct both owner-only access claims.
- [x] Edit `apps/dashboard/src/styles/panel.css` with scoped sharing styles.
- [x] Edit `apps/dashboard/src/urls.ts` for the canonical share URL.
- [x] Edit `.agents/skills/verify-artifacts/features/sharing.md` to describe the real panel entry points and committed browser proof.
- [x] Edit `tests/artifact-browser.proof.ts` so its publication notice assertion matches the corrected owner/invited-reader access copy.
- [x] Edit `tests/panel-library.browser.proof.ts` to cover the new Compartir keyboard stop while preserving download focus, URL and byte checks.

**Build.**

- [x] Add a **Compartir** item to `ArtifactMenu` and to `DetailHeader`. It opens `ShareDialog`, which follows the progressive pattern of `MoveDialog` and falls back to the `share.astro` page without JavaScript.
- [x] Let the dialog add an email, list current shares, and revoke one. Each action posts through `share.ts` with a `requestId`.
- [x] When the artifact is not published, show `Las personas invitadas podrán verlo cuando lo publiques.`
- [x] Change the panel's publication card text `Solo tú puedes abrir el enlace` so it is true when shares exist, for example by naming how many people can open it.

**You see.**

- [x] The owner opens **Compartir**, adds `ana@example.com`, and sees it in the list with a **Quitar** button.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] `tests/share-form.test.ts` covers parsing the form, an invalid email, and a revoke request. Run `node --import tsx --test tests/share-form.test.ts`.
- [x] `tests/panel-share.browser.proof.ts` shares with the guest, opens the publication in a second browser context, revokes, and asserts the guest's next request returns 403. Run `pnpm build && node --import tsx tests/panel-share.browser.proof.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet` at the PR head, per the boot recipe.

- [x] Lane 1. Regression lane against trunk. Open the detail page and the **Mover a proyecto** dialog at trunk and head. Trunk lacks **Compartir**, so record that and gate sharing from the dialog followed by the guest opening the publication at head. Save `detail-trunk.png`, `detail-head.png`, and `dialog-share.png`. Pass when the move dialog behaves the same and the guest sees the revision.
- [x] Lane 2. Open **Compartir** from a library card's menu. Save `menu-open.png`. Pass when the dialog opens with the email field focused.
- [x] Lane 3. Open **Compartir** from the detail header. Save `header-open.png`. Pass when the same dialog opens.
- [x] Lane 4. Add the guest's email. Save `added.png`. Pass when the list shows the email in lowercase.
- [x] Lane 5. Open the publication as the guest in a second context. Save `guest-open.png`. Pass when the guest sees the revision.
- [x] Lane 6. Click **Quitar** and reload as the guest. Save `revoked.png`. Pass when the share leaves the list and the reload returns 403.
- [x] Lane 7. Open **Compartir** on an unpublished artifact. Save `unpublished.png`. Pass when the unpublished notice shows.
- [x] Lane 8. Submit `nope`. Save `invalid.png`. Pass when a Spanish inline error shows and no row is written.
- [x] Lane 9. Run lanes 2 and 4 at 390 pixels wide. Save `mobile.png`. Pass when nothing overflows.
- [x] Lane 10. Open the dialog, press Escape, and disable JavaScript to use `share.astro`. Save `escape.png` and `no-js.png`. Pass when focus returns to the trigger and the page shares without JavaScript.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. The detail page's load-event time at trunk and head. Trunk lacks the dialog, so also measure the time from clicking **Compartir** to the share list rendering at head.
- [x] Probe. Load the detail page 30 times with Playwright, alternating between the trunk run and the head run. Open the dialog 30 times at head with 20 shares.
- [x] Baseline. Record the trunk median first.
- [x] Rule. Fail when the head median exceeds trunk by more than 10 percent and 20 ms. Fail when the dialog median exceeds 300 ms.

**Review gate.** The operator reviews before merge.

- [x] Copy lane 2, 4, 6, 7, and 9 screenshots into `.test-artifacts/review/S8-review-<slug>.png`.
- [x] Record a 30 to 60 second video of share, guest open, and revoke on a lane run. Save it as `.test-artifacts/review/S8-review.mp4`.
- [x] Post the screenshots and the video in chat. The operator approved continuation to S9 with "continua".

**Merge.**

- [x] Root's clean verdict at the exact head SHA `3fd5f0069de0f72ae7226b8188707f94f2c43655`, after operator continuation approval.
- [x] Bugbot triage done. Issue comments, reviews and inline review comments are empty at the final root inspection.
- [ ] Chain rebased by the root after the verdict, patch-id unchanged.
- [ ] The root appends S8 to the chain. The operator lands it bottom-up.

## Show invited people what was shared with them (S9)

**Depends on.** S8.

Technical verification passed at `93e0aca` on ready PR46, based on verified S8. All212unit tests, package/Workers builds, the13-entrypoint browser chain, REST/CLI and first-use proofs pass. The independent reviewer reran live behavior, preserved owner publication bytes and killed ten production mutations. Exact CI40189592936 succeeded with production skipped. Local30/30/30 samples pass unchanged budgets, owner34.85to36.20ms and guest with50shares11.05ms. Current owner report is `/tmp/artifacts-sharing-codex/s9-owner-report.md`; independent final PASS report is `/tmp/artifacts-sharing-codex/s9-review-report.md`. Actual34.04second video and five PNGs are in `/tmp/artifacts-sharing-codex/s9-worktree/.test-artifacts/review/`. The operator reviewed the actual media and explicitly answered "Aprobar S9 y continuar con S10". S9 is clean at this exact head and S10 is authorized. Design and bounded scope are recorded in `/tmp/artifacts-sharing-codex/s9-synthesis.md`.

**Files.**

- [x] Edit `packages/artifacts/src/index.ts`.
- [x] Edit `apps/publication/src/document.ts`.
- [x] Edit `apps/dashboard/src/pages/index.astro`.
- [x] Create `apps/dashboard/src/components/library/SharedWithMe.astro`.
- [x] Edit `tests/library.test.ts`.
- [x] Edit `tests/panel-share.browser.proof.ts`.
- [x] Skip the conditional `package.json` edit. The default committed browser proof executes inherited S8 and S9 in the existing CI chain.
- [x] Edit `packages/contracts/src/index.ts` for the shared summary and strict owner-name contract.
- [x] Edit `apps/dashboard/src/runtime.ts` to expose the new store read.
- [x] Edit `tests/sharing.test.ts` for raw projection, compatibility and privacy.
- [x] Edit `scripts/release-production.ts` and `tests/release.test.ts` for viewer-first deployment and stop-on-failure.
- [x] Edit `docs/decisions/sharing.md` for the rollout contract.
- [x] Edit `.agents/skills/verify-artifacts/features/sharing.md` for the new verified paths.

**Build.**

- [x] Add store method `listSharedWithMe`. It returns published artifacts the viewer can open through a share, with the owner's display name.
- [x] Add a **Compartidos conmigo** section to the panel library. Hide it when the list is empty.
- [x] Show `Compartido por <name>` in the publication header in `publicationDocument` when the viewer is not the owner.

**You see.**

- [x] The guest's library shows **Compartidos conmigo** with the shared artifact. The publication header reads `Compartido por <owner name>`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] `tests/library.test.ts` covers a shared artifact listed, a revoked one gone, a never-published one hidden, and the owner's own artifacts excluded. Run `node --import tsx --test tests/library.test.ts`.
- [x] `tests/panel-share.browser.proof.ts` gains the guest's library and header. Run `pnpm build && node --import tsx tests/panel-share.browser.proof.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet` at the PR head, per the boot recipe.

- [x] Lane 1. Regression lane against trunk. Open the owner's library at trunk and head. Trunk lacks the section, so record that and gate the guest's **Compartidos conmigo** list at head. Save `library-trunk.png`, `library-head.png`, and `guest-library.png`. Pass when the owner's library matches and the guest's list shows the artifact.
- [x] Lane 2. Sign in as the guest. Save `shared-section.png`. Pass when **Compartidos conmigo** lists the shared artifact.
- [x] Lane 3. Click the shared artifact. Save `opened.png`. Pass when the publication opens.
- [x] Lane 4. Read the publication header. Save `header.png`. Pass when it reads `Compartido por` and the owner's name.
- [x] Lane 5. Revoke as the owner and reload the guest's library. Save `revoked-library.png`. Pass when the item is gone.
- [x] Lane 6. Share a never-published artifact and reload the guest's library, then publish it and reload again. Save `unpublished-library.png`. Pass when the item is hidden first and listed after publishing.
- [x] Lane 7. Open the owner's library. Save `owner-library.png`. Pass when **Compartidos conmigo** is absent.
- [x] Lane 8. Sign in as an account with no shares. Save `empty.png`. Pass when the section is absent and the welcome state shows.
- [x] Lane 9. Run lanes 2 and 4 at 390 pixels wide. Save `mobile.png`. Pass when nothing overflows.
- [x] Lane 10. Create an artifact as the guest through MCP. Save `guest-own.png`. Pass when it appears in the guest's own list and not under **Compartidos conmigo**.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. The library page's load-event time for the owner at trunk and head. Trunk lacks the section, so also measure the guest's library load time with 50 shares at head.
- [x] Probe. Load the owner's library 30 times with Playwright, alternating between the trunk run and the head run. Load the guest's library 30 times at head.
- [x] Baseline. Record the trunk owner median first.
- [x] Rule. Fail when the head owner median exceeds trunk by more than 10 percent and 20 ms. Fail when the guest median exceeds the head owner median by more than 100 ms.

**Review gate.** The operator reviews before merge.

- [x] Copy lane 2, 4, 8, and 9 screenshots into `.test-artifacts/review/S9-review-<slug>.png`.
- [x] Record a 30 to 60 second video of the guest's library and publication on a lane run. Save it as `.test-artifacts/review/S9-review.mp4`.
- [x] Post the screenshots and the video in chat. The operator explicitly approved S9 and continuation to S10.

**Merge.**

- [x] Root's clean verdict at exact `93e0aca1e42b270dcbe15794c008a828afd6323a`, with operator visual approval.
- [x] Bugbot triage done. Root read issue comments, reviews and inline threads at the final head; all are empty.
- [ ] Chain rebased by the root after the verdict, patch-id unchanged.
- [ ] The root appends S9 to the chain. The operator lands it bottom-up.



## Send invitation emails and verify the deployment (S10)

**Depends on.** S9.

S9 is clean and explicitly operator-approved at `93e0aca`. S10's bounded implementation contract is `/tmp/artifacts-sharing-codex/s10-synthesis.md`, based on two independent candidates, two adversarial judgments and a disposable runtime/freshness prototype. Invitations use an immutable requested or skipped result and one postcommit attempt. A crash before the attempt may lose the message. Limits are 100 invitation reservations per owner per UTC day, 100 active shares per artifact and 1000 per owner. Existing rows remain fully listable and revocable. A `requireNew` creation precondition protects the verifier from revoking concurrent existing access.

The first SDK-only patch corrected internal controls, but a later real auth SELECT exposed another retained native statement. Root withdrew broad convergence acceptance. The independent census and both failed backend alternatives are retained. A source-pinned current-version native error reset now has a passing feasibility prototype, including unchanged SDK/errors and encrypted data in both directions. It is not delivery acceptance. The authoritative bounded integration contract is `/tmp/artifacts-sharing-codex/s10-native-integration.md`.

Keep the existing portable seven-package distribution unchanged. Add an opt-in target-qualified native-fixed private server profile, source-pinned host preparation and normal workspace resolution. Both ordinary installations and selected-graph regression proofs passed. The obsolete SDK patch was removed only after that proof. Root countersigned the complementary real authenticated quota and auth503 identical-request recovery proofs at source `0c89987` after fresh independent installed/workspace evidence and an actual rebuilt native-removal semantic failure. Gate A retains first201/201 under observed writer contention with exact quota, receipts and one sink message. Gate B retains actual precommand503 with zero effects, then one identical-request201 on the same live clients after the holder closes. These proofs preserve the existing S9 unavailable contract and do not promise zero transient authentication failures. Native Worker runtime acceptance remains unproven. Operator deployment and DNS lanes 9 and 10 remain blocked.

Local owner and fresh independent verification passed on `0c89987`, with261unit tests, all ten semantic mutations killed/restored, installed native/API/encryption proofs, complete local browser/CLI/skill gates, four guarded Worker builds and fresh32.88second media. Exact Linux CI40209329855 passed all three verification jobs within unchanged budgets, with production skipped. Isolated timing and root raw-state reconciliation pass the original budgets. The150successful samples match150receipts/current grants and50message projections; parent/head plain p95 are5.133125/4.443459ms and head notify p95 is5.133042ms. Five blocks and the excluded profile remain retained. The first aggregate-only passing run is retained with its evidence limitation; the single corrected pass adds post-run state projections without changing timed work. No speedup is claimed. Reports are `/tmp/artifacts-sharing-codex/s10-integration-owner-report.md` and `/tmp/artifacts-sharing-codex/s10-review-report.md`. Root recomputation is `/tmp/artifacts-sharing-codex/s10-perf-root-recompute.json`. Complete native Worker runtime remains an explicit unproven dimension; final bundles and dry runs do not replace production lane9. Production/DNS and named operator visual approval remain unmet.

**Files.**

- [x] Edit `packages/artifacts/src/index.ts`.
- [x] Edit `packages/config/src/email.ts`.
- [x] Edit `apps/mcp/src/http.ts`.
- [x] Verify the existing generic share route in `packages/rest/src/index.ts` forwards the new command/result without a transport-specific branch.
- [x] Edit `packages/client/src/index.ts`.
- [x] Edit `apps/cli/src/index.ts`.
- [x] Edit `apps/dashboard/src/components/share/ShareForm.tsx`.
- [x] Edit `docs/deployment.md`.
- [x] Edit `.agents/skills/verify-artifacts/features/sharing.md`.
- [x] Create `scripts/verify-deployed-sharing.ts`.
- [x] Add focused invitation and contention tests while retaining the existing `tests/sharing.test.ts` regressions.
- [x] Integrate the source-pinned current-version native statement-error reset, host preparation/provenance, normal resolution and strict ESM/CJS/Config/data regressions. Remove the insufficient SDK-only patch after proof. Preserve journal and retry budgets.
- [x] Preserve portable package output and add an opt-in native-fixed private server profile with installed-server proofs. Keep seven package identities and public release eligibility unchanged.
- [x] Prove native Linux CI, actual private-profile selection and the two complementary real API gates before root countersign. No runtime hook, consumer compiler, silent fallback or native publication service.
- [x] Edit canonical contracts for notify, requireNew, separate share command result and immutable notification union.
- [x] Edit access receipt metadata and add a pure invitation renderer.
- [x] Add owner-only invitation budget schema and generated0004migration/meta.
- [x] Add conditional Node/Worker email sender entries and exact runtime/fixture wiring, including standalone REST.
- [x] Edit progressive share parsing/dialog/native outcome handling while preserving plain legacy behavior.
- [x] Edit auth/MCP/panel email bindings and release preflight to validate effective declared text plus secrets.
- [x] Extend `scripts/build-workers.ts` to reject the Node file-email adapter and `node:fs` imports in final Worker bundles. Preserve existing network/database guards and prove the dynamic-import regression is rejected.
- [x] Update the CI secret contract, affected API/client/CLI README and bundled CLI skill/reference.
- [x] Add real local deployed-verifier, concurrency, quota, transport, browser and packed retry proofs.

**Build.**

- [x] Add an optional `notify` flag to `share`. When set, send an invitation with the publication URL. Rate-limit invitations per owner.
- [x] Expose `notify` in `artifacts_share`, the REST body, the client, `pnpm artifacts share --notify`, and a **Avisar por correo** checkbox in `ShareForm`.
- [x] Add the sender secrets, SPF, and DKIM records to `docs/deployment.md`.
- [x] Write `scripts/verify-deployed-sharing.ts`. It takes two stored browser states, shares, opens as the guest, revokes, and checks the guest's next request returns 403.

**You see.**

- [x] Sharing with **Avisar por correo** checked puts one invitation in the sink with the publication URL.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Focused `tests/invitations.test.ts` and `tests/invitation-concurrency.test.ts` cover `notify` sending one message, no message without `notify`, exact retries sending no second message, the per-owner allowance, caps and actual process races. Keep `tests/sharing.test.ts` unchanged as a compatibility regression. Run `node --import tsx --test tests/sharing.test.ts tests/invitations.test.ts tests/invitation-concurrency.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes at the PR head, per the boot recipe. The configured owner is gpt-6-astra and the fresh independent reviewer is gpt-6.1-sol; production and DNS lanes remain operator-blocked.

- [x] Lane 1. Regression lane against trunk. Share without `notify` at trunk and head. Trunk lacks invitations, so record that and gate a `notify` share whose emailed link leads the guest to the publication at head. Save `share-trunk.png`, `share-head.png`, and `invite-flow.png`. Pass when both plain shares behave the same and the guest reaches the revision from the email.
- [x] Lane 2. Share from the panel with **Avisar por correo** checked. Save `invite-sink.png`. Pass when the sink holds one invitation with the publication URL.
- [x] Lane 3. Open the emailed link as a signed-out guest and sign in by code. Save `invite-signin.png`. Pass when the guest lands on the publication.
- [x] Lane 4. Send invitations past the per-owner limit. Save `invite-limit.png`. Pass when the share succeeds and the over-limit invitation is skipped with a visible notice.
- [x] Lane 5. Call `artifacts_share` with `notify: true`. Save `mcp-notify.png`. Pass when the sink holds one invitation.
- [x] Lane 6. Run `pnpm artifacts share <id> --email <guest> --notify`. Save `cli-notify.png`. Pass when the sink holds one invitation.
- [x] Lane 7. Retry a `notify` share with the same `requestId`. Save `notify-retry.png`. Pass when the sink still holds one invitation.
- [x] Lane 8. Render the invitation HTML in a browser at 390 and 1440 pixels. Save `invite-390.png` and `invite-1440.png`. Pass when the link and the owner's name are visible without overflow.
- [ ] Lane 9. After the operator deploys, run `scripts/verify-deployed-sharing.ts` against production with two operator-supplied states. Save `deployed.png`. Pass when share, open, and revoke all pass. Mark the lane blocked until the operator deploys.
- [ ] Lane 10. Run `dig TXT` for the SPF and DKIM names in `docs/deployment.md`. Save `dns.png`. Pass when both records match the document. Mark the lane blocked until the operator adds the records.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. The p95 latency of a share without `notify` at trunk and head. Trunk lacks invitations, so also measure the p95 of a `notify` share with the file sink at head.
- [x] Probe. Run 50 plain shares alternating between the trunk run and the head run. Run 50 `notify` shares at head under the limit.
- [x] Baseline. Record the trunk plain-share p95 first.
- [x] Rule. Fail when head plain-share p95 exceeds trunk by more than 10 percent and 3 ms. Fail when the `notify` p95 exceeds 300 ms locally.

**Review gate.** The operator reviews before merge.

- [x] Copy lane 2, 3, and 8 screenshots into `.test-artifacts/review/S10-review-<slug>.png`.
- [x] Record a 30 to 60 second video of a `notify` share from the panel through the guest's sign-in on a lane run. Save it as `.test-artifacts/review/S10-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at stack-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [x] Bugbot triage done. Root read all comments, reviews and inline threads at `0c89987`; all are empty.
- [ ] Chain rebased by the root after the verdict, patch-id unchanged.
- [ ] The root appends S10 to the chain. The operator lands it bottom-up and deploys.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names, with links to the stack root and tip and a one-line verdict per link.

## Appendix A. Prototype evidence

The S6 admission prerequisite passed on 2026-10-25 UTC. The local throwaway branch is `codex/sharing-s6-admission-spike`, commit `d253377d23f8b2fc6f584241d2b2b75ec8c80632`, based on verified S5 `f537c64a8db11cbef5de4d2fcf6ba47181079613`. Reproduce with `node --import tsx --test apps/auth/src/email-code-admission.prototype.test.ts` in `/tmp/artifacts-sharing-codex/s6-spike`. The retained source and reproduction guide are committed locally; no prototype PR or push exists.

All 21 cases pass through loopback HTTP and the typed server API. A correctly hashed and unexpired test code creates a user and session without the admission hook. The same valid representation succeeds for admitted controls and receives exact 400 `INVALID_OTP` for uninvited new or revoked existing accounts with the hook. Denials preserve user/session counts, verification state and credentials, and issue no cookie. Active shares on unpublished artifacts admit. Former invitees retain code admission while owning an artifact and lose it after deleting their last artifact when no other admission condition remains. Root repeated the 21-case command.

Evidence is `/tmp/artifacts-sharing-codex/s6-spike-report.md`, `s6-spike-evidence/metadata.json`, `green.log`, `red-hook-disabled.log`, and `root-repeat.log`. All temporary databases and loopback services were removed. The selected production boundary is the before-redemption admission hook.

The experiment also observes the dependency deleting an unverified configured owner's password credential during ordinary OTP promotion. Password preservation, cleanup contention, counters, Worker lifetime, response timing and delivery remain mandatory S6 implementation checks. This prerequisite does not claim those gates pass.

## Appendix B. Operator decisions and alternatives rejected

The operator answered all three on 2026-10-24.

1. Email provider. The operator chose Cloudflare Email Service, because the deployment already runs on Cloudflare. Resend lost. The choice sets the provider in `packages/config/src/email.ts` and the DNS records in S10.
2. Admission. The operator accepted invite-only now and open sign-up later, together with billing. Open sign-up now would remove the admission check from S6 and needs abuse controls this plan does not include.
3. Guest accounts. The operator accepted that a guest gets a normal account and can create artifacts. Restricting guests needs a role model that does not exist yet. S9 lane 10 checks the default. On 2026-10-24, the operator also confirmed that a former invitee retains code sign-in while owning at least one artifact. Normalized `OWNER_EMAIL` always qualifies. Existing accounts without owned artifacts or an active invitation do not qualify.

Rejected approaches follow.

- Magic links instead of codes. A code works when the guest reads the email on another device, and it reuses the OAuth flow the sign-in page already has.
- Signed public links. They leak when forwarded and cannot be revoked per person.
- Domain shares in this program. A verified email at a domain proves control of one mailbox, not membership in the company. Domain shares need DNS-verified organizations and come with the enterprise plan.
- One large PR for the store, authorization, and transports. S1 and S2 are separate so the schema lands before any read path changes, and a regression in S2 bisects to authorization alone.

## Appendix C. Risks

- S2 widens who can read a publication. A missed owner check leaks history or export. The S2 authorization audit lane and unit cases for `history` and `export` cover it. S2 runs on the strongest judgment model.
- S2 adds a share lookup to every publication read. The S2 perf rule bounds it at 5 ms over the owner path.
- S6 can turn code sign-in into open sign-up. Appendix A's spike gates it, and S6 lane 3 and lane 8 check it.
- S6 can reveal which emails are invited through response differences or timing. S6 lane 3 compares the bodies. The owner also compares response times for invited and uninvited emails.
- This host lacks `cursor-team-kit`, so `control-ui`, `control-cli`, and `deslop` are unavailable. Lanes drive the browser through `verify-artifacts` and `playwright-cli`. Every PR records this.
- The `verify-artifacts` launcher creates only one owner. S2 adds the guest account to the `sharing` drive. Every later lane depends on that drive.
- S10 lanes 9 and 10 need a deploy and DNS changes. Both are irreversible external actions that wait for the operator.

## Appendix D. Links and reading list

Read these before editing.

- `docs/decisions/identity.md`, `docs/decisions/artifacts.md`, and `docs/decisions/rest-cli.md`.
- `packages/artifacts/src/index.ts` around `issuePublicationGrant`, `consumePublicationGrant`, and `readPublished`.
- `apps/publication/src/http.ts`, the read route and the `ownerId` comparison.
- `apps/auth/src/auth-core.ts` and `apps/auth/src/pages.ts`.
- `apps/dashboard/src/components/move/MoveDialog.tsx` for the progressive dialog pattern.
- `.agents/skills/verify-artifacts/SKILL.md` and `features/publication.md`.

Run `/Users/argote/Documents/dev/artifacts/.claude/skills/how/SKILL.md` before S2 and S6. Run `/Users/argote/Documents/dev/artifacts/.claude/skills/interrogate/SKILL.md` on the S2 and S6 designs before their owners write code. Keep the decision trail per `/Users/argote/Documents/dev/artifacts/.claude/skills/show-me-your-work/SKILL.md` and commit it, because the program spans many PRs.

The sharing rules that `docs/decisions/sharing.md` records are below.

- An email share matches when the viewer's email is verified and equals the share value. Values are stored in lowercase.
- A viewer sees the published revision and its attachments. History, export, editing, project moves, and the owner's account details stay owner-only.
- Only the owner manages shares, under `artifacts:publish`. Each mutation uses the existing `requestId` receipts.
- No unpublish operation exists. A share on a never-published artifact is kept, and viewers get 404 until the owner publishes it. Publishing a new revision keeps every share.
- Deleting an artifact deletes its shares.
- Enterprise domain shares need a DNS TXT-verified domain, never match free-mail domains, match exactly without subdomains, and add `domain` to `artifact_share.kind` without changing email shares.
