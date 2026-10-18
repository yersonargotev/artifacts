# Panel browsing and preview

An owner finds an artifact in their panel, opens its current draft, follows retained revision history, and interacts with the selected revision inside the panel's actual sandboxed preview. The layout remains usable on a narrow screen.

## Sub-features

- `preview-list` opens an artifact from `Biblioteca` and displays its title and selected revision. Full metadata is available on the `Información` tab. `Archivos` and `Comparar` use GET navigation and preserve the selected revision. Only `Vista previa` renders the pinned iframe.
- `preview-current` displays the newest draft and its revision badge.
- `preview-history` selects a retained revision without replacing its saved content.
- `preview-interaction` runs the supported HTML interaction in the actual preview iframe.
- `preview-mobile` exposes history and preview without horizontal page overflow.
- `preview-menus` opens library card menus with Space, moves with arrows, and restores focus with Escape. The selected title menu is checked in the extended artifact browser proof under the built panel CSP.
- `preview-pagination` follows `Ver más artefactos` and `Ver revisiones anteriores`; these are extended paths not covered by the fixed two-revision drive.
- `preview-inert` displays Markdown, text, and unsupported-browser HTML as inert content; these are extended paths.

## How to get to it (user POV)

- Sign in at the panel root, find an artifact under `Biblioteca`, and choose its title link.
- Open the artifact's saved detail URL directly; a signed-out owner must complete login before viewing it.
- Choose a native `Revisión seleccionada` option and submit `Ver revisión`, or follow `Ver revisión 1` or another revision link in `Historial`. The selector covers the loaded history page and required references.
- Use `Vista previa`, `Archivos`, `Comparar`, and `Información` to browse the selected revision. These tabs are ordinary GET links. The title menu contains `Descargar revisión N`, `Mover a proyecto`, and `Eliminar artefacto`. `Exportar` and the information card's `Mover` link work without JavaScript, as do the tabs and revision selector form. The menu, preview sizing, fullscreen, and clipboard controls require JavaScript.
- Use `Ver más artefactos` on a sufficiently populated list, or `Ver revisiones anteriores` when history spans pages.
- The library orders artifacts by the time of their newest content revision. Moving or publishing an artifact does not change that order. Cards show the real description, project, publication state, content kind, and head revision with its update time. The card menu downloads that exact head revision.
- Open `/?unfiled=1` to see only artifacts without a project. Search, publication filters, and pagination preserve this scope.
- Search the library by title or artifact identifier. Combine the query with a publication filter, clear the filters after an empty result, and use browser Back to restore the previous query.
- Resize the browser or open the same detail URL on a mobile viewport.

## Driving it with control.ts (Playwright + HTTP MCP)

Preconditions:

- `.test-artifacts/verify-artifacts/preview-run` does not exist before launch.
- Actual Chrome is available at version 152 or newer for the interactive path. Source-only fallback cannot pass an interaction assertion.

- **Launch and inspect.** Run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --run .test-artifacts/verify-artifacts/preview-run`, then `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts doctor --run .test-artifacts/verify-artifacts/preview-run`.
- **Create and browse.** Run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts drive preview --run .test-artifacts/verify-artifacts/preview-run`. The recipe creates two retained revisions through HTTP MCP, signs in through the panel's login UI, waits for the visible `Biblioteca` library heading, and chooses `getByRole('link', { name: 'Verification artifact', exact: true })`. The detail page exposes `getByRole('heading', { name: 'Historial', exact: true })`, contains two revision rows, and its actual preview initially shows `Verification revision 2`.
- **Review the library.** The same recipe creates three additional documents through HTTP MCP. Their states cover a draft, a current publication, and a publication with pending changes. It checks card menu keyboard behavior, the exact-head download link, the stable publication link, and menu bounds at 390px. It retains library and menu screenshots at both viewports.
- **Search and filter.** At both viewports, the recipe searches for `entrega`, combines the query with each publication filter, checks the returned cards, submits an unmatched query, uses browser Back, and clears the filters. Publicados includes only artifacts whose head is published. Cambios pendientes includes artifacts whose publication points to an older revision, so the three publication counts add up to Todos. Literal search is covered by `tests/library.test.ts`; recent pagination, scopes, and owner isolation are covered by `tests/panel-reader.test.ts`.
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

## Extended detail proof

After `pnpm build`, run `node --import tsx tests/panel-detail.browser.proof.ts`. Set `PANEL_DETAIL_EVIDENCE` to an unused evidence directory when retaining a named run. The proof creates the first revision with the source CLI and the second through HTTP MCP, so the history checks real client names. It exercises keyboard GET tabs at 1440px and 390px, all publication states, actual clipboard and fullscreen calls, CSS preview sizing, history selection, publication, and selected ZIP bytes against MCP export. A separate context disables JavaScript and checks tabs, revision selection, selected export, and the native move link.

The proof waits for the served iframe's heading, fonts, and two animation frames before capturing it. It records internal frame dimensions, verifies page overflow, retains each changed tab and a browser video, and runs the unchanged retained verifier at both widths. It fails on panel console errors or non-GET requests during tab browsing. Cleanup stops its isolated fixture and removes temporary credentials while preserving evidence.

## Extended library proof

After `pnpm build`, run `node --import tsx tests/panel-library.browser.proof.ts`. Set `PANEL_LIBRARY_EVIDENCE` to an unused directory to retain a named run. The proof authors 30 artifacts through HTTP MCP and compares the four workspace statistics with literal source CLI list counts. Published statistics include pending artifacts. The status links partition the scope into published heads, unpublished artifacts, and pending changes.

The proof checks the native project disclosure, search and status preservation, cursor reset, empty owner, no results, vanished project, empty Sin proyecto, exhausted continuation, and recent pagination as 25 then 5 cards. It opens the shared card menu with Space and Enter, checks arrow focus, Escape return, the final destructive item, and the head download against MCP ZIP bytes. A 256-character title, an 8192-character description, and an unbroken project name must clamp without horizontal overflow at 390px.

A separate browser context disables JavaScript and exercises the project disclosure, GET search, status links, title navigation, pagination, and the fresh account's native tool disclosure. The shared popup menu requires JavaScript. Evidence includes screenshots at 1440px and 390px, the browser video, literal CLI output, HTTP MCP requests, result, and cleanup receipt. This proof is included in `pnpm test:browser`.
