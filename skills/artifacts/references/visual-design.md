# Visual design for HTML artifacts

## Compose for the reader's task

Choose the dominant visual and reading order before writing markup. Make the content answer the user's question as soon as the document opens.

| Purpose | Useful composition |
| --- | --- |
| Explain a concept | A visual sequence that shows one relationship or change per scene; read [visual explanations](visual-explanations.md) for beginner requests. |
| Present a report | A clear conclusion, readable document column, and evidence beside the claims it supports. |
| Compare options | Aligned criteria, consistent scales, and visible tradeoffs; use a table or chart when alignment carries meaning. |
| Explore data | A dominant chart or table, nearby filters, and an obvious result count or summary. |
| Calculate or simulate | Labeled inputs beside the result they change, explicit units, and a useful starting example. |

Let these structures combine when the task needs them. Use a card for a distinct group, a sidebar for real navigation, and a large introduction when it earns space. Size the main diagram, chart, or result to carry the page's hierarchy.

## Establish one visual language

Choose a palette, type hierarchy, spacing rhythm, and icon family for the whole document. Use semantic CSS custom properties for repeated roles. Preserve a supplied brand or reference instead of blending it with an unrelated default.

For a dark tool or data display without a specified style, [Catppuccin Mocha with Blue](catppuccin-mocha.md) provides a complete starting palette. Reading pieces and illustrations can use another fitting light or dark direction. A shared palette does not require a shared page layout.

Make typography do visible work: distinguish the title, section headings, labels, body, and data through scale and weight. Use a local sans-serif stack for tools, a local serif stack when an editorial voice helps, and monospace for code. Keep body text around 16–18 px, prose near 60–75 characters per line, and numbers aligned with tabular numerals. Use fluid heading sizes that remain proportionate in an embedded preview.

Build space into the composition: generous separation between ideas, tighter spacing within a group, and consistent alignment across related elements. Start with a 4 px spacing rhythm, 16 px narrow-screen gutters, and 24–40 px wide-screen gutters. Adjust density to the task.

Use gradients deliberately: a restrained blue-to-sky accent can emphasize a primary action or an expressive introduction. Keep reading surfaces calm and chart colors interpretable. Check text at the weakest-contrast point of a gradient and keep a solid-color fallback.

## Use icons and images for meaning

For new interface icons, use Tabler outline SVGs as one consistent family, embedded inline with a 24×24 view box, `currentColor`, and consistent stroke width. Use icons for recognizable actions and states, with text labels where meaning is uncertain. Decorative icons use `aria-hidden="true"`; an icon-only button needs its own accessible name. Preserve an existing coherent icon system when revising a styled artifact.

Fetch only the SVGs needed while authoring; the saved document must work without an icon CDN or runtime package. Retain the upstream license when copying third-party assets. If the family is unavailable, use clear text labels. Use diagrams or substantive imagery to explain a concept; an interface icon cannot carry that explanation.

## Make the document work

Give each visible control an observable local result. A filter changes shown content, a calculator recomputes, and a reset restores its stated defaults. Show meaningful initial values, empty states, and input errors. For a static mockup requested by the user, identify it as a mockup.

Keep interactions understandable within the artifact: an in-document action can change its local state, while retained saves and publication happen through MCP. Apply [interface guidelines](web-design-guidelines.md) for keyboard behavior, responsive layouts, motion, and browser checks.

## Sources

The visual direction draws on [catppuccin.com](https://catppuccin.com/) and the actual [website source](https://github.com/catppuccin/website), reviewed on 2026-10-14: [responsive typography](https://github.com/catppuccin/website/blob/main/src/styles/_typography.scss), [spacing and width](https://github.com/catppuccin/website/blob/main/src/styles/_scaffolding.scss), and [gradient button accents](https://github.com/catppuccin/website/blob/main/src/styles/_buttons.scss). Blue is the Artifacts accent choice. [Tabler Icons](https://github.com/tabler/tabler-icons) is the chosen icon family, independent of the website's icon implementation.
