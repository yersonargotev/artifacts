# Panel screen captures

The `screens` drive captures the current panel pages at 1440x900 and 390x844. Each capture checks horizontal page overflow, browser console errors, uncaught page errors, and the number of visible primary actions outside an open dialog.

## Run the drive

Build the panel before launch. Use a new run path for each drive.

```sh
pnpm build
R=.test-artifacts/verify-artifacts/screens-run
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts doctor --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts drive screens --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts cleanup --run "$R"
```

Add `--headed` to `drive screens` to show Chrome and record its page video under `<run>/screens/video/`. The video records the actual browser page. It does not record the terminal or upload evidence to the design canvas.

Always run cleanup after a failed drive. Confirm that `cleanup.json` says `stopped`, `runtime/` is absent, and the screenshots and result remain.

## Fixture and pages

The drive creates 12 artifacts through HTTP MCP. Ten belong to four projects. `Alpha` and `Beta` each have three artifacts. `Gamma` and `Delta` each have two. The remaining two have no project. Titles and content stay the same between fresh runs. IDs and request IDs differ.

Three artifacts have a publication. Two publications match the current revision. `Alpha overview` has an HTML publication at revision 1 and pending HTML revision 2. The other documents use Markdown or text. Independent MCP reads verify the publication counts and project assignments. `seed.json` records the titles, projects, head revisions, and publication pointers.

The drive captures these pages at both widths:

| Screen | Panel entry point | Evidence prefix |
| --- | --- | --- |
| Signed-out welcome | `/` before login | `screens-welcome` |
| Library | `/` after login | `screens-library` |
| Projects index | `/projects` | `screens-projects` |
| Project library | `/?project=Alpha` | `screens-project` |
| Project with two selected artifacts | `/?project=Alpha` after native checkbox selection | `screens-selection` |
| Move dialog with two selected artifacts | `/?project=Alpha` after the move trigger and a new name | `screens-dialog` |
| Artifact detail | `/artifacts/<Alpha overview ID>` | `screens-detail` |
| Move page | `/move?artifactId=<Alpha overview ID>` | `screens-move` |
| Delete confirmation | `/artifacts/<Alpha overview ID>/delete` | `screens-delete` |

Login uses `Correo electrónico`, `Contraseña`, and `Iniciar sesión`. The detail waits for `Verification revision 2` inside the real `.preview` iframe. Move and delete confirmations are inspected without submitting them. Publication results require a POST and are outside this capture drive. The `publication` recipe covers the protected viewer separately.

After each project capture, the drive checks `Seleccionar Alpha overview` and `Seleccionar Alpha delivery`. It waits for `2 seleccionados`, compares `FormData` from the selection form with those two seeded IDs, and captures the selected state at both widths. The checkboxes are associated through `form="selection"` outside the form element. The create instruction never becomes selectable. This drive captures the controls without submitting a mutation.

Each page writes `screens-<screen>-1440.png` and `screens-<screen>-390.png`, with matching `.aria.yml` snapshots. `actions.jsonl` records the MCP requests, reads, navigation, and capture paths. A successful `result.json` has `"status": "passed"` and names every completed capture. A failed check retains captures already written, a failure capture, and a failed result.

## Screen checks

The exported `checkScreen(page, label)` in `scripts/control.ts` can inspect an independent Playwright page without starting the CLI. It rejects `document.documentElement.scrollWidth > innerWidth` and more than one visible `[data-variant="primary"]` outside `dialog[open]` or a modal element with `role="dialog"` and `aria-modal="true"`. Native buttons and links declare the primary variant explicitly.

Console and page errors come from Playwright's buffered `page.consoleMessages()` and `page.pageErrors()` APIs. Each API retains up to 200 recent records for the page, across navigation. This bounded drive reads them after each capture. A long independent scenario must collect error events itself before records can fall out of those buffers. Failure messages include the capture label and the overflow dimensions, primary count, or browser error text.

To prove the checks, use a fresh Playwright page per injected fault. Add a 2000px-wide element, append two visible `.button` elements, call `console.error('screen error probe')`, or throw an uncaught error before calling `checkScreen`. Require the matching rejection. Keep the resulting screenshots and cleanup receipt.

These captures cover the listed pages and the seeded state. They do not prove every error state, pagination, keyboard interaction, publication submission, project mutation, or deletion. Use the feature recipes for those actions.
