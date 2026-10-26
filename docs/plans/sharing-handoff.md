# Sharing program handoff (S4 to S10)

This file hands the rest of the email sharing program to other agents. Each section below is a prompt you paste into a fresh agent. The agent needs shell access to this repository and the `gh` CLI.

The plan is `docs/plans/sharing-plan.md`. The decision trail is `docs/plans/sharing-decisions.tsv`. Both are untracked in the main checkout at `/Users/argote/Documents/dev/artifacts`. An agent on another machine or in the cloud cannot read them until you commit them.

## Where the chain stands

| PR | Branch | Verified head | State |
|---|---|---|---|
| S1 [#38](https://github.com/yersonargotev/artifacts/pull/38) | `feat/sharing-s1-share-table` | `278ea9c` | Clean, base `main` |
| S2 [#39](https://github.com/yersonargotev/artifacts/pull/39) | `feat/sharing-s2-viewer-authorization` | `43eb363` | Clean, base S1 |
| S3 [#40](https://github.com/yersonargotev/artifacts/pull/40) | `feat/sharing-s3-mcp-tools` | `f36cd07` | Clean, base S2 |
| S4 [#41](https://github.com/yersonargotev/artifacts/pull/41) | `feat/sharing-s4-rest-client` | `8cf6433` | Clean, base S3 |
| S5 [#42](https://github.com/yersonargotev/artifacts/pull/42) | `feat/sharing-s5-cli` | `f537c64` | Clean, base S4 |
| S6 [#43](https://github.com/yersonargotev/artifacts/pull/43) | `feat/sharing-s6-email-otp` | `c5cc8da` | Clean, base S5 |
| S7 [#44](https://github.com/yersonargotev/artifacts/pull/44) | `feat/sharing-s7-signin-form` | `323d1f8` | Clean after operator media approval, base S6 |
| S8 [#45](https://github.com/yersonargotev/artifacts/pull/45) | `feat/sharing-s8-share-dialog` | Pending | Fix required at `e3b6ccb`, base S7 |

Start S4 from `f36cd07819eafaee7c04cd7c808cf5bb9087e995`. Each later PR branches from the previous PR's verified head and targets that branch.

`main` moved after S1 branched (PR #37). S1 still merges cleanly. Rebase the chain bottom-up onto `main` right before landing, not during the build.

## Shared context

Paste this block at the top of every owner and reviewer prompt.

```text
Repository: /Users/argote/Documents/dev/artifacts (pnpm 12, Node 24, zsh with noclobber, so overwrite with >|).
Plan: docs/plans/sharing-plan.md. Read "How to read this", "PR mechanics", "Boot recipe", your PR's section, and Appendix D.
Decision trail: docs/plans/sharing-decisions.tsv. Append one row per real decision with
  sh .claude/skills/show-me-your-work/scripts/log.sh docs/plans/sharing-decisions.tsv <phase> <decision> <why> <evidence> <result>
Your first row uses phase "start" and names you and your PR.

Facts already proven in S1 to S3. Do not re-litigate them.
- No unpublish operation exists anywhere. A share on a never-published artifact waits until the owner publishes.
- A viewer without access sees one of two denials. A fresh open ends at the panel's /publication/open with 404 and "No se puede abrir este artefacto." A request that still holds a viewer cookie gets the Worker's 403 and the cookie is cleared.
- Shares: store methods share, unshare, listShares in packages/artifacts/src/index.ts. Schemas shareSchema, unshareSchema, listSharesSchema, shareResultSchema live in packages/contracts/src/index.ts. Values are trimmed and lowercased. Duplicate shares return the existing row. Each mutation uses requestId receipts.
- A missing artifacts:publish scope returns forbidden with requiredScope, not insufficient_scope. Match whatever the existing operations on your transport return.
- Guests get SharedRead (artifactId, publication, revision id, createdAt, sha256, snapshot). Owners keep the full ArtifactRead.
- Local live runs use .agents/skills/verify-artifacts/scripts/control.ts: launch, doctor, drive <feature>, account --email X [--unverified], cleanup. Always clean up every run. Runs stop themselves after 15 minutes and their MCP token lasts 5 minutes.
- The run database is at $TMPDIR/artifacts-identity-*/identity.db. Find it with lsof on the supervisor PID. Use SELECT only.
- drive sharing creates a verified guest, shares through MCP artifacts_share, and checks admission, revocation, and re-share.
- The local publication server sends the 403 text without a charset, so Chrome shows garbled accents. This is known and not a defect.

PR mechanics.
- The active gh account cannot see the repo. Prefix every gh call with GH_TOKEN=$(gh auth token -u yersonargotev) and pass -R yersonargotev/artifacts.
- If the branch you need is checked out in another worktree, create a local branch with another name and push with git push origin <local>:<remote-branch>. Confirm the remote head first. Fast-forward only.
- Open PRs ready, never draft, with base set to the parent PR's branch.
- CI runs automatically only on PRs into main. Dispatch it for a stacked branch with gh workflow run ci-cd.yml --ref <branch>. Its production job runs only on push to main, so a dispatch cannot deploy.
- PR body follows .claude/skills/poteto-mode/playbooks/opening-a-pr.md. Sections: Why, What changed, Scope (1 to 3 items, no paths), Tradeoffs (deviations go here), Blast Radius (1 to 2 sentences), Verification (at most 3 bullets, one primary perf number before -> after).
- Never merge, retarget, rebase onto another branch, arm auto-merge, close a PR, deploy, or change DNS. Stop and report instead.
- Add no comments that restate code. Remove dead code you create.
```

## How to verify each PR without spending the full budget

The plan asks for a ten-lane swarm, a perf lane, and two audits per PR. That cost about eight agents per PR. Use this lighter protocol instead. It keeps the checks that found real defects in S1 to S3.

1. The owner proves the change.
   - Every new test fails on the parent head first and passes after. Paste both runs.
   - `pnpm check` and `pnpm test` pass.
   - The owner runs `drive sharing` plus the plan lanes for its PR that need a browser or a real token. Mark each lane PASS, ISSUES, or BLOCKED with its evidence path.
   - The owner runs the plan's perf rule once with interleaved trunk and head runs.
2. One reviewer agent, on a different model from the owner if you can, runs the reviewer prompt below.
   - It reads the diff and the PR body against the plan.
   - It runs a handful of mutations on the new code and reports which survive.
   - It reruns two or three of the riskiest lanes itself.
3. Findings go back to a fresh owner as one fix-forward commit. A docs-only or test-only fix needs only a diff read.

The audits in S1 to S3 caught real problems each time: a privacy leak through receipt hashes, untested authorization guards, a plan that assumed a missing unpublish operation, stale READMEs, and a tool schema that hid the email format. Keep the reviewer step.

## Owner prompt template

Fill the angle brackets from the PR sections below.

```text
<Shared context block>

You own <PR id>: <title>. Build exactly the plan section "<plan heading>" and nothing from later PRs.
Base: branch from <parent branch> at <parent verified SHA>. Name your branch <branch>. Open the PR against <parent branch>.
Extra instructions learned in earlier PRs:
<notes for this PR>

Before code, name the data shapes your change adds or changes.
Follow the verification protocol in docs/plans/sharing-handoff.md, step 1.
Report: PR URL, head SHA, files changed, data shapes, red-then-green evidence, gate summary lines, each live lane with its evidence path, perf numbers or BLOCKED with the reason, CI run URL and result, deviations from the plan, and what you did not verify. Mark each claim measured or inferred.
```

## Reviewer prompt template

```text
<Shared context block>

You review <PR id> at <head SHA>, base <parent SHA>. You did not write this code. Distrust the PR body.
Read only in the PR's code. Put scratch scripts and copies under a new scratch directory.
1. Read the diff and the plan section "<plan heading>". List each deviation and whether it is justified.
2. Run 5 to 10 mutations on the new logic in a scratch copy, for example: drop a guard, swap two handlers, return undefined, skip a scope check. Report which survive.
3. Rerun these lanes yourself: <two or three lane numbers>.
4. Check that every doc the PR touches matches the code, and that the PR body follows the opening-a-pr playbook.
Report PASS or ISSUES. Each issue needs a file and line, a concrete scenario, and its proof. Label anything you could not prove as a note.
```

## S4. REST and the typed client

- Plan heading: "Expose sharing through REST and the typed client (S4)".
- Parent: `feat/sharing-s3-mcp-tools` at the S3 verified head. Branch `feat/sharing-s4-rest-client`.
- Notes:
  - Read how `packages/rest/src/index.ts` maps a missing scope today and match it. The plan's lane 6 says 403 `insufficient_scope`. Fix the lane text in your report if the code says otherwise.
  - `packages/client` imports only from `packages/contracts`. The share schemas already live there.
  - Update `packages/rest/README.md`. Leave the root `README.md` to S5.
- Riskiest lanes for the reviewer: 4, 6, and 9.

## S5. CLI commands

- Plan heading: "Add CLI share commands (S5)".
- Parent: `feat/sharing-s4-rest-client`. Branch `feat/sharing-s5-cli`.
- Notes:
  - Route `share` and `unshare` through the existing retry receipts so `artifacts retry` replays them.
  - Update the root `README.md` tool and command lists so they include the three MCP tools from S3 and the new CLI commands.
  - `apps/cli/README.md` already describes viewer access from S2. Add the commands.
  - Run `pnpm test:cli-skills` after editing `skills/artifacts-cli/SKILL.md`.
- Riskiest lanes for the reviewer: 4, 5, and 9.

## S6. Email-code sign-in

- Plan heading: "Let invited people sign in with an email code (S6)".
- Parent: `feat/sharing-s5-cli`. Branch `feat/sharing-s6-email-otp`.
- Use your strongest model for this PR. It turns sharing on for real users.
- Notes:
  - The provider is Cloudflare Email Service, chosen by the operator.
  - Prove the Appendix A spike first: code sign-in must not create an account for an uninvited email, even with a forged code row. Record the result in the trail before other work.
  - Prove that every path that writes a `user` row stores the email in lowercase, including `emailOTP`. `canView` compares the share with `lower(user.email)`, while the unique index on `user.email` is case-sensitive.
  - Better Auth `/update-user` ignores `emailVerified`. Do not open another path that lets users set it.
  - Uninvited emails must get the same response body and similar timing as invited ones.
- Riskiest lanes for the reviewer: 3, 7, and 9.

## S7. Sign-in form

- Plan heading: "Add the email-code form to the sign-in page (S7)".
- Parent: `feat/sharing-s6-email-otp`. Branch `feat/sharing-s7-signin-form`.
- This PR is review-gated. The owner records the screenshots and a 30 to 60 second video from the plan and stops. You review them before it joins the chain.
- Riskiest lanes for the reviewer: 3, 4, and 8.

## S8. Share dialog in the panel

- Plan heading: "Add the share dialog to the panel (S8)".
- Parent: `feat/sharing-s7-signin-form`. Branch `feat/sharing-s8-share-dialog`.
- This PR is review-gated.
- Notes:
  - Follow the progressive pattern of `apps/dashboard/src/components/move/MoveDialog.tsx`, including the no-JavaScript page.
  - Fix `apps/dashboard/src/components/detail/PublicationCard.astro:10`. It says `Solo tú puedes abrir el enlace.`, which is false once a share exists.
- Riskiest lanes for the reviewer: 5, 6, and 10.

## S9. Invited person's views

- Plan heading: "Show invited people what was shared with them (S9)".
- Parent: `feat/sharing-s8-share-dialog`. Branch `feat/sharing-s9-shared-with-me`.
- This PR is review-gated.
- Notes:
  - `listSharedWithMe` can use the `artifact_share_recipient_idx (kind, value)` index from S1.
  - The guest publication page shows `Volver a la biblioteca`. Make that link lead somewhere useful for a guest, such as the new section.
- Riskiest lanes for the reviewer: 2, 5, and 7.

## S10. Invitations and deployed check

- Plan heading: "Send invitation emails and verify the deployment (S10)".
- Parent: `feat/sharing-s9-shared-with-me`. Branch `feat/sharing-s10-invitations`.
- This PR is review-gated.
- Notes:
  - Lanes 9 and 10 need a production deploy and DNS records. Only you do those. The agent marks them BLOCKED and stops.
  - Give `listShares` and invitations a sane cap per artifact and per owner. Nothing limits share count today.
- Riskiest lanes for the reviewer: 2, 4, and 7.

## Your steps between PRs

1. Read the owner's report and the reviewer's report.
2. If both pass, add a trail row with phase `verdict` and result `clean`, then start the next owner from that head.
3. If the reviewer found issues, start a fresh owner with the findings as one fix-forward commit. Then do a diff read or one more reviewer pass.
4. For S7 to S10, review the screenshots and the video before you mark the PR clean.
5. When S10 is clean, rebase the chain bottom-up onto `main` and land it in order from S1.
