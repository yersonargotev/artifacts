---
name: artifacts-design
description: Design HTML documents and multi-board design canvases of a retained Artifact with a visual direction chosen for each artifact, embedded fonts, light and dark themes, and rendered checks. Use before writing or restyling HTML or design boards for the artifacts or artifacts-cli skills.
---

# Design HTML artifacts

The calling skill owns the snapshot, size limit, and save workflow. This skill owns how the document looks and behaves. Follow the user's visual direction first. When revising content only, keep an existing artifact's established style. Give artifacts that the user treats as one set the same direction. In every other case, including a redesign, choose a direction for this artifact.

The document renders in a sandbox that blocks every network request. Fonts, images, and icons load only as `data:` URIs. External stylesheets, Google Fonts links, and CDN scripts silently fail. Inline all CSS and JavaScript.

For multiple boards, read [canvas authoring](references/canvas.md) before writing the index or HTML. It defines the board files, pages, geometry, shared font budget, and complete snapshot workflow.

## Choose the composition

Before writing HTML, identify the reader's task, the facts and assets available, and what the reader should understand or do first. Use supplied facts. Label illustrative inputs and assumptions, and leave unavailable evidence absent.

Choose the element that carries the answer: a comparison, a diagram, a sequence, a chart, or a result beside its inputs. Give it the most space and put its supporting text nearby. If the same composition would fit an unrelated topic unchanged, use the subject's actual relationships or quantities to make the structure more specific. A report can be dense, an explanation can use large scenes, and a calculator can fit on one screen. Do not impose a hero, a section count, or a word budget.

## Choose a visual direction

Decide the look before writing CSS. Derive it from the subject, the reader, and where the reader will open the artifact. Make four decisions:

