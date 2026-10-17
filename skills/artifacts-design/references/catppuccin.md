# Catppuccin roles

The starter maps the official [Catppuccin palette](https://github.com/catppuccin/palette/blob/main/palette.json) to semantic tokens. Latte serves the light theme and Mocha the dark theme. Blue is the Artifacts accent.

| Token | Role | Latte (light) | Mocha (dark) |
| --- | --- | --- | --- |
| `--page` | Page background | Base `#eff1f5` | Mantle `#181825` |
| `--surface` | Strip, table, or panel | White `#ffffff` | Base `#1e1e2e` |
| `--sunken` | Table header, hover, code | Mantle `#e6e9ef` | Crust `#11111b` |
| `--line` | Hairline divider | Surface 0 `#ccd0da` | Surface 0 `#313244` |
| `--control` | Input and button boundary | Overlay 1 `#8c8fa1` | Overlay 0 `#6c7086` |
| `--fg` | Main text | Text `#4c4f69` | Text `#cdd6f4` |
| `--muted` | Secondary text and labels | Subtext 1 `#5c5f77` | Subtext 0 `#a6adc8` |
| `--accent` | Focus, selection, primary fill | Blue `#1e66f5` | Blue `#89b4fa` |
| `--accent-ink` | Links and accent text | `#1957d0` | Blue `#89b4fa` |
| `--ok` / `--ok-ink` | Success mark / text | Green `#40a02b` / `#307820` | Green `#a6e3a1` |
| `--warn` / `--warn-ink` | Warning mark / text | Yellow `#df8e1d` / `#915c13` | Yellow `#f9e2af` |
| `--bad` / `--bad-ink` | Error mark / text | Red `#d20f39` / `#b20d30` | Red `#f38ba8` |

The Latte ink values darken the palette color so pill text reaches 4.5:1 on its soft background. Each `*-soft` token mixes 14 % of its color into `--surface`, so it adapts to both themes without a second definition.

Every text token reaches 4.5:1 on `--page` and `--surface` in both themes. `--control` reaches 3:1 for input boundaries. `--line` is decorative and must not be the only boundary of a control.

## Chart series

Use these in order after Blue. Give each series a direct label or marker as well as a color.

| Series | Latte | Mocha |
| --- | --- | --- |
| 1 | Blue `#1e66f5` | Blue `#89b4fa` |
| 2 | Peach `#fe640b` | Peach `#fab387` |
| 3 | Teal `#179299` | Teal `#94e2d5` |
| 4 | Mauve `#8839ef` | Mauve `#cba6f7` |
| 5 | Yellow `#df8e1d` | Yellow `#f9e2af` |

Mauve is a data color only, never the accent.

The palette's license notice is retained in [third-party notices](../THIRD-PARTY-NOTICES.md).
