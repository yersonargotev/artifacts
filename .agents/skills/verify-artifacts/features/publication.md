# Protected publication and attachments

An owner opens a published artifact at one stable authenticated URL, interacts with supported self-contained HTML, and downloads retained attachments. Publishing another revision changes the content at that URL while anonymous users remain unable to retrieve documents or files.

## Sub-features

- `publication-open` completes the panel/account handoff to the protected publication.
- `publication-interaction` interacts with the served sandboxed publication frame.
- `publication-stable-url` shows the new selected revision at the unchanged URL.
- `publication-attachment` downloads the current revision's exact attachment bytes.
- `publication-anonymous` redirects an anonymous document request to login and denies attachment bytes.
- `publication-revoked` denies an already-issued viewer after its central session is revoked; this is extended coverage outside the fixed publication drive.
- `publication-containment` blocks cross-frame, storage, navigation, HTTP, and UDP escape; use the dedicated extended proofs.

## How to get to it (user POV)

- After `artifacts_publish`, open its returned stable URL.
- In an artifact's panel detail page, the header exposes `Abrir publicación` when the selected revision is published. The title menu also links to the current publication. To select another publication, open that retained revision and choose its `Publicar revisión N` button.
- If signed out, complete the account login and return to the original publication.
- Interact with the document inside the frame titled `Contenido del artefacto`.
- Open the viewer title menu, then its native `Archivos` disclosure. Choose a filename link under the `Archivos adjuntos` navigation region. The adjacent `Información` disclosure exposes the complete title, description and revision provenance.
- Reload the bookmarked URL after another retained revision is published.

## Driving it with control.ts (Playwright + HTTP MCP)

Preconditions:

- `.test-artifacts/verify-artifacts/publication-run` does not exist before launch.
- Use the run's distinct publication host exactly as reported. Actual Chrome 152 or newer is required for this interactive recipe.

- **Launch and inspect.** Run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --run .test-artifacts/verify-artifacts/publication-run`, then `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts doctor --run .test-artifacts/verify-artifacts/publication-run`.
- **Publish and open.** Run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts drive publication --run .test-artifacts/verify-artifacts/publication-run`. The recipe creates and publishes revision 1 through HTTP MCP, opens the returned URL, fills `Correo electrónico` and `Contraseña`, and submits the exact `Iniciar sesión` button. The browser returns to the publication URL and `frameLocator('iframe')` contains the exact heading `Verification revision 1`.
- **Interact.** The same drive clicks the exact `Try interaction` button inside the publication iframe and waits for `Interaction verified`. Capture the action and changed button state in the actual served wrapper.
- **Republish.** The same drive updates through MCP and publishes revision 2. Its publication result must equal the first URL; revisiting that URL shows the exact iframe heading `Verification revision 2` rather than revision 1.
- **Download.** The same drive opens the title menu and native `Archivos` disclosure, then chooses the exact `notes.txt` link. It waits for the browser download and compares its saved bytes with `Revision 1 attachment.\n`. A working filename link alone does not prove byte preservation.
- **Anonymous denial.** The same drive opens the document in a separate unauthenticated context. The resulting page exposes `Correo electrónico` and has no artifact iframe; a current attachment request without following redirects returns 401. This drive checks the rendered login boundary and the attachment status. Exact document admission status/body checks are extended coverage, because the browser follows the document redirects.
- **Retain proof and stop.** Inspect `.test-artifacts/verify-artifacts/publication-run/publication/actions.jsonl`, `result.json`, both revision screenshots/snapshots, `trace.zip`, and the downloaded `notes.txt`, then run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts cleanup --run .test-artifacts/verify-artifacts/publication-run`. Confirm evidence remains.

## Gotchas

- A published artifact is protected, even though its URL is stable. The publication host deliberately differs from the panel and authorization hosts; preserve that cookie separation.
- The draft head and published revision can differ. `artifacts_publish` and the panel publication form select what the stable URL serves. Neither advances the draft head.
- Attachment URLs include a revision ID. An old attachment URL after republication is denied; use the current page's filename link rather than reusing an old link.
- A download must preserve bytes, serve as an attachment, and avoid execution. Binary/nested attachments, obsolete attachment links, and content-disposition checks are additional cases in `tests/artifact-browser.proof.ts`.
- The fixed drive covers the returned publication URL. The panel's `Abrir publicación` link is a distinct entry point; report it unverified unless actually clicked.
- Revocation, backend-failure 503 behavior, callback replay, and full containment are covered by extended tests, not implied by this drive. `tests/artifact-browser.proof.ts` exercises real routes with store fixtures; `tests/publication-network.proof.ts` uses renderer fixtures with an active UDP control.
- Unsupported browser HTML falls back to escaped source. Do not claim interactive containment from a source-only screenshot or by opening raw HTML outside the production wrapper.
