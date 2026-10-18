# Projects

An owner files artifacts under named projects from MCP or the CLI, finds a project's artifacts, moves an artifact between projects from MCP, the CLI, or the panel, and browses projects from the panel index and sidebar. A project is a label on the artifact, outside its immutable revisions. It exists while at least one artifact carries it.

## Sub-features

- `projects-create` files a new artifact with `artifacts_create` `project`. A name that matches an existing project regardless of letter case reuses its stored spelling.
- `projects-list` filters `artifacts_list`, `artifacts list --project`, and `GET /v1/artifacts?project=` by project, matched without regard to letter case.
- `projects-summary` returns each project and its artifact count from `projects_list`, `artifacts projects`, and `GET /v1/projects`.
- `projects-move` changes or clears a project with `artifacts_move`, `artifacts move ID --project NAME`, or `--no-project`. It keeps the head revision and publication.
- The sidebar links to `Proyectos (N)` at `/projects` and `Sin proyecto (N)` at `/?unfiled=1`. The index has exactly one active sidebar item. Its breadcrumb reads Biblioteca, then Proyectos.
- `projects-index` shows real project names, artifact counts, inclusive publication counts, and the three newest title links per project. The green tally excludes pending changes. Yellow shows pending changes and gray shows unpublished artifacts. Update times come from the current head revision. Cards use recent update order while the sidebar keeps project name order.
- The index shows the unfiled card only when it has artifacts. `Asignar proyecto` opens Sin proyecto. With no unfiled artifacts the project grid fills the width. Native project and title links work without JavaScript.
- `projects-headers` shows a canonical project cover header with its aggregate artifact, inclusive publication, and pending counts. Its tally matches the index even under filters. Sin proyecto shows its actual count. A vanished project keeps its explicit empty explanation and has no create command.
- `projects-create-command` keeps an escaped POSIX CLI command visible in the header and instruction card. Clipboard buttons appear progressively, support keyboard activation, and announce success or failure. An empty search still retains the header command for manual copying without JavaScript.
- `projects-panel` lists projects in the sidebar `Tus proyectos` navigation, scopes the library to the chosen project, labels cards with their project, and highlights the project on the artifact detail page.
- `projects-panel-move` opens a `Mover N artefactos` dialog from a library card menu, the detail title menu, the information link, or the selection bar. The dialog shows the current project and a `Proyecto` Combobox with matching names, other projects, and an explicit create choice. `Mover` files the selection and opens that project's library. `Quitar del proyecto` appears only for a filed artifact and returns to Sin proyecto. An invalid name returns 400 with an inline error.
- `projects-selection` adds checkboxes only to real project and Sin proyecto pages. The native form moves the checked artifacts through GET `/move` or removes them through POST `/move` with one `intent=remove`. Selection is limited to the current page of up to 25 artifacts. The create instruction, Biblioteca, and vanished projects have no checkboxes.
- `projects-selection-enhancement` derives the selected count from native `FormData`, hides the bar at zero, clears checks with native reset, synchronizes restored checks on `pageshow`, and refreshes the request ID before each submit. Without JavaScript the bar stays visible and both actions still work.
- `projects-panel-retry` replays a resubmitted move form by its retained request ID and answers a changed resubmission with 409. The drive posts both resubmissions over HTTP. The 503 retry page after an uncertain write is covered only at module level by `tests/move-form.test.ts`.
- `projects-retry` recovers a lost CLI move with `retry`. `tests/cli-client.test.ts` covers it; the drive does not.
- `projects-empty` explains how assigning a project when creating or moving an artifact creates the project. The drive checks an empty owner and an unfiled-only owner. Moving the last member through MCP removes the project from the index and sidebar.

## How to get to it (user POV)

- From an MCP client, pass `project` to `artifacts_create`, call `projects_list`, filter `artifacts_list` with `project`, and call `artifacts_move`.
- From a terminal, run `artifacts create --snapshot FILE --project NAME`, `artifacts projects`, `artifacts list --project NAME`, and `artifacts move ID --project NAME` or `--no-project`.
- In the panel, sign in and choose **Proyectos** to open the index. Choose **Abrir proyecto** to scope the library, a recent title to open the artifact, or **Asignar proyecto** to open Sin proyecto. You can also choose a project link such as `Beta (1)` under `Tus proyectos`. On a 390px screen, open `Navegación` first. Search, publication filters, and pagination keep the selected project. Open an artifact to see its project highlighted and listed on the `Información` tab. To move it, choose `Mover a proyecto` from the card's `Menú de TITLE` menu or the detail page's `Menú de TITLE` menu. Type or pick a name in `Proyecto` and choose `Mover al proyecto`, or choose `Quitar del proyecto`.
- The header search submits a normal GET to `/`. Inside a project it says `Buscar en NAME…` and keeps the hidden `project` field. Inside Sin proyecto it keeps `unfiled=1`. Search also keeps the selected publication filter and starts at the first result page. The header breadcrumb links back to Biblioteca and, on a detail page, to the artifact's project or Sin proyecto.

