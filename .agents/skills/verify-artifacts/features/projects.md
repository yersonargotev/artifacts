# Projects

An owner files artifacts under named projects from MCP or the CLI, finds a project's artifacts, moves an artifact between projects, and browses projects from the panel sidebar. A project is a label on the artifact, outside its immutable revisions. It exists while at least one artifact carries it.

## Sub-features

- `projects-create` files a new artifact with `artifacts_create` `project`. A name that matches an existing project regardless of letter case reuses its stored spelling.
- `projects-list` filters `artifacts_list`, `artifacts list --project`, and `GET /v1/artifacts?project=` by project, matched without regard to letter case.
- `projects-summary` returns each project and its artifact count from `projects_list`, `artifacts projects`, and `GET /v1/projects`.
- `projects-move` changes or clears a project with `artifacts_move`, `artifacts move ID --project NAME`, or `--no-project`. It keeps the head revision and publication.
- `projects-panel` lists projects in the sidebar `Proyectos` navigation, scopes the library to the chosen project, labels rows with their project, and highlights the project on the artifact detail page.
- `projects-retry` recovers a lost CLI move with `retry`. `tests/cli-client.test.ts` covers it; the drive does not.
- `projects-empty` shows the empty sidebar text and the emptied-project library state. The fixed drive always has projects, so it does not cover these states.

## How to get to it (user POV)

- From an MCP client, pass `project` to `artifacts_create`, call `projects_list`, filter `artifacts_list` with `project`, and call `artifacts_move`.
- From a terminal, run `artifacts create --snapshot FILE --project NAME`, `artifacts projects`, `artifacts list --project NAME`, and `artifacts move ID --project NAME` or `--no-project`.
- In the panel, sign in and choose a project link such as `Beta (1)` under `Proyectos`. On a 390px screen, open `Navegación` first. Search, publication filters, and pagination keep the selected project. Open an artifact to see its project highlighted and listed under `Información`.

## Driving it with control.ts (HTTP MCP + source CLI + Playwright)

```sh
R=.test-artifacts/verify-artifacts/projects-run
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts doctor --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts drive projects --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts cleanup --run "$R"
```

The drive creates `Alpha plan` with project `Alpha`, `Beta handoff` with project `alpha`, and `Unfiled notes` without a project through HTTP MCP. It runs the source CLI with the same environment as the `cli` drive. It then signs in through the panel login UI and uses `getByRole('navigation', { name: 'Proyectos', exact: true })`.

Expected end state:

- `Beta handoff` is created with project `Alpha`, and `Unfiled notes` has project `null`.
- `artifacts_list` with `project: "Alpha"` returns exactly `Alpha plan` and `Beta handoff`. `projects_list` returns `[{ "name": "Alpha", "artifactCount": 2 }]`.
- `artifacts move <B> --project Beta` prints `{ "artifactId": "<B>", "project": "Beta" }`. `artifacts list --project Beta` returns only `Beta handoff`. `artifacts projects` returns `Alpha` and `Beta` with one artifact each.
- An independent MCP `artifacts_read` of `Beta handoff` shows project `Beta` and the same `headRevisionId` as before the move.
- The sidebar links are `Alpha (1)` and `Beta (1)` with hrefs `/?project=Alpha` and `/?project=Beta`. Library rows show `Alpha`, `Beta`, and `Artefacto` under their titles.
- After `Beta (1)` is chosen, the level 1 heading is `Beta`, the library lists only `Beta handoff`, and `Beta (1)` has `aria-current="page"`.
- On the `Beta handoff` detail page, `Beta (1)` has `aria-current="true"` and `Información` lists `Proyecto` as `Beta`.
- At 390px, `/?project=Beta` lists only `Beta handoff` without horizontal page overflow.

Evidence under `<run>/projects/` includes `actions.jsonl` with every MCP request, CLI argv, exit code, stdout, and stderr without the token. It also contains `projects-library-desktop`, `projects-beta-desktop`, `projects-detail-desktop`, and `projects-beta-mobile` screenshots with their `.aria.yml` snapshots, `trace.zip`, and `result.json`.

## Gotchas

- At 1280x900, the `Información` summary straddles the bottom edge of the viewport. A Playwright click that relies on automatic scrolling can leave the disclosure closed. The drive scrolls the summary into view, clicks it, and then waits for `#information[open]`.
- The panel compares a `?project=` value with the owner's projects regardless of letter case and shows the stored spelling. A hand-typed `?project=beta` therefore highlights `Beta (1)`.
- Project names in URLs are encoded by `URLSearchParams`, so a space appears as `+`.
- The drive uses the source CLI with a bearer token, like the `cli` drive. Packaged CLI behavior and interactive login remain covered by the package and first-use proofs.
