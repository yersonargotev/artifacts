# Artifact document design

Generated artifact documents looked weaker than comparable Claude artifacts. A side-by-side review on 2026-10-17 found three causes.

- The CLI skill had no design guidance. Only the MCP skill carried the visual references, so CLI-authored artifacts used ad hoc styles.
- Documents used only the system font stack. The sandbox policy allows `font-src data:` and nothing else, so a Google Fonts link silently falls back.
- The default palette was dark only. Badges used saturated pastel fills, and the accent drifted from blue to mauve.

## Decision

The `artifacts-design` skill owns document design for both the MCP and CLI skills. The CLI bundles it next to `artifacts-cli`.

The skill bundles Latin subsets of Bricolage Grotesque, Public Sans, JetBrains Mono, and Newsreader under the OFL. `scripts/embed-fonts.mjs` rewrites a page in place with `data:` font faces for the families it names. It is idempotent and refuses output above the 1 MiB revision limit. A typical page gains about 135 KB. The sandbox policy is unchanged. Documents still make no network requests.

The starter template follows the viewer's system theme. Latte is the light theme and Mocha is the dark theme, with Blue as the only accent. Status uses soft fills with darkened ink colors that reach 4.5:1 in Latte. The application shell keeps the decision in [Catppuccin blue application design](catppuccin-blue.md).

`artifacts skills get --full` labels binary files with their size instead of printing their bytes, so loading the design skill does not put font data into an agent's context.
