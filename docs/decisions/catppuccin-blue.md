# Catppuccin blue application design

The library, artifact review page, and publication header use Catppuccin with blue as the primary accent. The panel has a dark theme from Catppuccin Mocha and a light theme from Catppuccin Latte. The publication header stays on Mocha. The application presents saved work and its publication state. It does not impose its appearance on the document inside the sandbox.

## Reference sources

The reference website is [catppuccin/website](https://github.com/catppuccin/website), inspected at commit `5618a222991628f2d8af556532f431c725be1721` on 2026-10-14. Its [`_typography.scss`](https://github.com/catppuccin/website/blob/5618a222991628f2d8af556532f431c725be1721/src/styles/_typography.scss) uses a native sans-serif stack. Its [`_buttons.scss`](https://github.com/catppuccin/website/blob/5618a222991628f2d8af556532f431c725be1721/src/styles/_buttons.scss) uses 120-degree gradients, including blue to sky. The [official palette](https://catppuccin.com/palette/) defines the Mocha colors.

The application adapts those choices to a compact dashboard. Base, mantle, and crust establish depth. Text and subtext establish hierarchy. Blue identifies actions and focus. Sapphire provides the endpoint of the 120-degree gradient on the primary action. Status colors retain semantic meaning. Mauve is not an action accent.

The panel serves its own fonts, so it makes no remote font request. The publication wrapper retains its independent stylesheet and fonts. Its trusted header is separated from the authenticated content iframe so the library link can navigate while the document keeps its own network denial policy. Tabler outline icons provide consistent geometry; their local notices retain attribution.

## Tokens and scales

`tokens.css` owns every literal value in the panel. Tokens are named by function, not by palette entry: `--bg`, `--bg-chrome`, `--bg-sunken`, `--bg-raised`, and `--bg-hover` for surfaces; `--border-subtle`, `--border`, and `--border-strong` for lines; `--text`, `--text-2`, and `--text-3` for the three text tiers. Dividers inside a card or table use `--border-subtle`. Outlines of cards, controls, and popups use `--border`. Hover surfaces use `--bg-hover`.

Translucent color comes from three steps mixed from the accent with `color-mix`. `--accent-a1` (9%) fills selected rows and tinted surfaces. `--accent-a2` (16%) fills the active navigation item, a highlighted menu item, a pressed toggle, and the text selection. `--accent-a3` (32%) draws tinted borders. Warning and success use the same pattern with `--warn-a1`, `--warn-a3`, `--ok-a1`, and `--ok-a3`. A surface that was a translucent neutral is now a solid surface token. Because every step derives from its base color, another theme gets the steps by redefining the base color only.

The panel uses seven font sizes, `--text-2xs` (11px) to `--text-2xl` (28px), with body text at `--text-md` (14px). It uses four radii, `--r-sm` (6px), `--r-md` (8px), `--r-lg` (12px), and `--r-full`, plus `0` and `50%` for a true circle. Tailwind's font size and radius namespaces point at the same tokens, so a utility class in `ui/*.tsx` lands on the same scale as `panel.css`.

## Themes

The panel has two themes. Dark is the default. This replaces the earlier decision that the panel is dark only.

The owner switches the theme with a button in the navigation rail. The choice persists in the `panel_theme` cookie for a year. The server reads the cookie, accepts only `dark` or `light`, renders anything else as dark, and writes the result as `data-theme` on `<html>`. The first byte of markup therefore carries the stored theme, so a cold load paints that theme first and needs no inline script. The button is a form that posts to `/theme`, which sets the cookie and redirects to the same-origin path and query that sent it. It works without JavaScript. With JavaScript, the click flips `data-theme` in place, writes the same cookie, and keeps the page state. The button names the action, such as Cambiar a tema claro, in its accessible name and title, and shows a sun in the dark theme and a moon in the light theme. `meta name="theme-color"` takes the theme's `--bg`.

`tokens.css` defines every color token once in `[data-theme="dark"]` and once in `[data-theme="light"]`, with the same names, and each block sets `color-scheme`. The alpha steps, the cover wash, and the project tones derive from those tokens, so no other stylesheet branches on the theme. The sandboxed preview and the publication Worker keep their own appearance. The preview iframe keeps a white background in both themes.

The light theme starts from Latte. Its text and status colors are darker than Latte, because Latte's values fail on the panel's sunken, hover, and tinted surfaces. The three text tiers keep the same contrast steps as the dark theme on `--bg`: about 11, 7.4, and 6. The project tones are darker versions of their Latte hues, because a project chip uses its tone as text.

### Contrast rule

Every rendered text node measures at least 4.5 to 1 against the background it sits on, in both themes. The background is the composite of every layer under the text, including translucent tints and gradients. The rule covers hover and keyboard focus on rows, links, buttons, and menu items, placeholders, disabled controls, selected rows and cards, open menus and dialogs, and selected text. Selected text uses `--text` over `--accent-a2`, and `--on-accent` inside a primary button. At 32% the selection put `--text` below 4.5 on the dark project cover, so it uses the 16% step.

`tests/panel-theme.browser.proof.ts` enforces the rule in `pnpm test:browser`. It seeds every project tone, opens the main pages at 1440 and 390 wide in both themes, measures every text node, and fails below 4.5. It also proves the toggle with and without JavaScript, the cookie validation, and the redirect target validation.

## Typography

The panel uses two variable fonts: Inter Variable for text and JetBrains Mono Variable for code, slugs, and identifiers. This replaces the native font stack, which rendered a different face on each operating system. The `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` packages, pinned to exact versions, supply the files. `fonts.css` declares only the latin and latin-ext subsets in the normal style, because the Spanish interface needs nothing else and uses no italics. The build emits the four `woff2` files as same-origin assets in both the Node and the Cloudflare builds, and `unicode-range` makes the browser fetch latin-ext only for a character outside latin. The panel makes no request to another origin, and the CSP stays unchanged. Both families use the SIL Open Font License, and `styles/OFL.txt` keeps their copyright lines and the license text.

`--font-sans` and `--font-mono` in `tokens.css` name each family with a system fallback, and every `font-family` in the panel styles comes from one of them. Tailwind's font namespace points at the same tokens. Faces use `font-display: swap` with no preload, because a measured cold load with the fonts held back 800ms showed no layout shift on the main pages. Body text uses a letter spacing of -0.006em and grayscale antialiasing on macOS, and monospace text uses a letter spacing of 0. Counts, revisions, and times use tabular numerals so digits align in columns and do not shift as they change.

## Panel effects

`effects.css` applies the 120-degree gradient to `[data-variant="primary"]` and the rail's brand mark with no shadow, the cover wash to `.project-cover`, and the indicator to current or selected items. Destructive primary actions keep a solid red background. Other buttons use `--bg-raised` with a `--border` outline.

Current and selected items have no glow. A current rail item, the current reader item, the current project filter, and a selected table row or card show a 3px `--accent` bar on their leading edge over an `--accent-a1` or `--accent-a2` surface. Detail tabs keep their underline, and the status filters and view toggle keep their tinted or raised fill. This replaces the earlier decision to mark active items with a blue glow.

The focus ring is `2px solid var(--accent)` with a 2px offset. Shadows come only from `--shadow-1`, for the reader's document card, and `--shadow-2`, for menus, dialogs, and popups. A dialog dims the page with `--scrim`.

## Motion

Motion uses three durations, `--dur-1` (90ms), `--dur-2` (160ms), and `--dur-3` (260ms), and two curves, `--ease-out` and `--ease-in-out`. Buttons, links, rows, inputs, and menu items transition color, background, border, and transform over `--dur-1` with `--ease-out`. A pressed button scales to 97%. Under `prefers-reduced-motion: reduce`, the panel removes every transition and animation.

## Conventions test

`tests/panel-conventions.test.ts` parses every panel stylesheet and every Astro `<style>` block. It fails on:

- a glow token or any shadow other than `none` or one shadow token on its allowed subject;
- a gradient outside its effect token, or an effect token outside its selector scope;
- a font size or `font` shorthand that does not resolve to a `--text-*` step, and a radius that is not an `--r-*` step, `0`, or `50%`;
- a `font-family` or `font` shorthand whose family is not `--font-sans` or `--font-mono`, a `--font-*` definition outside `tokens.css`, or an `@font-face` outside `fonts.css`;
- a `url()` or `@import` that points at another origin;
- a transition or animation duration or easing that does not come from the motion tokens;
- a literal color outside `tokens.css`, including a Tailwind palette or arbitrary color class or an inline color in markup;
- a `[data-theme]` selector, a `prefers-color-scheme` query, or a Tailwind `dark:` variant outside `tokens.css`;
- a Tailwind shadow, ring, gradient, off-scale size, or off-scale radius class, or an inline shadow, font family, font size, or radius in markup;
- a `<link>` in markup other than the same-origin icon, so no layout loads a font or font stylesheet through a link tag.

It also checks that both theme blocks in `tokens.css` define the same tokens and their own `color-scheme`, that the `theme-color` values match each theme's `--bg`, that `tokens.css` defines the exact scale values and the two font tokens, that `fonts.css` declares exactly the four packaged faces, that both font packages are pinned to an exact version, and that `panel.css` holds the reduced-motion rule.

## Library behavior

The existing shadcn Base UI menus remain responsible for focus, keyboard interaction, and positioning. The approved panel prototype sets the shell: a navigation rail, a top bar, and a status bar, described in [Dashboard and publication controls](dashboard-ui.md#shell). The [shadcn dashboard block](https://ui.shadcn.com/blocks) informs the summary and list composition. The dashboard presents artifact information rather than unrelated chart fixtures.

Library search and publication filters use server-rendered GET navigation. Filtering runs before pagination across the owner's records. Filtering only the current page in React would hide matching artifacts on later pages. Search parameters survive pagination and can be bookmarked. Native forms remain usable before hydration.

The dashboard query is separate from the MCP list contract. The publication home destination comes from validated dashboard configuration. Artifact titles, metadata, and HTML cannot choose that destination.

## Verification

The existing `verify-artifacts` preview drive records the baseline and updated desktop/mobile library, detail page, and publication header. The extended drive exercises search, publication filters, no-match recovery, and the publication home link. Store tests cover filtering before pagination and owner isolation. Existing identity, retained revision, export, and network containment proofs remain required.

## Publication navigation and containment

Chrome blocks even a trusted home link when `Connection-Allowlist: ()` applies to the entire wrapper. The publication therefore serves its exact revision at an authenticated content endpoint. That response retains the sandbox CSP and empty connection allowlist. The trusted wrapper has no executable scripts and loads only its same-origin content frame. Removing the wrapper allowlist permits normal panel login redirects without granting network access to the generated document.

The content endpoint revalidates the viewer session and current published revision. It denies non-iframe requests and never redirects anonymous content requests into login. The wrapper and content responses use `Cross-Origin-Opener-Policy: same-origin` to prevent a cross-origin opener from receiving messages through the frame's parent.

The retained verifier compares the actual loaded content response and keeps exact legacy `srcdoc` verification for older deployed wrappers. Network proofs must exercise the served iframe, not only the trusted header.
