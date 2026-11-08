# Links

An owner keeps a wiki of cross-linked Markdown pages in one project. The panel preview renders a Markdown revision for the owner. A relative link resolves as a path against the page's slug, without its `.md` suffix and fragment, among the owner's pages in the same project at their current slugs. A resolved link inside the preview navigates the main window to the target's detail after the owner's click. A missing target, a link that leaves the project, and a relative link from a page without a slug render as marked text, not links. `http:` and `https:` links open a new tab without opener or referrer. Other schemes render as text. Raw HTML in the page renders as escaped text. The `Enlaces` section under the preview lists only the broken links and is absent when there are none. The publication keeps rendering the Markdown as inert text.

## Sub-features

- `links-create` creates `RAG` (`concepts/rag`) and `Karpathy` (`sources/karpathy`) in `Mi-Wiki` through HTTP MCP `artifacts_create`.
- `links-render` opens the `Karpathy` detail and sees, inside `frameLocator('.preview')`, the heading, a two-item list with emphasis, a table, and the fenced code block. The raw `<script>` and `<img onerror>` lines show as text, create no element, and never post a message to the panel.
- `links-external` sees `the site` with `target="_blank"` and `rel="noopener noreferrer"`. The drive does not click it, so no external request is made.
- `links-broken` sees `missing page` as a `.broken-link` titled `No existe`, not a link, and `Enlaces` holds only that item with its raw href.
- `links-navigate` clicks `the RAG concept` inside the preview and lands on the `RAG` detail in the main window, still signed in. `RAG` has no broken links, so it has no `Enlaces` section.
- `links-mobile` goes back, and the 390px detail with `Enlaces` does not overflow.

Unslugged and outside-the-project links, the renderer's scheme and image rules, and the preview response's CSP are covered by `tests/panel-links.test.ts` and `tests/panel-markdown.test.ts`, not driven here.

## How to get to it (user POV)

- MCP: call `artifacts_create` with a Markdown snapshot, `project`, and `slug` for each page.
- Panel: open the library, then the page. The rendered page is the `Vista previa` iframe. `Enlaces` sits under it when a link is broken.

## Driving it with control.ts

```sh
R=.test-artifacts/verify-artifacts/links-run
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts doctor --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts drive links --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts cleanup --run "$R"
```

The drive lives in [scripts/links.ts](../scripts/links.ts). `Karpathy` links to `../concepts/rag.md#history`, `../concepts/missing.md`, and `https://karpathy.ai`, has a list, a table, a raw `<script>` line, a raw `<img onerror>` line, and repeats the RAG link inside a fenced code block.

Expected end state:

- The `.preview` iframe's `sandbox` is `allow-top-navigation-by-user-activation allow-popups allow-popups-to-escape-sandbox`.
- Inside the frame, `heading "Karpathy" [level=1]`, two list items, the `Retrieval` cell, and the fenced code render. There is no `script` or `img` element, and both raw lines are visible text.
- `link "the site"` has `target="_blank"` and `rel="noopener noreferrer"`. `.broken-link` reads `missing page` with title `No existe`, and no link has that name.
- `region "Enlaces"` holds one list item, `missing page No existe ../concepts/missing.md`, and no link.
- `link "the RAG concept"` inside the frame points to `/artifacts/RAG_ID` with `target="_top"`. Clicking it opens the detail whose `h1` is `RAG` and whose preview heading is `RAG`, with no `region "Enlaces"`.
- The 390px detail does not overflow, and the panel received no message from the frame.

Evidence under `<run>/links/` includes `actions.jsonl` (with the frame's ARIA snapshot), `links-render.png`, `links-render-viewport.png`, `links-target.png`, `links-section-390.png`, their `.aria.yml` snapshots, `trace.zip`, and `result.json`.

## Gotchas

- Full-page screenshots leave the sandboxed preview frame blank. `links-render-viewport.png` is a viewport capture that shows the rendered frame.
- The Markdown preview has no `Connection-Allowlist: ()` header. Chrome treats the frame's link navigations as its connections and fails them with `ERR_NETWORK_ACCESS_REVOKED`. The frame cannot run scripts, so the header has nothing else to block.
- Links resolve against current slugs even when an older revision is selected, so renaming a target with `move --slug` breaks links that still use the old path.
- Only Markdown revisions render this way. Other content kinds keep their previews and have no `Enlaces` section.