## Driving it with control.ts (HTTP MCP + source CLI + Playwright)

```sh
R=.test-artifacts/verify-artifacts/projects-run
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts doctor --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts drive projects --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts cleanup --run "$R"
```

The drive first signs in with no artifacts and checks the empty index. It creates `Unfiled notes` and checks the unfiled-only index. It then creates `Alpha plan` with project `Alpha` and `Beta handoff` with project `alpha` through HTTP MCP. It runs the source CLI with the same environment as the `cli` drive. The signed-in panel uses `getByRole('navigation', { name: 'Tus proyectos', exact: true })`. After the browsing checks it moves `Unfiled notes` into a new `Gamma` project from its card menu at 1440px, then removes it from its detail title menu at 390px.

Expected observations:

- `Beta handoff` is created with project `Alpha`, and `Unfiled notes` has project `null`.
- `artifacts_list` with `project: "Alpha"` returns exactly `Alpha plan` and `Beta handoff`. `projects_list` returns `[{ "name": "Alpha", "artifactCount": 2 }]`.
- `artifacts move <B> --project Beta` prints `{ "artifactId": "<B>", "project": "Beta" }`. `artifacts list --project Beta` returns only `Beta handoff`. `artifacts projects` returns `Alpha` and `Beta` with one artifact each.
- An independent MCP `artifacts_read` of `Beta handoff` shows project `Beta` and the same `headRevisionId` as before the move.
- The sidebar links are `Alpha (1)` and `Beta (1)` with hrefs `/?project=Alpha` and `/?project=Beta`. Library cards show `Alpha`, `Beta`, and `Sin proyecto` as project chips.
- After `Beta (1)` is chosen, the level 1 heading is `Beta`, the library lists only `Beta handoff`, and `Beta (1)` has `aria-current="page"`.
- On the `Beta handoff` detail page, `Beta (1)` has `aria-current="true"` and the `Información` tab lists `Proyecto` as `Beta`.
- At 390px, `/?project=Beta` lists only `Beta handoff` without horizontal page overflow.
- `Menú de Unfiled notes` > `Mover a proyecto` opens a dialog over the library. It shows `Unfiled notes`, `Sin proyecto`, an empty `Proyecto` field with suggestions `Alpha` and `Beta`, and no `Quitar del proyecto` button.
- Submitting `Mover` in the dialog with a blank name returns 400 and shows `Escribe un nombre de proyecto de 1 a 80 caracteres, sin caracteres de control.` with `aria-invalid="true"` on the field. The re-rendered form keeps the same `requestId`.
- Submitting `Gamma` lands on `/?project=Gamma`. That library lists only `Unfiled notes` labeled `Gamma`, and the sidebar shows `Alpha (1)`, `Beta (1)`, and `Gamma (1)` with `aria-current="page"`. An independent MCP `artifacts_read` of `Unfiled notes` shows project `Gamma` and its original `headRevisionId`.
- At 390px, `Menú de Unfiled notes` > `Mover a proyecto` on the detail page opens the dialog sheet with `Gamma` in the field, without horizontal overflow. `Quitar del proyecto` returns to `/?unfiled=1`, where the sidebar lists only `Alpha (1)` and `Beta (1)` and the library shows only the `Unfiled notes` card in `Sin proyecto`. MCP `artifacts_read` then shows project `null` and the same `headRevisionId`.
- Posting the retained `Gamma` form again with the session cookie returns 303 to `/?project=Gamma` from the receipt. The same `requestId` with `Delta` returns 409 with `La solicitud cambió`. MCP `artifacts_read` still shows project `null`.

After the original move flow, the drive creates a five-artifact `Release review` project through HTTP MCP. One artifact has a current publication, one has pending changes, and three have no publication. The source CLI creates another artifact with an 80-character unbroken project name and a 256-character unbroken title. Every index card count is compared with source CLI project lists. The drive checks real recent title IDs, the tally summary and segment counts, one active index navigation item, effects, and mobile stacking. A separate context disables JavaScript and follows project, detail, and unfiled links. The CLI then assigns every unfiled artifact to Alpha, and an MCP move removes Beta after its last artifact. Independent MCP reads verify unchanged head and publication pointers.

