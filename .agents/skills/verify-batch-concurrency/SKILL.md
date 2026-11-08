---
name: verify-batch-concurrency
description: "Model-check store.batch against concurrent creates, updates, moves, deletes, and retried batches with TLA+. Use after any change to the batch command (packages/artifacts/src/index.ts batch, packages/artifacts/src/batch.ts planBatch), receipts and replay (access.ts), project spelling, or the artifact, artifact_revision, or artifact_command schema, or when asked whether a batch can lose a write, apply twice, or report a result the database does not hold."
---

# Verify batch concurrency

`store.batch` does not use an interactive transaction. It reads the receipt, the owner's project spellings, and the named pages as three separate statements, plans with `planBatch`, and sends every write plus the receipt as one atomic `$client.batch(statements, 'write')`. Nothing inside that write request reads. The schema guards and the `moved` statement must reject every plan that a stale read let through, and the store then reads and plans again (up to 3 write requests). Tests force one race at a time; this model checks every interleaving within its bounds.

## What it checks

| Rule | In plain words | Harm if broken | Guard that keeps it |
| --- | --- | --- | --- |
| `LinearHistory` | Every revision of a page sits on one parent chain ending at the head. | A stale batch update leaves an orphan revision or forks history, and its write is lost. | `artifact_revision_sequence_idx` |
| `BatchReportsTruth` | A batch that answers success left every page it wrote at the head, project, and slug that its results report. | The caller is told a move or update happened when it did not. | `moved(...)` statement after each move |
| `SlugNamesOnePage` | A stored (project, slug) pair names at most one page. | Two pages answer to one path. | `artifact_owner_project_slug_idx` |
| `ExactlyOnce` | One request ID applies its operations at most once, even when two calls with it race or one was deleted and retried. | Duplicate pages or revisions from a client retry. | `artifact_command` primary key |

The batch head update's `where head_revision_id = parentRevisionId` (`HeadGuard`) is redundant under the model: with the sequence index present, removing it breaks no rule.

Every rule fails when its guard is removed (checked at the sync commit with `--without`). Removing `moved(actor.userId, write)` from the real code makes `race` and `retry` fail `BatchReportsTruth`.

## Known finding (the `spelling` run)

`OneSpellingPerProject` and `SlugNamesOnePageInProject` fail on the current code. Projects group by letter case (`docs/decisions/projects.md`), but only interactive commands resolve the spelling inside a serialized transaction. The batch resolves it from its read phase, and no index compares project names case-insensitively.

The shortest counterexample, in the code's terms:

1. The owner has no project. A batch `[{ op: 'create', project: 'docs', slug: 'b' }]` reads its receipt, `ownedProjects` (empty), and its pages, and plans the spelling `docs`.
2. Another client runs `store.create` with `project: 'Docs', slug: 'b'`. It sees no project, so it stores `Docs`.
3. The batch write request commits. The slug index compares `coalesce(project, '')` exactly, so `docs`/`b` and `Docs`/`b` both stand.

The owner then has two projects, `docs` and `Docs`. `read` resolves either spelling to `docs`, so the `Docs/b` page cannot be reached by its path. This was reproduced on the real store with the race hook from `tests/batch.test.ts` (an interactive create run just before the write request). The checker reports this run as `KNOWN FINDING` and does not fail on it. When a fix lands, the run reports `FINDING FIXED`; then move its rules into the `race` run in `scripts/check.ts`, delete the `spelling` run, and rewrite this section.

## Run it

```sh
node .agents/skills/verify-batch-concurrency/scripts/check.ts
```

The first run downloads `tla2tools.jar` 1.7.4 and an Eclipse Temurin 21.0.5 JRE into `~/.cache/artifacts-formal` (or `$XDG_CACHE_HOME/artifacts-formal`), checking pinned SHA-256 sums. Set `TLA2TOOLS` and `JAVA` to use your own. The full run takes about 4 minutes on 10 cores: `race` explores about 13 million distinct states and `retry` about 20 million. It exits 1 when `race` or `retry` fails or TLC does not finish.

