---
name: artifacts-design
description: Design the HTML document of a retained Artifact with embedded fonts, light and dark Catppuccin tokens, purposeful layout, and rendered checks. Use before writing or restyling HTML for the artifacts or artifacts-cli skills.
---

# Design HTML artifacts

The calling skill owns the snapshot, size limit, and save workflow. This skill owns how the document looks and behaves. Follow the user's visual direction first. When revising content only, keep an existing artifact's established style. When the user asks to redesign or improve the look, start from these defaults.

The document renders in a sandbox that blocks every network request. Fonts, images, and icons load only as `data:` URIs. External stylesheets, Google Fonts links, and CDN scripts silently fail. Inline all CSS and JavaScript.

## Start from the starter

Copy the `<style>` block of [the starter](templates/starter.html) into the new document. It defines the color, font, and spacing tokens and the shared primitives: eyebrow and label, lede, summary strip, pills, expandable rows, panel, note, table, filter bar, and footer. Delete primitives the page does not use. Derive every new color and type decision from its tokens.

The starter supplies a vocabulary, not a layout. Compose the body for the reader's task:

| Purpose | Composition |
| --- | --- |
| Report or guide | A conclusion first, a reading column near 68 characters, and evidence beside the claim it supports. |
| Inventory, ledger, or status | A summary strip, a filter bar with a live count, then one `.row` per record. Its summary shows the identifier, title, and state; its detail holds everything else. Set `--cols` on `.rows` to match the summary cells. Rows stack to one column below 720 px. |
| Compare options | Aligned criteria in a table, consistent scales, and the tradeoff stated in words. |
| Explore data | A dominant chart or table sized to carry the page, with filters beside it. |
| Calculate or simulate | Labeled inputs beside the result they change, with units and a realistic starting example. |
| Explain a concept | A sequence of large diagrams with short captions; read [visual explanations](references/visual-explanations.md). |

Open in a complete state with the user's real data. Never ship an empty shell or placeholder text.

## Typography

Use the bundled faces through the starter's tokens:

- `--f-display` is Bricolage Grotesque. Use it for `h1` to `h3` and large figures only.
- `--f-body` is Public Sans for running text and controls.
- `--f-mono` is JetBrains Mono for code, identifiers, table headers, eyebrows, and labels.
- Newsreader is an optional reading face. For a long essay or editorial guide, set `--f-body` to `"Newsreader",Charter,Georgia,serif` and keep Public Sans for controls.

Keep the starter's scale: `h1` at `clamp(28px,4vw,40px)`, body at 15 to 16 px with a 1.55 line height, uppercase mono labels at 11 to 12 px with `.06em` tracking, and `text-wrap: balance` on headings. Use `font-variant-numeric: tabular-nums` wherever digits align.

After the HTML file is complete, embed the fonts it names:

```sh
node <skill-directory>/scripts/embed-fonts.mjs page.html
```

For the CLI, `<skill-directory>` is the output of `artifacts skills path artifacts-design`. The script rewrites the file in place and is safe to rerun after edits. It embeds only the families the page names and adds italic faces only for `font-style: italic`, `<em>`, `<i>`, or `<cite>`. It refuses to write a page above 1 MiB. Three families add about 135 KB. Newsreader adds about 80 to 165 KB. Do not name another family unless you embed its `woff2` yourself, because an unembedded face silently falls back. Without Node, keep the fallback stacks and report that the fonts were not embedded.

## Color

The starter follows the viewer's system theme. Light uses Catppuccin Latte and dark uses Mocha, with Blue as the only accent. [Catppuccin roles](references/catppuccin.md) lists every token and the extra chart colors.

- Define each color once as a token on bare `:root` and redefine only the tokens in both dark blocks. Never write a literal color in a component rule.
- Keep `body` on `var(--page)`. Use `--surface` for the objects you set apart, and `--sunken` for table headers and hover.
- Show state with soft pills: a `*-soft` background and `*-ink` text. Do not fill badges with saturated pastels. Map every state to neutral, accent, ok, warn, or bad. Do not add a hue for an extra state; distinguish it with its label.
- Use the accent for links, focus, the selected state, and one primary action. Status colors carry meaning only.
- When the user names a single dark look, set the Mocha values on bare `:root`, keep `color-scheme: dark`, and drop the media blocks.

## Layout and components

- Center one `.wrap` column at `--width` with `max(16px, env(safe-area-inset-*))` side gutters. Space siblings with grid or flex `gap`.
- Use borders and fills by role. A summary strip, a table, and one panel can each earn a surface. Running text and headings sit on the page.
- Mark structure that is true: an eyebrow names the source or scope, a label names a field, and numbering appears only for real sequences.
- Encode attention in form. A row that needs action gets a pill or a muted closed state, not only a different word.
- Put wide code and diagrams in their own `overflow-x: auto` container. Use a `<table>` only for short records that stay readable when scrolled; use expandable rows for records with long text. The page itself never scrolls sideways at 375 px.
- Draw diagrams in inline SVG with token colors and labels inside the view box. For icons, use inline Tabler outline SVGs with `currentColor`.
- Respect `prefers-reduced-motion`. Use motion only to explain a change of state.

## Copy

Give the `<title>` a specific name of two to four words, or the name the user already uses for the document. Write labels from the reader's side, in the user's language. State units next to numbers. Put the source and date of the data in the footer.

## Check the rendered page

Run the [interface checks](references/interface-checks.md) when browser tools are available. Render at 375 px and 1280 px in both light and dark. Confirm that the fonts loaded, nothing overflows, and every control changes something visible. Fix what you see once, then save. Report checks you could not run.

The license notices for bundled fonts and adapted guidance are in [third-party notices](THIRD-PARTY-NOTICES.md).
