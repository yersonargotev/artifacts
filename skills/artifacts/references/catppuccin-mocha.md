# Catppuccin Mocha with Blue

Use a quiet reading canvas with compact tools and precise data displays. Let the artifact's purpose determine its composition. A report needs a readable document column. A calculator needs controls beside results. A chart needs room for labels and its legend.

Avoid adding application sidebars, dashboard cards, or oversized hero sections to content that does not need them. Use whitespace and typography before extra containers. Reserve filled panels for meaningful groups.

## Color roles

These values come from the official [Catppuccin palette](https://github.com/catppuccin/palette/blob/main/palette.json). Blue is the primary accent for this Artifacts direction.

The palette's license notice is retained in [Third-party notices](../THIRD-PARTY-NOTICES.md).

| Role | Mocha color | Hex |
| --- | --- | --- |
| Page | Base | `#1e1e2e` |
| Recessed region | Mantle | `#181825` |
| Deepest region | Crust | `#11111b` |
| Raised panel | Surface 0 | `#313244` |
| Hover fill or decorative divider | Surface 1 | `#45475a` |
| Required control boundary | Overlay 0 | `#6c7086` |
| Main text | Text | `#cdd6f4` |
| Secondary text | Subtext 1 | `#bac2de` |
| Muted text | Subtext 0 | `#a6adc8` |
| Primary action, selection, focus, and links | Blue | `#89b4fa` |
| Supporting accent | Sapphire | `#74c7ec` |
| Gradient endpoint | Sky | `#89dceb` |
| Success | Green | `#a6e3a1` |
| Warning | Yellow | `#f9e2af` |
| Error | Red | `#f38ba8` |
| Additional chart series | Peach | `#fab387` |

Define semantic CSS custom properties once in the inline stylesheet. Use Base text on pastel-filled buttons and badges. Use Text for content on dark backgrounds. Carry Blue consistently through actions, selected states, links, and focus; reserve other pastels for semantic or data roles.

Set `color-scheme: dark` on the document. Keep the page background consistent through the viewport. Use a two-pixel Blue focus outline with an offset so it remains visible beside a filled control.

Surface 1 is a subtle separator, not a sufficient boundary when a control relies on its outline for identification. Use Overlay 0 against Base for that case. Recheck contrast on raised panels and after opacity changes. Target at least 4.5:1 for body text and 3:1 for large text and essential control indicators.

Give status indicators a label or symbol as well as color. Give chart series direct labels, line patterns, or markers. Extend the palette only when the data needs more series.

## Type, spacing, and shape

Use a local system sans-serif stack and a system monospace stack for code. Start body copy at 16 px with a 1.5 line height. Keep prose near 65 characters per line. Use tabular numerals for aligned values. Let headings carry a stronger weight and fluid scale while small labels stay readable.

Build spacing from 4, 8, 12, 16, 24, and 32 px. Start with 24 to 32 px outer padding on wide screens and 16 px on narrow screens. Use 8 px control radii and 12 px panel radii. Reserve pills for tags and status labels.

Keep headings proportional to the content. Use sentence case unless the user's interface or language calls for another convention. Use concise action labels and explain units near inputs. Align labels, values, and controls to a consistent grid.

Let controls wrap or stack on narrow screens. Keep dense tables readable with a local horizontal scroll region when necessary. Do not hide missing layout work with page-wide overflow clipping.

Use flat reading surfaces and restrained borders. Reserve shadows for floating overlays. For an expressive heading or primary action, a restrained `linear-gradient(120deg, #89b4fa, #89dceb)` can add the website's pastel character. Keep supporting controls and data surfaces quieter. Decorative motion follows the reduced-motion checks in [interface guidelines](web-design-guidelines.md).
