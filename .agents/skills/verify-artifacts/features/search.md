# Search

An owner finds a page by what it says, without listing and reading every artifact. Search covers owned artifacts at their head revision. Markdown and text match by title, description, and content. HTML matches by title, description, and visible text, without tags, attributes, scripts, or styles. A design matches by title and description only. Attachments are never searched. Every term must match, letter case and accents are ignored, and operator text is treated as plain words. Each result names the page's `artifactId`, `project`, `slug`, `title`, a `snippet` with matches in `**`, and a `rank`.

## Sub-features

- `search-create` creates a Markdown page with `project` and `slug` through HTTP MCP `artifacts_create`, and MCP `artifacts_search` finds it by a word of its content.
- `search-update` updates the page through MCP `artifacts_update` with new text.
- `search-mcp` searches the new text through `artifacts_search` without its accent and with the project in another letter case.
- `search-cli` searches the same text through the source CLI with `search QUERY --project NAME`, which calls `GET /v1/search` over REST, and gets the MCP result.
- `search-stale` searches the removed text through MCP and the CLI and gets no results.
- `search-operators` searches `"foo" OR NEAR(` through the CLI and gets no results instead of a syntax error.
- `search-blank` searches a blank query through the CLI and gets `invalid_input`.
- `search-html` creates an HTML page through MCP and finds it by a visible word, but not by a word that appears only in a style, script, tag name, or attribute.
- `search-design` creates a design through MCP and finds it by a title word and a description word, but not by a word that appears only in its canvas and board file. The CLI search for its title gets the MCP result.

The panel has no search screen, so it is not driven here.

## How to get to it (user POV)

- MCP: call `artifacts_search` with `{ query, project? }`.
- CLI: `artifacts search QUERY [--project NAME] [--limit N] [--cursor CURSOR]`.

## Driving it with control.ts

```sh
R=.test-artifacts/verify-artifacts/search-run
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts doctor --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts drive search --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts cleanup --run "$R"
```

The drive lives in [scripts/search.ts](../scripts/search.ts). It creates `Viaje a Antioquia` in project `Mi-Wiki` with slug `viajes/antioquia` and the text `Una tarde en Envigado con amigos.`, then updates it to `Una mañana de Búsqueda en Sabaneta.` It then creates the HTML page `Mapa del oriente`, whose visible text is `Un paseo por Rionegro`, and the design `Tablero de Guatape` with description `Bocetos de Jardin.` and one board titled `Guarne`. The CLI runs with the same private state and REST token as the `cli` drive. The drive opens no browser.

Expected end state:

- MCP `artifacts_search { query: "envigado" }` returns only the created page before the update.
- MCP `artifacts_search { query: "busqueda sabaneta", project: "mi-wiki" }` returns one item with `project: "Mi-Wiki"`, `slug: "viajes/antioquia"`, `title: "Viaje a Antioquia"`, a snippet containing `**Búsqueda** en **Sabaneta**`, and `nextCursor: null`.
- CLI `search "busqueda sabaneta" --project mi-wiki` prints the same JSON as the MCP result.
- MCP and CLI searches for `envigado` return no items after the update.
- CLI `search '"foo" OR NEAR('` returns no items and exits 0.
- CLI `search ' '` exits 1 with `"code":"invalid_input"`.
- MCP `artifacts_search { query: "rionegro" }` returns only the HTML page. `medellin`, `itagui`, `bello`, `caldas`, `class`, and `script` return no items.
- MCP `artifacts_search` for `guatape` and for `jardin` returns only the design, and `guarne` returns no items.
- CLI `search guatape` prints the same JSON as the MCP result.

Evidence under `<run>/search/` includes `actions.jsonl` with every MCP request and CLI argv, and `result.json`.

## Gotchas

- HTML and design pages created before #93 have no index row until an operator runs `pnpm search:reindex` against the database.
- The index holds only the head revision, so an older revision's text never matches. Use `artifacts_history` for older text.
- The index stores no project or slug. Search joins the artifact row for them, so a move shows up in results immediately.
- Quote a CLI query with spaces; `search one two` is a usage error because `search` takes one positional argument.
