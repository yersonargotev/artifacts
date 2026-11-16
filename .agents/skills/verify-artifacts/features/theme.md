# Panel theme

Feature ID `panel-theme` uses the dedicated real Chrome proof rather than a `control.ts drive` command.

```sh
pnpm build
node --import tsx tests/panel-theme.browser.proof.ts
```

The panel renders dark by default. The rail button `Cambiar a tema claro` switches to light, and `Cambiar a tema oscuro` switches back. The `t` key and the palette action of the same name submit the same toggle. With JavaScript the theme flips in place, so the page keeps its scroll and selection. Without JavaScript the button posts the form to `/theme`, which stores the `panel_theme` cookie and redirects to the same local path. The server reads that cookie and renders the theme in the first byte of markup, including the `theme-color` meta tag.

The proof launches its own `control.ts` instance with `--allow-guests`, authors through HTTP MCP, and cleans up the instance. It checks the toggle with and without JavaScript, the stored cookie, and the first paint after reload. `/theme` returns only to same-origin paths, rejects other themes, extra fields, and cross-origin posts, and an unknown cookie renders dark. The proof also measures the text contrast of every page, hover, and focus state in both themes and writes `contrast.json`. The sandboxed preview keeps its own document background in either theme.

Evidence stays under `.test-artifacts/verify-artifacts/panel-theme-*/panel-theme/`. Set `PANEL_THEME_EVIDENCE` to write it elsewhere. Source lives in `apps/dashboard/src/theme.ts`, `apps/dashboard/src/pages/theme.ts`, and `apps/dashboard/src/components/shell/ThemeToggle.astro`. This proof is included in `pnpm test:browser`.