Options: `--run race,retry` for a subset, `--without MovedGuard` (or `SeqIndex`, `SlugIndex`, `ReceiptKey`, `HeadGuard`) to model the code without a guard, `--trace` to print the known finding's counterexample, `--keep` to keep the TLC directory with the spec, generated `.cfg` files, and outputs.

The script reads the guards from the code itself: it searches the covered files for each guard's exact code and passes `TRUE` or `FALSE` to the model, and it reads the retry bound from `conflicts++ < N`. A guard that was rewritten but not removed shows as `MISSING`; check the code, and update its pattern in `scripts/check.ts` if the guard still holds.

## Read every result with pstack:statechart

Read every result with the `pstack:statechart` skill. Run with `--keep`, then give `pstack:statechart` the kept `BatchConcurrency.tla`, the `.cfg` of the run you want, and the view `model/view.ts`. Use `check.ts --env` to print the `JAVA` and `TLA2TOOLS` exports it needs. It turns each violation into its shortest path in plain words, such as "the batch reads the pages it names → another client moves a page → the batch sends its write request". For a passing run, the graph is larger than the chart budget, so expect a summary instead of a full chart.

## Did my change touch this?

The script prints every covered file changed since the sync commit. Covered code:

| File | What the model mirrors |
| --- | --- |
| `packages/artifacts/src/index.ts` | `batch` read phase, statements, retry loop; `moved`; interactive `create`, `update`, `move`, `delete` (with receipt scrubbing) |
| `packages/artifacts/src/batch.ts` | `planBatch` (`PlanOp` in the model) |
| `packages/artifacts/src/access.ts` | `replay`, `receipt`, `projectSpelling`, `claimSlug`, `projectOrder`, `writeTransaction` |
| `packages/artifacts/src/panel/model.ts` | `projectKey` |
| `packages/db/src/schema.ts` | the sequence and slug indexes and the receipt key |

Sync commit: `e29d8a2`. Move it forward in this file and in `sync` in `scripts/check.ts` only after you confirm that the model describes the covered code at the new commit.

## Real bug or modeling error

A failure in `race` or `retry` names a rule. Read its path with `pstack:statechart`, then replay the path against the code:

- If each step matches what the code does (the reads run in that order, the write request runs those statements, no guard rejects it), it is a real bug. Reproduce it with the race hook in `tests/batch.test.ts`, which commits a competing command right before the write request. Report it; do not weaken the rule.
- If a step does something the code cannot do, the model is wrong. Fix the model to match the code, not the code to match the model, and rerun.

## Update the model for an intended change

Map the change to the model before you trust a pass:

- A new batch operation or a planner rule: add it to `Ops` and `PlanOp`, and its statements to `Exec`.
- A new statement or guard in the write request: add it to `Exec`, and if it can be switched off, a constant and a pattern in `guards` in `scripts/check.ts`.
- A changed read in the read phase: change `ReadReceipt`, `ReadProjects`, or `ReadPages`. Each read is its own atomic step because each is its own statement.
- A new interactive command that writes pages: add an action that runs in one step, because `writeTransaction` serializes it.

Then confirm the new code can fail: remove the guard you rely on with `--without`, or in a scratch edit, and watch the rule break.

## Scope

Verified, within these bounds: one owner; one existing page (unfiled with slug `a`, or in project `docs` with slug `b`); project spellings `docs` and `Docs` of one key; slugs `a` and `b`; batches of 1 or 2 operations drawn from every create, update by ID or by slug (with the caller's known head or none), and move by ID; up to 3 write requests per call; in `race`, up to 2 interactive commands (create, update, move, delete) at any point; in `retry`, a second call with the same request ID and operations plus 1 interactive command.

Assumed: SQLite serializes every interactive `writeTransaction`, and `$client.batch(..., 'write')` is atomic. `SQLITE_BUSY` retries only delay a step, so they are not modeled.

Not covered: authorization and session revocation (the session is checked in the read phase only); publication, shares, and receipts of interactive commands; moves located by `from`; search rows; content limits; the busy-retry backoff; more than one owner; liveness (a batch that keeps losing races fails with `constraint_error` after 3 write requests, which the model allows).
