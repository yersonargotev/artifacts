# Sharing program session handoff

## Current state — 2026-10-26

The S1–S10 sharing program, Resend provider replacement, and release integration are complete. GitHub confirms PR38–50 are merged. Local and remote `main` match `4bda6a1d42cbee362829a3833933d9edc4b048a0` at this review.

| Item | Verified state |
| --- | --- |
| Sharing implementation | S1–S10, PR38–47, merged |
| Sending provider | Resend, PR48, merged; Cloudflare remains the hosting provider and SpaceMail reception is preserved |
| Release integration | PR49, merged at `355b0f85ff3588ed77783cfa7fef255eaa823b8b` |
| Release equivalence | The entire `355b0f8` Git tree equals release `d1a82a6f987b692094b7717c2aa53ba97f332ecc` |
| CI follow-up | PR50, merged at `4bda6a1`; its entire tree equals local CI branch head `de8b41c` |
| Visual approval | S10 approval recorded at `12b84c5`; no renewed approval is needed for those historical visuals |
| Latest CI observation | Run [40270082631](https://github.com/yersonargotev/artifacts/actions/runs/40270082631), at `4bda6a1`, was in progress during cleanup preflight; it is not claimed successful here |

No new product work, deployment, email, DNS change, package publication, or S11/S12 phase was performed by this cleanup.

## Completed release evidence

The retained release record documents deployment of all four Workers at `d1a82a6`, additive migrations, and a controlled real invitation/code sign-in proof. Resend recorded one delivered invitation. Guest access, owner-only data denial, and revocation passed; disposable verification resources were cleaned. These are historical release results, not a new production validation in this cleanup.

Exact release CI [40223765252](https://github.com/yersonargotev/artifacts/actions/runs/40223765252) and integrated-main CI [40265886353](https://github.com/yersonargotev/artifacts/actions/runs/40265886353) passed. The shipping record documents production policy restoration and removal of merged remote refs. The later `4bda6a1` workflow has its own status and must not inherit an earlier run's success.

Retained evidence outside the removed worktrees remains at:

- `/tmp/artifacts-production-resend/`: deployment and migration receipts, private database backup, bundle manifest, review, and cleanup receipts.
- `/tmp/artifacts-shipping/`: final readback, production policy restoration, per-PR merge receipts and verdicts, supplemental PR38 CI, and final trail audit.
- `/tmp/artifacts-sharing-codex/`: native repair reports, source reviews, measurements, and review media.
- `/tmp/artifacts-resend/`: provider design, verification, review, and runtime-secret receipt.

These local paths are not distributed by Git. Some historical reports reference paths inside removed worktrees; use the archive mapping below to recover those files. Preserve the private database backup and operational evidence outside the repository.

## Retained technical limits

Invitations make one bounded postcommit attempt. `requested` is not a delivery guarantee, a crash before that attempt can lose the message, and exact receipt replay never resends.

The original SDK `@libsql/client` 0.18.0 is preserved. The accepted native repair is the pinned libsql-js 0.5.29 Rust statement-error reset, not the superseded SDK patch or rejected alternative backends. See [the native integration documentation](../../native/libsql/README.md). The portable distribution retains its documented native lifecycle limitation; the private native-fixed profile is target-qualified. Accepted targets were Darwin arm64 and Linux x64 glibc 2.39. Other targets and full native Worker capability are not inferred from the bounded deployed proof. Performance figures remain local measurements, not production latency or speedup claims.

## Local preservation and worktree cleanup

The authorized cleanup preserves local branches, `refs/shipping/*`, and `stash@{0}` (six Panel C planning files absent from remote main). It does not merge obsolete prototypes into the product.

The private archive is `/Users/argote/Documents/dev/artifacts-archives/cleanup-20261026T045255Z`. It contains:

- `repository.bundle`, verified before cleanup, preserving all Git refs including the stash and prototype branches.
- `documents-before/`, the four local planning files before reconciliation.
- `worktrees-before.json` and `manifest.json`, mapping original worktree paths and heads to numbered archives, with per-file and archive SHA-256 checks.
- One source/evidence archive per secondary worktree, including modified, untracked, and ignored evidence files. Generated dependency/build directories (`node_modules`, `dist`, `.native`, `.astro`, `.worker`) and Git administrative pointers are excluded; tracked files are retained even under those directory names.
- `cleanup-result.json`, the final removal and retention record.

Archive contents were read back and compared with the per-file hashes before removal. Backups are private local files, not Git-tracked assets. To recover a removed worktree, locate its original path in `manifest.json`, create a worktree at its recorded `HEAD` using the retained Git objects, and extract that archive into it. Rebuild native output and install frozen dependencies using the repository's documented workflow.

Cleanup completed: 43 secondary worktrees were removed after verified backup. The two orphan Playwright previews (`s10-owner-preview` and `s10-guest-preview`) were stopped first. The main checkout remains, along with `/Users/argote/Documents/dev/artifacts/.claude/worktrees/agent-adec00fe126b6d2c7`: its lock belongs to the still-running Claude process 64001, so that checkout and session were not disturbed. Its source is also backed up. Remove it only after its owning session releases it. Local `.git/info/exclude` excludes `/.claude/worktrees/` from the parent checkout; repository ignore rules are unchanged.

## Historical records

- [Session history](sharing-session-history.md): original continuation checkpoints, deployment chronology, media references, and evidence limitations.
- [Implementation handoff](sharing-implementation-handoff.md): historical owner/reviewer prompts and the S4–S10 stack.
- [Execution plan](sharing-plan.md): original implementation/verification checklist, explicitly archived.
- [Decision trail](sharing-decisions.tsv): append-only decisions through shipping and cleanup.

Start any future work from current `main` and a newly scoped requirement. Do not resume the historical stack, repeat completed visual approval, or treat old blocked gates as current tasks. Check current CI/deployment state separately if the new task needs it.
