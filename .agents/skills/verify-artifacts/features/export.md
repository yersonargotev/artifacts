# Historical export

An owner downloads the original complete snapshot of an explicitly selected retained revision, even after saving a newer one. Browser and MCP exports of the same revision produce identical ZIP bytes with content, attachments, metadata, and revision provenance.

## Sub-features

- `export-selected` downloads the currently displayed revision from the detail page's action.
- `export-history-entry` downloads a revision from its history-row link; this is a distinct extended entry point.
- `export-historical` retains revision 1's content and files after revision 2 exists.
- `export-mcp` exports an explicit retained revision with `artifacts_export`.
- `export-equality` compares actual browser ZIP bytes with the MCP archive and inspects its manifest/members.
- `export-anonymous` denies unauthenticated panel export; extended browser proof covers this path.

## How to get to it (user POV)

- Open an artifact in the panel, open its title menu, and choose `Descargar revisión N`.
- In `Historial`, choose a revision row's `Descargar revisión N` link directly.
- Select `Ver revisión 1`, then download that historical revision from its detail action.
- Ask a connected MCP client to invoke `artifacts_export` with the artifact ID and explicit retained revision ID.

## Driving it with control.ts (Playwright + HTTP MCP)

Preconditions:

- `.test-artifacts/verify-artifacts/export-run` does not exist before launch.
- Use a fresh disposable account and artifact. The archive comparison requires exact retained revision IDs, not whichever revision is newest.

- **Launch and inspect.** Run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --run .test-artifacts/verify-artifacts/export-run`, then `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts doctor --run .test-artifacts/verify-artifacts/export-run`.
- **Create retained revisions.** Run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts drive export --run .test-artifacts/verify-artifacts/export-run`. The recipe creates revision 1 and saves revision 2 through real HTTP MCP. Its first heading is `Verification revision 1`; `notes.txt` contains exactly `Revision 1 attachment.\n`.
- **Select and download.** The same drive opens the exact `Verification artifact` title link and chooses `getByRole('link', { name: 'Ver revisión 1', exact: true })`. It opens `getByRole('button', { name: 'Menú de Verification artifact', exact: true })`, registers the download event, and chooses the exact `Descargar revisión 1` menu item. The drive saves the download as evidence.
- **Compare to MCP.** The same drive calls `artifacts_export` with revision 1's explicit ID. Its decoded archive must equal the browser download byte for byte and its SHA-256 must match the returned hash.
- **Inspect original content.** The same drive reads the ZIP members. `artifact.json` identifies the original artifact and revision; `content.html` retains revision 1; `files/notes.txt` retains the exact original attachment. These read results prove historical retention independently of the newer preview.
- **Retain proof and stop.** Inspect `.test-artifacts/verify-artifacts/export-run/export/browser-revision-1.zip`, `mcp-revision-1.zip`, `actions.jsonl`, `result.json`, browser snapshots/screenshots, and `trace.zip`, then run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts cleanup --run .test-artifacts/verify-artifacts/export-run`. Confirm the downloaded proof remains readable after cleanup.

## Gotchas

- The selected detail menu and its history row have identical download names. The menu item targets the selected revision; it does not prove the separate history-row link.
- Register `waitForEvent('download')` before clicking. Saving an HTML response or inspecting a successful link does not prove a browser download.
- The MCP output is base64 ZIP data. Compare decoded bytes, not the base64 string or filenames alone.
- ZIP members use `files/` for attachment paths. The manifest's revision provenance and metadata must identify the selected historical revision.
- The fixed drive does not prove every content extension, nested/binary attachment, repeated browser download, anonymous export denial, or the direct history-row action. `tests/artifact-browser.proof.ts` covers binary historical export and anonymous denial using store fixtures.
- `scripts/verify-deployed-artifact.ts final` additionally compares the deployed panel ZIP with an actual Codex export from the live acceptance flow. The local helper does not establish that CLI path.
