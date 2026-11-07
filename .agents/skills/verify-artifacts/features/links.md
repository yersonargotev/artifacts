# Links

An owner keeps a wiki of cross-linked Markdown pages in one project. On a Markdown page's detail, the `Enlaces` section lists each relative link of the selected revision. A link resolves as a path against the page's slug, without its `.md` suffix and fragment, among the owner's pages in the same project at their current slugs. A resolved link navigates to the target's detail. A missing target, a link that leaves the project, and a relative link from a page without a slug are marked broken. Links with a scheme (`https:`, `mailto:`), pure fragments, images, code, and raw HTML are not listed. The preview and the publication keep rendering the Markdown as inert text.

## Sub-features

- `links-create` creates `RAG` (`concepts/rag`) and `Karpathy` (`sources/karpathy`) in `Mi-Wiki` through HTTP MCP `artifacts_create`.
- `links-list` opens the `Karpathy` detail and sees two items in `Enlaces`: the https link and the link inside a code fence are skipped.
- `links-navigate` clicks `the RAG concept` and lands on the `RAG` detail, whose `Enlaces` shows the empty state.
- `links-broken` goes back and sees `missing page` marked `No existe` with its raw href, not as a link, and the 390px detail does not overflow.

Unslugged and outside-the-project links are covered by `tests/panel-links.test.ts`, not driven here.

## How to get to it (user POV)

- MCP: call `artifacts_create` with a Markdown snapshot, `project`, and `slug` for each page.
- Panel: open the library, then the page. `Enlaces` sits under the preview on the `Vista previa` tab.

## Driving it with control.ts

```sh
R=.test-artifacts/verify-artifacts/links-run
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts doctor --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts drive links --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts cleanup --run "$R"
```

The drive lives in [scripts/links.ts](../scripts/links.ts). `Karpathy` links to `../concepts/rag.md#history`, `../concepts/missing.md`, and `https://karpathy.ai`, and repeats the RAG link inside a fenced code block.

Expected end state:

- `region "Enlaces"` on the `Karpathy` detail holds two list items.
- The link `the RAG concept` points to `/artifacts/RAG_ID` and shows `concepts/rag`. Clicking it opens the detail whose `h1` is `RAG` and whose `Enlaces` reads `Esta página no tiene enlaces relativos.`
- Back on `Karpathy`, one `[data-link-state="broken"]` item reads `missing page No existe ../concepts/missing.md` and contains no link.
- The 390px detail does not overflow.

Evidence under `<run>/links/` includes `actions.jsonl`, `links-section.png`, `links-target.png`, `links-broken.png`, `links-section-390.png`, their `.aria.yml` snapshots, `trace.zip`, and `result.json`.

## Gotchas

- Links resolve against current slugs even when an older revision is selected, so renaming a target with `move --slug` breaks links that still use the old path.
- `Enlaces` appears only when the selected revision is Markdown. Other content kinds have no section.
