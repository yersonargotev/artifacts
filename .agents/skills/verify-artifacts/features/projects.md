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
- `projects-panel-move` opens `Mover a proyecto` from a library card menu or the detail title menu. The page shows the current project and a `Proyecto` field that suggests the owner's projects. `Mover al proyecto` files the artifact and opens that project's library. `Quitar del proyecto` appears only for a filed artifact and returns to the full library. An invalid name returns 400 with an inline error.
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
- `Menú de Unfiled notes` > `Mover a proyecto` opens `/artifacts/<C>/move`. It shows `Unfiled notes`, `Proyecto actual: Sin proyecto`, an empty `Proyecto` field with suggestions `Alpha` and `Beta`, and no `Quitar del proyecto` button.
- Submitting `Mover al proyecto` with a blank name returns 400 and shows `Escribe un nombre de proyecto de 1 a 80 caracteres, sin caracteres de control.` with `aria-invalid="true"` on the field. The re-rendered form keeps the same `requestId`.
- Submitting `Gamma` lands on `/?project=Gamma`. That library lists only `Unfiled notes` labeled `Gamma`, and the sidebar shows `Alpha (1)`, `Beta (1)`, and `Gamma (1)` with `aria-current="page"`. An independent MCP `artifacts_read` of `Unfiled notes` shows project `Gamma` and its original `headRevisionId`.
- At 390px, `Menú de Unfiled notes` > `Mover a proyecto` on the detail page opens the same move page with `Gamma` in the field, without horizontal overflow. `Quitar del proyecto` returns to `/`, where the sidebar lists only `Alpha (1)` and `Beta (1)` and the card shows `Sin proyecto`. MCP `artifacts_read` then shows project `null` and the same `headRevisionId`.
- Posting the retained `Gamma` form again with the session cookie returns 303 to `/?project=Gamma` from the receipt. The same `requestId` with `Delta` returns 409 with `La solicitud cambió`. MCP `artifacts_read` still shows project `null`.

After the original move flow, the drive creates a five-artifact `Release review` project through HTTP MCP. One artifact has a current publication, one has pending changes, and three have no publication. The source CLI creates another artifact with an 80-character unbroken project name and a 256-character unbroken title. Every index card count is compared with source CLI project lists. The drive checks real recent title IDs, the tally summary and segment counts, one active index navigation item, effects, and mobile stacking. A separate context disables JavaScript and follows project, detail, and unfiled links. The CLI then assigns every unfiled artifact to Alpha, and an MCP move removes Beta after its last artifact. Independent MCP reads verify unchanged head and publication pointers.

The project header proof compares the five-artifact Release review header and filtered status views with its index tally. It checks an 80-character name at 390px, the unfiled header count, and the vanished-project explanation. The create instruction is an additional semantic list item, and real artifact ID and count assertions remain scoped to `.artifact-card`.

For `O'Brien $x`, the drive grants real browser clipboard permissions, copies by Enter, reads the actual clipboard, and executes that unchanged string through `/bin/sh -c` in a disposable directory containing a valid `snapshot.json`. Its local `artifacts` executable invokes the source CLI. Independent MCP read and CLI project list verify the exact name and both artifact IDs. The action log keeps the actual command and process result. A separate clipboard rejection probe proves truthful failure feedback and a visible fallback on an empty result. A JavaScript-disabled 390px context checks the same visible command and native search/status scope.

Add `--record-video` to `drive projects` to record a separate 30-second browser walkthrough of the index, a project opened through its native link, the actual copy action and announcement, and Sin proyecto opened through Asignar proyecto. It then returns to the quoted project and copies by keyboard before closing. The actual page recording stays in `<run>/projects/video/`.

Evidence under `<run>/projects/` includes `actions.jsonl` with every MCP request, CLI argv, exit code, stdout, and stderr without the token. It also contains `projects-library-desktop`, `projects-beta-desktop`, `projects-detail-desktop`, `projects-beta-mobile`, `projects-move-desktop`, `projects-move-invalid-desktop`, `projects-gamma-desktop`, `projects-move-mobile`, and `projects-removed-mobile` screenshots with their `.aria.yml` snapshots, `trace.zip`, and `result.json`. Index evidence adds `projects-empty-1440`, `projects-unfiled-only-1440`, `projects-index-1440`, `projects-index-390`, `projects-open-project-1440`, `projects-tally-1440`, `projects-effects-1440`, `projects-no-unfiled-1440`, and `projects-vanished-1440`.

Header evidence adds `project-view-1440`, `project-390`, `unfiled-1440`, `vanished-1440`, `project-status-1440`, `project-effects`, `copy-keyboard`, `copy-command`, `copy-failure-empty-result`, and `project-nojs-empty-390`. `copied-command/actual-command.txt` retains the exact executed clipboard text. The cohesive drive implementation is `scripts/projects.ts`, called by `scripts/control.ts`.

## Gotchas

- The drive opens the `Información` tab by keyboard and waits for `#information`. The tab uses GET navigation and preserves the selected revision. Controls below the preview iframe use Enter because pointer clicks can be intercepted by the frame.
- The panel compares a `?project=` value with the owner's projects regardless of letter case and shows the stored spelling. A hand-typed `?project=beta` therefore highlights `Beta (1)`.
- Project names in URLs are encoded by `URLSearchParams`, so a space appears as `+`.
- The `Proyecto` field has a `list` attribute, so its ARIA role is `combobox`, not `textbox`. The drive finds it with `getByLabel('Proyecto', { exact: true })`.
- Pressing Enter in `Proyecto` submits the first button, `Mover al proyecto`. Keep `Quitar del proyecto` after it, or Enter would remove the project.
- At 390px the panel collapses `Navegación`, and Playwright role queries skip links inside a closed disclosure. Open `Navegación` before reading the `Tus proyectos` links.
- The drive uses the source CLI with a bearer token, like the `cli` drive. Packaged CLI behavior and interactive login remain covered by the package and first-use proofs.
