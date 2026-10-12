# Artifacts verification map

This directory is the maintained source for Artifacts verification. The primary surfaces are the authenticated Astro panel and the protected publication page. Authoring happens through the HTTP MCP tools, including clients such as Claude Code and Codex. Read this index and the matching feature file before driving a feature.

## Baseline preconditions

- Use the repository's installed dependencies and Node 24 or newer. The control helper uses the installed Playwright package and actual Chrome; interactive HTML requires Chrome 152 or newer.
- Run `pnpm build` before the first launch so the helper can start the built Astro panel. Complete builds while no verification instance is active.
- Start a disposable instance with `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch`. Read the JSON output for its run path and service URLs. A new run owns its database, credentials, processes, and ephemeral ports.
- Pass that same run path to `doctor`, `drive`, and `cleanup`. Require `doctor` to pass before driving. Never substitute the normal `.env`, an existing account, or a deployed service.
- Run exactly one feature drive per fresh run. Identity verification revokes all sessions for the disposable account; other drives create an artifact with the same fixed title.
- The feature files show explicit run paths for reproducibility. `launch --run` requires the path to be absent. Use a new path for subsequent runs; keep completed evidence.
- The local authorization, panel, and publication hosts are deliberately distinct. Preserve the URLs from the run rather than replacing them with the normal development ports.
- These disposable preconditions apply to the fixed `control.ts` drives. Existing retained artifacts use the separate [retained recipe](./retained.md) with an independent saved read and supplied authenticated context. That verifier has no disposable setup or mutation phase.
- Finish within the run's 15-minute lifetime. The helper reads the existing built panel; do not rebuild that shared output while verification instances are active.

## Driving conventions

- The harness is `control.ts`: fixed Playwright recipes plus JSON-RPC `tools/call` requests to the real public HTTP MCP endpoint. Run it from the repository root with `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts`.
- Each feature command performs its own health check and records actions and outcomes. The selectors below document the user path executed by that recipe; the helper does not expose a generic browser-click command.
- Use exact ARIA names for Spanish interface controls. The disposable artifact title is `Verification artifact`; its document headings are `Verification revision 1` and `Verification revision 2`.
- The HTML interaction button changes from `Try interaction` to `Interaction verified`. The attachment `notes.txt` contains `Revision 1 attachment.\n`, including its trailing newline, and is retained in revision 2.
- Authenticated setup creates a disposable identity and OAuth client. Artifact setup inside drives must use public MCP tools; direct store or database insertion is not evidence of user authoring.
- Always call `cleanup --run` for a failed or successful run. Cleanup removes owned instances and runtime secrets while preserving the proof artifacts in that run directory.

## Proof and skip reporting

- Capture the action and resulting state: MCP request/results, browser steps, screenshots, accessible structure, downloads, and assertions as applicable. A final screenshot alone does not prove a mutation or interaction.
- Evidence lives below the printed run directory: `instance.json`, `doctor.json`, and a feature-named directory containing `actions.jsonl`, `result.json`, `*.aria.yml`, `*.png`, and the browser `trace.zip` when applicable. `cleanup.json` remains after teardown. The run is private because browser traces may contain local session evidence; passwords and tokens are omitted from action logs.
- Confirm writes from another user-facing read: `artifacts_read`, `artifacts_history`, the panel, or a downloaded archive. For historical export, compare actual bytes and manifest provenance.
- Report the feature ID, entry point, run path, browser version, and any skipped checks. Do not mark a mapped entry point verified because another entry point worked.
- Local HTTP MCP proof establishes the server's transport and tools. It does not establish a live Claude Code or Codex client connection, model-provider login, or tool invocation by those CLIs.
- Existing `tests/browser.proof.ts` covers account flows. `tests/artifact-browser.proof.ts` exercises real panel/publication routes but seeds authoring through the store. `tests/publication-network.proof.ts` exercises renderer fixtures and an active UDP collector; it does not cover authentication or persisted artifact routes. Run `pnpm test:browser` for these extended local proofs.
- `scripts/verify-artifact-clients.ts` and `scripts/verify-deployed-artifact.ts` form a separate live acceptance path. They require selected deployment origins, authenticated CLI registrations and model-provider access, create retained artifacts, and write private evidence. They are outside the disposable local helper; execute them only for an explicitly authorized live acceptance task.
- `scripts/verify-turso.ts` checks a remote database and migrates it. It is infrastructure verification, not a user-path recipe, and is outside this local harness.
- Pagination, OAuth consent cancellation, inert Markdown/text rendering, attachment variants, and complete containment probes remain separate coverage obligations unless their specific path was executed and captured.

## Features

- [Identity and sessions](./identity.md): `identity` covers panel login, canonical identity, panel logout, central SSO, and global revocation.
- [Authoring and publication selection](./authoring.md): `authoring` covers real MCP creation, retained updates, retries/conflicts, reads, and publication selection.
- [Panel browsing and preview](./preview.md): `preview` covers the artifact list, revision history, actual preview iframe interaction, and mobile layout.
- [Protected publication and attachments](./publication.md): `publication` covers login handoff, the stable URL after republication, actual document interaction, attachment bytes, and anonymous denial.
- [Historical export](./export.md): `export` covers selecting an old revision and comparing its browser ZIP download with the same MCP export.
- [Exact retained artifact](./retained.md): `verify-retained.ts` and its callable library verify an existing selected revision, real policy, declarative content checks, mobile layout and complete attachment bytes without authoring or account mutation.