- **Color.** The temperature of the page and surfaces, and one accent hue.
- **Type.** A pairing of faces and a scale, as [Typography](#typography) allows.
- **Shape.** Corner radius, rules or fills, shadows or none, and density.
- **Layout.** The page skeleton, as [Layout](#layout) allows.

A ledger of invoices can be dense and ruled, with monospace figures on a cool gray page. A field guide can use a serif on warm paper with wide margins. An incident timeline can be dark by default with one alarm hue. These examples show the reasoning. They are not presets, so do not pick from them.

Two artifacts on unrelated subjects must differ in at least color and type. Do not repeat the look of the previous artifact in the conversation unless both belong to one set. Do not default to blue on cool gray.

State the direction in one sentence to the user when you deliver the artifact.

## Keep the role tokens

[The starter](templates/starter.html) shows the token roles, the light and dark theme blocks, and how each shared component uses the roles: contextual text and labels, lede, summary strip, pills, expandable rows, panel, note, table, filter bar, and footer. Keep the role names. Set your own values for color, font, radius, and width. Copy only the components the page uses, and restyle them to the direction. Add components the starter lacks.

The starter's values are the Artifacts house look. Ship them unchanged only when the user asks for the house look or for Catppuccin.

The purpose of the artifact sets the composition, whatever the direction:

| Purpose | Composition |
| --- | --- |
| Report or guide | A conclusion first, a reading column near 68 characters, and evidence beside the claim it supports. |
| Inventory, ledger, or status | A summary, a filter bar with a live count, then one expandable row per record. The row summary shows the identifier, title, and state. The row detail holds everything else. With the starter's `.rows`, set `--cols` to match the summary cells. Rows stack to one column below 720 px. |
| Compare options | Aligned criteria in a table, consistent scales, and the tradeoff stated in words. |
| Explore data | A dominant chart or table sized to carry the page, with filters beside it. |
| Calculate or simulate | Labeled inputs beside the result they change, with units and a realistic starting example. |
| Explain a concept | A sequence of large diagrams with short captions; read [visual explanations](references/visual-explanations.md). |

Open in a complete state with the user's real data. Never ship an empty shell or placeholder text.

## Typography

Assign faces to `--f-display`, `--f-body`, and `--f-mono`. Any face can take any role. Choose from three sources:

- **Bundled faces.** Bricolage Grotesque is a display grotesque. Public Sans is a neutral sans. Newsreader is a reading serif with italics. JetBrains Mono is a monospace. The embedding script handles these.
- **System stacks.** They cost no bytes and render differently on each platform, so end each stack with a generic family. Examples: `Charter,"Iowan Old Style",Georgia,serif`, `"Avenir Next","Segoe UI",system-ui,sans-serif`, `ui-rounded,"SF Pro Rounded",system-ui,sans-serif`, and `Rockwell,"Roboto Slab",serif`.
- **Another face.** Embed its `woff2` yourself in a `@font-face` rule with a `data:` URI. Use a face only when its license allows embedding, and subset it to the characters the page needs. An unembedded face silently falls back.

Use at most three families. Set the scale for the direction and the reading density. Keep body text at 15 px or more with a line height near 1.5, and labels at 12 px or more. Keep `text-wrap: balance` on headings and `font-variant-numeric: tabular-nums` wherever digits align.

After the HTML file is complete, embed the bundled fonts it names:

```sh
node <skill-directory>/scripts/embed-fonts.mjs page.html
```

For the CLI, `<skill-directory>` is the output of `artifacts skills path artifacts-design`. The script rewrites the file in place and is safe to rerun after edits. It selects bundled families from CSS `font-family` and `font` declarations in style elements and inline styles, including referenced custom properties. Comments, content text, and JavaScript strings do not select fonts. It adds italic faces for CSS `font-style: italic`, italic `font` shorthand, or real `<em>`, `<i>`, and `<cite>` elements. It leaves your own `@font-face` rules in place. It refuses to write a page above 1 MiB. Three bundled families add about 135 KB. Newsreader adds about 80 to 165 KB. Without Node, keep the fallback stacks and report that the fonts were not embedded.

## Color

Build a palette for the direction on the starter's role tokens. [Catppuccin roles](references/catppuccin.md) describes each role and shows the house palette as a worked example.

- Follow the viewer's system theme. Define each color once as a token on bare `:root` and redefine only the tokens in both dark blocks. Never write a literal color in a component rule.
- When the direction or the user calls for a single theme, set its values on bare `:root`, set the matching `color-scheme`, and drop the media blocks.
- Compute the contrast of every pair you ship, in each theme. `--fg`, `--muted`, and each `*-ink` token reach 4.5:1 on `--page`, `--surface`, and their own `*-soft` background. `--control` reaches 3:1. Fix a failing token before saving.
- Keep `body` on `var(--page)`. Use `--surface` for the objects you set apart, and `--sunken` for table headers and hover.
- Use one accent hue for links, focus, the selected state, and one primary action. Status colors carry meaning only. Keep ok, warn, and bad distinguishable from the accent and from each other.
- Show state with a soft background and ink text, or with a mark beside a label. Do not fill badges with saturated color. Map every state to neutral, accent, ok, warn, or bad. Do not add a hue for an extra state; distinguish it with its label.

## Layout

Choose the skeleton that fits the content: one reading column, a sidebar with an index, a full-width table or chart, a grid of scenes, or a single screen with no scroll. The starter's centered `.wrap` column is one option.

- Keep side gutters of `max(16px, env(safe-area-inset-*))`. Space siblings with grid or flex `gap`.
- Use borders and fills by role. Running text and headings sit on the page. Set apart only the objects that need it.
- Use an eyebrow only for source or scope information the heading does not already give. A label names a field, and numbering appears only for real sequences.
- Encode attention in form. A row that needs action gets a mark or a muted closed state, not only a different word.
- Put wide code and diagrams in their own `overflow-x: auto` container. Use a `<table>` only for short records that stay readable when scrolled; use expandable rows for records with long text. The page itself never scrolls sideways at 375 px.
- Draw diagrams in inline SVG with token colors and labels inside the view box. For icons, use inline Tabler outline SVGs with `currentColor`.
- Respect `prefers-reduced-motion`. Use motion only to explain a change of state.

## Copy

Give the `<title>` a specific name of two to four words, or the name the user already uses for the document. Write labels from the reader's side, in the user's language. State units next to numbers. Put the source and date of the data in the footer.

## Check the rendered page

Run the local helper after embedding fonts and before saving:

```sh
node <skill-directory>/scripts/verify-local.mjs page.html --evidence ./page-evidence
```

For the CLI, resolve `<skill-directory>` with `artifacts skills path artifacts-design`. Read [local checks](references/local-checks.md) for existing runtime requirements, optional declarative control expectations, browser selection, and report fields. The helper never installs a dependency, changes the HTML, saves, publishes, or requires service credentials. Its report proves **renderizado local** and leaves visual review required. It does not verify the retained revision or authenticated publication.

Run the [interface checks](references/interface-checks.md) before saving. They distinguish required checks from visual judgment. Render the finished page at 375 px and 1280 px in both light and dark when browser tools are available. Fix observed failures and repeat the affected checks. Report checks you could not run.

The license notices for bundled fonts and adapted guidance are in [third-party notices](THIRD-PARTY-NOTICES.md).