The bulk flow then creates `Bulk first` and `Bulk second` in Alpha and publishes the first artifact. It selects both through their literal `Seleccionar TITLE` labels, reads the externally associated IDs through `FormData`, and captures `bulk-1440` and `selection-390`. `Limpiar selección` clears both checkboxes, changes the count to zero, and hides the enhanced bar. The drive selects both again and chooses `Quitar del proyecto`. It lands on `/?unfiled=1`, compares both full MCP reads with their earlier values except for `project: null`, and confirms the IDs are absent from the CLI Alpha list. It records `bulk-remove-readback.json` and the actual resulting panel screenshot.

From Sin proyecto, the drive selects the same pair and chooses `Mover a otro proyecto`. The dialog's hidden IDs equal the successful checked controls. Its native POST creates Delta. CLI `projects` and MCP `projects_list` both report the literal `{ "name": "Delta", "artifactCount": 2 }`, and the CLI Delta list contains exactly the selected pair. Full MCP reads prove unchanged revision and publication data. `bulk-create-readback.json` and `bulk-create.png` retain the result. A final Biblioteca capture proves that its cards have no checkboxes.

The project header proof compares the five-artifact Release review header and filtered status views with its index tally. It checks an 80-character name at 390px, the unfiled header count, and the vanished-project explanation. The create instruction is an additional semantic list item, and real artifact ID and count assertions remain scoped to `.artifact-card`.

For `O'Brien $x`, the drive grants real browser clipboard permissions, copies by Enter, reads the actual clipboard, and executes that unchanged string through `/bin/sh -c` in a disposable directory containing a valid `snapshot.json`. Its local `artifacts` executable invokes the source CLI. Independent MCP read and CLI project list verify the exact name and both artifact IDs. The action log keeps the actual command and process result. A separate clipboard rejection probe proves truthful failure feedback and a visible fallback on an empty result. A JavaScript-disabled 390px context checks the same visible command and native search/status scope.

Add `--record-video` to `drive projects` to record a separate 30-second browser walkthrough of the index, a project opened through its native link, the actual copy action and announcement, and Sin proyecto opened through Asignar proyecto. It then returns to the quoted project and copies by keyboard before closing. The actual page recording stays in `<run>/projects/video/`.

Evidence under `<run>/projects/` includes `actions.jsonl` with every MCP request, CLI argv, exit code, stdout, and stderr without the token. It also contains `projects-library-desktop`, `projects-beta-desktop`, `projects-detail-desktop`, `projects-beta-mobile`, `projects-move-desktop`, `projects-move-invalid-desktop`, `projects-gamma-desktop`, `projects-move-mobile`, and `projects-removed-mobile` screenshots with their `.aria.yml` snapshots, `trace.zip`, and `result.json`. Index evidence adds `projects-empty-1440`, `projects-unfiled-only-1440`, `projects-index-1440`, `projects-index-390`, `projects-open-project-1440`, `projects-tally-1440`, `projects-effects-1440`, `projects-no-unfiled-1440`, and `projects-vanished-1440`.

Header evidence adds `project-view-1440`, `project-390`, `unfiled-1440`, `vanished-1440`, `project-status-1440`, `project-effects`, `copy-keyboard`, `copy-command`, `copy-failure-empty-result`, and `project-nojs-empty-390`. `copied-command/actual-command.txt` retains the exact executed clipboard text. The cohesive drive implementation is `scripts/projects.ts`, called by `scripts/control.ts`.

Selection evidence adds `bulk-1440`, `selection-390`, `clear-selection`, `bulk-remove-readback`, `bulk-create`, and `no-checkboxes-1440`, with accessible snapshots and public readback JSON files. The `screens` drive separately captures `screens-selection-1440` and `screens-selection-390`.

## Gotchas

- The drive opens the `Información` tab by keyboard and waits for `#information`. The tab uses GET navigation and preserves the selected revision. Controls below the preview iframe use Enter because pointer clicks can be intercepted by the frame.
- The panel compares a `?project=` value with the owner's projects regardless of letter case and shows the stored spelling. A hand-typed `?project=beta` therefore highlights `Beta (1)`.
- Project names in URLs are encoded by `URLSearchParams`, so a space appears as `+`.
- The `Proyecto` field has a `list` attribute, so its ARIA role is `combobox`, not `textbox`. The drive finds it with `getByLabel('Proyecto', { exact: true })`.
- Pressing Enter in `Proyecto` submits the first button, `Mover al proyecto`. Keep `Quitar del proyecto` after it, or Enter would remove the project.
- At 390px the panel collapses `Navegación`, and Playwright role queries skip links inside a closed disclosure. Open `Navegación` before reading the `Tus proyectos` links.
- The drive uses the source CLI with a bearer token, like the `cli` drive. Packaged CLI behavior and interactive login remain covered by the package and first-use proofs.

## Atomic panel movement

