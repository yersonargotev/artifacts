# Command palette

Feature ID `panel-palette` uses the dedicated real Chrome proof rather than a `control.ts drive` command.

```sh
pnpm build
node --import tsx tests/panel-palette.browser.proof.ts
```

`Ctrl+K`, or `Cmd+K` on macOS, opens the dialog `Paleta de comandos`. The same chord or `Escape` closes it and returns focus to the opener. The input `Buscar en la paleta` filters the page's own artifacts, the workspace projects, and five actions: `Ir a Biblioteca`, `Ir a Proyectos`, `Abrir Modo lectura`, the theme toggle, and `Conectar herramientas`. Matching ignores case and accents and marks the matched text. A non-empty query always ends with `Buscar «QUERY» en toda la biblioteca`, which opens the library GET search.

The proof starts its own disposable fixture, authors through HTTP MCP, and checks the options, arrow-key highlight with `aria-activedescendant`, focus trapping, filtering, the full-search fallback, and each action. It also checks the library keys: `j` and `k` move the row selection, `r` opens read mode, `t` toggles the theme, and `p` opens the publish confirmation only for an artifact with pending changes. Keys typed in a field, or while a menu or confirmation is open, do not fire.

Evidence stays under `.test-artifacts/panel-palette-*/`. Set `PANEL_PALETTE_EVIDENCE` to write it elsewhere. Source lives in `apps/dashboard/src/components/palette/`. This proof is included in `pnpm test:browser`.
