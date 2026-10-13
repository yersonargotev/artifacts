# Authoring and publication selection

A connected tool creates an artifact, saves complete immutable revisions, retrieves retained content, and selects which revision appears at a stable protected publication URL. Stale expected versions and conflicting retries must not silently overwrite retained work.

## Sub-features

- `authoring-create` creates a complete snapshot through `artifacts_create`.
- `authoring-read-list` finds the artifact with `artifacts_list` and reads its exact snapshot with `artifacts_read`.
- `authoring-update` saves revision 2 with revision 1 as its parent and preserves attachments.
- `authoring-history` retrieves both complete retained revisions with `artifacts_history`.
- `authoring-retry-conflict` confirms matching create retries and rejects a stale expected revision; changed retry arguments are extended coverage.
- `authoring-publish` selects a retained revision with `artifacts_publish`; stable republication is mapped in [publication](./publication.md).
- `authoring-client-entry` performs the same operations from Claude Code or Codex; the local HTTP drive does not cover this live-client entry.

## How to get to it (user POV)

- Connect the Artifacts HTTP MCP in Claude Code or Codex, complete its account OAuth login, and ask the client to invoke the named tools.
- Create with a unique `requestId` and a complete `snapshot` containing `metadata`, `content`, and `files`.
- Read or list artifacts; update using the current `expectedRevisionId`; inspect retained revisions through history.
- Publish an explicit retained `revisionId` with `expectedPublicationVersion: 0` for first publication, then the current version for later publication.
- Open the returned URL or use the panel's `Abrir publicación` link. The panel has no create or content edit form.
- To publish from the panel, select a retained revision and choose `Publicar revisión N` in the header. The form pins that revision and the observed publication version. The confirmation reports the independent publication readback.

## Driving it with control.ts (Playwright + HTTP MCP)

Preconditions:

- `.test-artifacts/verify-artifacts/authoring-run` does not exist before launch.
- The disposable MCP identity has `artifacts:read`, `artifacts:write`, and `artifacts:publish`. Its registration/token setup is distinct from artifact creation proof.

- **Launch and inspect.** Run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --run .test-artifacts/verify-artifacts/authoring-run`, then `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts doctor --run .test-artifacts/verify-artifacts/authoring-run`. Require owned services and valid MCP `whoami`.
- **Execute authoring.** Run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts drive authoring --run .test-artifacts/verify-artifacts/authoring-run`. The recipe sends actual HTTP MCP `tools/call` requests rather than invoking store setters. Its artifact is titled `Verification artifact`, its first HTML heading is `Verification revision 1`, and its `notes.txt` bytes include the trailing newline in `Revision 1 attachment.\n`.
- **Verify retention.** The same drive updates with revision 1's ID as `expectedRevisionId`, then reads and retrieves history. The updated revision has revision 1 as its parent, history returns the two revision IDs newest first, and historical revision 1 still contains its original complete snapshot and attachment bytes.
- **Verify write safeguards.** The same drive retries `artifacts_create` with identical arguments and requires the identical result. It then attempts an update with revision 1's stale expected ID and requires a conflict. Subsequent history and publication readback must identify the retained revision IDs rather than an extra revision from either attempt. Changed-argument retries, competing simultaneous writers, and stale publication versions are extended cases.
- **Select publication.** The same drive publishes revision 2 with `expectedPublicationVersion: 0` and reads the artifact again to verify the publication pointer equals that returned revision ID. Republication at an unchanged URL and opening the browser document are separate obligations in [publication](./publication.md).
- **Retain proof and stop.** Inspect `.test-artifacts/verify-artifacts/authoring-run/authoring/actions.jsonl` and `result.json` for the MCP calls, assertions, and read results, then run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts cleanup --run .test-artifacts/verify-artifacts/authoring-run`. Confirm those records survive cleanup.

## Gotchas

- Updates replace the entire snapshot. Sending only the changed text would not prove preservation of metadata or files.
- Preserve the `requestId` and arguments for a retry. Use a new ID for a different mutation; a successful retry is not evidence that a new revision was saved.
- A publication pointer can differ from the newest draft revision. Confirm both the draft head and publication selection; publishing does not move the draft head.
- The local helper establishes HTTP MCP behavior with fixture OAuth setup. It does not run Claude Code or Codex, their login flow, or their model-provider sessions.
- `scripts/verify-artifact-clients.ts` records actual Claude creation and Codex modification in its separate live acceptance flow. Its environment and retained writes require an explicitly authorized live task.
- Store-based assertions in `tests/artifacts.test.ts` and browser fixture seeding are useful contract coverage, but are not substitutes for public MCP authoring evidence.
- Changed-argument request-ID conflicts, matching update/publication retries, stale publication versions, large limits, permissions for read-only clients, list/history pagination, and simultaneous competing clients need their own executed path and evidence; do not infer them from one local authoring run.
