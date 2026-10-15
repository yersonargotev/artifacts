# Panel browsing and preview

An owner finds an artifact in their panel, opens its current draft, follows retained revision history, and interacts with the selected revision inside the panel's actual sandboxed preview. The layout remains usable on a narrow screen.

## Sub-features

- `preview-list` opens an artifact from `Tus artefactos` and displays its title and selected revision. Full metadata is available under `Información`.
- `preview-current` displays the newest draft and its revision badge.
- `preview-history` selects a retained revision without replacing its saved content.
- `preview-interaction` runs the supported HTML interaction in the actual preview iframe.
- `preview-mobile` exposes history and preview without horizontal page overflow.
- `preview-menus` opens library row menus with Space, moves with arrows, and restores focus with Escape. The selected title menu is checked in the extended artifact browser proof under the built panel CSP.
- `preview-pagination` follows `Ver más artefactos` and `Ver revisiones anteriores`; these are extended paths not covered by the fixed two-revision drive.
- `preview-inert` displays Markdown, text, and unsupported-browser HTML as inert content; these are extended paths.

## How to get to it (user POV)

- Sign in at the panel root, find an artifact under `Tus artefactos`, and choose its title link.
- Open the artifact's saved detail URL directly; a signed-out owner must complete login before viewing it.
- Choose a native `Revisión seleccionada` option and submit `Ver revisión`, or follow `Ver revisión 1` or another revision link in `Historial`. The selector covers the loaded history page and required references.
- The title menu contains the selected download, `Información`, and section links. Choosing `Información` opens its native disclosure. The visible `Archivos`, `Comparar revisiones` and `Historial` anchors also reach the secondary sections below the preview.
- Use `Ver más artefactos` on a sufficiently populated list, or `Ver revisiones anteriores` when history spans pages.
- Search the library by title or artifact identifier. Combine the query with a publication filter, clear the filters after an empty result, and use browser Back to restore the previous query.
- Resize the browser or open the same detail URL on a mobile viewport.

## Driving it with control.ts (Playwright + HTTP MCP)

Preconditions:

- `.test-artifacts/verify-artifacts/preview-run` does not exist before launch.
- Actual Chrome is available at version 152 or newer for the interactive path. Source-only fallback cannot pass an interaction assertion.

- **Launch and inspect.** Run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --run .test-artifacts/verify-artifacts/preview-run`, then `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts doctor --run .test-artifacts/verify-artifacts/preview-run`.
- **Create and browse.** Run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts drive preview --run .test-artifacts/verify-artifacts/preview-run`. The recipe creates two retained revisions through HTTP MCP, signs in through the panel's login UI, waits for the visible `Tus artefactos` library heading, and chooses `getByRole('link', { name: 'Verification artifact', exact: true })`. The detail page exposes `getByRole('heading', { name: 'Historial', exact: true })`, contains two revision rows, and its actual preview initially shows `Verification revision 2`.
- **Review the library.** The same recipe creates three additional documents through HTTP MCP. Their states cover a draft, a current publication, and a publication with pending changes. It checks row menu keyboard behavior, the exact-head download link, the stable publication link, and menu bounds at 390px. It retains library and menu screenshots at both viewports.
- **Return from publication.** At desktop and 390px viewports, the recipe opens the saved publication and clicks `Volver a la biblioteca`. The link must target the configured panel origin, have a 44px target, and return to the authenticated library with its four artifacts.
- **Select history.** The same drive follows the exact `Ver revisión 1` and `Ver revisión 2` link names as required by its recipe. Inside `frameLocator('.preview')`, the selected document heading must match its revision. Record the selection action and resulting iframe content; merely finding both history links does not prove selection.
- **Interact in the frame.** The same drive clicks the preview's exact `Try interaction` button and waits for its exact `Interaction verified` state inside `frameLocator('.preview')`. This proves interaction in the served preview frame, rather than an extracted raw HTML page.
- **Inspect mobile.** The same drive opens the detail page at its mobile viewport, waits for history and actual iframe content, and verifies no horizontal page overflow. Retain the mobile screenshot alongside the desktop action/state evidence.
- **Retain proof and stop.** Inspect `.test-artifacts/verify-artifacts/preview-run/preview/actions.jsonl`, `result.json`, desktop/mobile snapshots and screenshots, and `trace.zip`, then run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts cleanup --run .test-artifacts/verify-artifacts/preview-run`. Confirm both browser evidence and MCP setup records survive.

## Gotchas

- Direct navigation to `/artifacts/<artifactId>/preview?revisionId=<revisionId>` is deliberately denied with 403. Use the real detail-page iframe; changing request headers manually would bypass the user entry point.
- The iframe accessible title is `Vista previa de la revisión N`; `.preview` is the existing stable frame selector. Keep button/heading checks inside that frame.
- Unsupported browser user agents display escaped HTML source with scripts disabled. Markdown and text remain inert even in supported Chrome. Report those paths separately from interactive HTML.
- `tests/artifact-browser.proof.ts` checks historical content, preview denial, and containment using store-seeded artifact fixtures. `tests/publication-network.proof.ts` adds renderer/UDP probes. Neither a screenshot nor a raw HTML render proves the complete sandbox, network, and authentication behavior.
- The fixed drive has a two-revision verification artifact and three library documents. It cannot prove pagination, empty-list state, arbitrary content kinds, or every mobile browser. The extended identity proof captures the empty library.
- The `Más reciente` and `Publicada` badges describe different pointers. A historical selection may show neither; this is not a failed preview.