The native GET and POST route is `/move`. GET accepts repeated `artifactId` query parameters. POST accepts one to 25 repeated hidden `artifactId` fields, one request ID, an optional project field for removal, and one intent. The parser limits the encoded body to 4096 bytes and rejects malformed UTF-8, percent escapes, unknown fields, and duplicate singleton fields. Mover remains the first submit intent.

A complete result redirects with 303 to the canonical project or `/?unfiled=1`. A partial result returns 200, lists unavailable submitted IDs, and links to the historical destination. Invalid names return 400 with the same fields and request ID. Conflicts return 409 and a fresh-form link. Unconfirmed commands return 503 with a dedicated same-action retry form. Non-domain failures in optional title or workspace reads preserve every non-redirect POST outcome. GET and authorization failures still require their normal error response.

The legacy `/artifacts/<id>/move` route returns 308 for GET and POST. The projects drive uses the canonical route and checks removal in Sin proyecto. Dedicated batch browser coverage must keep the legacy method-preserving POST and command-kind conflict checks.

The accepted live database fault is a disposable SQLite trigger on receipt insertion, scoped to the run's owner and request ID. It proves rollback after the project update, an absent receipt, retained retry fields, and convergence after trigger removal. It does not prove transport loss, an ambiguous commit, or an actual connection close. Rejected optional reads remain separate orchestration tests.

Run the dedicated batch proof with `pnpm build && node --import tsx tests/panel-move.browser.proof.ts`. It also runs in `pnpm test:browser`. Set `PANEL_MOVE_EVIDENCE` to a fresh evidence directory when retaining a named run. It creates artifacts through HTTP MCP, moves and removes them through native forms with JavaScript disabled, compares CLI projects/list with MCP projects/read, and records desktop and 390px screenshots plus a 32-second video. A separate evidence page displays the actual recorded public readback in the video.

Run the dedicated selection proof with `pnpm build && node --import tsx tests/panel-selection.browser.proof.ts`. It also runs in `pnpm test:browser`. Set `PANEL_SELECTION_EVIDENCE` to a fresh evidence directory. It proves actual POST field cardinalities, fresh IDs, full revision/publication immutability, reset timing, real Back restoration and a changed repeated removal. A JavaScript-disabled context proves native removal, exact history replay, and native new-project movement. A 26-artifact fixture proves the 25-card bound, continuation isolation, and selection reset through native search and publication filters. It records selected-card effects and keyboard labels, captures both widths, and records a 35-second walkthrough of selection, removal, new Delta creation, and actual CLI/MCP readbacks.

The history lane removes Playwright's default `--disable-back-forward-cache` argument so actual Chrome can restore the document. It requires the real `pageshow.persisted` event and waits for navigation commit, because this restoration emits no new load event. This proves Chrome's restored selection path. With history caching disabled, Back reloads the current project state instead. Removing its last members then shows the vanished-project empty state with no fabricated selection controls.

The partial-selection fixture deletes one disposable member through the native panel confirmation. MCP, REST, and the CLI do not expose deletion. This substitutes the real supported deletion route for the original plan's nonexistent MCP delete tool. Foreign-owner setup uses a fixture-only database reassignment. It is not public authoring evidence. Cleanup records the owned panel PID's absence, unavailable port, removed database, and removed runtime directory.

## Progressive move dialog

`MoveForm` server-renders the native project input and datalist. Without JavaScript, card and detail-header fallback links, the information link, and the selection form reach `/move`. The POST and 303 contract stays the same. Hydration preserves a draft entered before scripts finish loading.

With JavaScript, the dialog captures one valid move trigger and creates a fresh request ID. It reads selected IDs through the same native form controls. It submits exactly one `project` field from the current draft and one submitter intent. Choosing an existing project writes its canonical spelling. Typing `pag` highlights `Checkout · pagos` and offers `Crear proyecto «pag»`. Search ignores accents, while the create rule uses persisted case folding after project-name normalization.

Typing then pressing Enter submits that name. Arrow navigation and Enter choose an existing or explicit create option. The next Enter or **Mover** submits. The first Escape closes an open list. Escape with the list closed and **Cancelar** close the dialog. A direct link or selection button receives focus again. A menu action returns focus to its persistent menu button because the activated link unmounts.

Run `pnpm build && node --import tsx tests/panel-dialog.browser.proof.ts`. Set `PANEL_DIALOG_EVIDENCE` to a fresh private directory. The proof records actual desktop and 390px captures, one- and three-artifact moves, CLI and HTTP MCP readbacks, focus return, native fallback entries, draft preservation across delayed hydration, removal, and retained verification after dialog use. It records the browser and panel process IDs before shutdown and verifies cleanup. The video shows the actual panel actions and an evidence page containing the recorded public responses.
