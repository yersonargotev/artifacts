# Catppuccin blue application design

The library, artifact review page, and publication header use Catppuccin Mocha with blue as the primary accent. The application presents saved work and its publication state. It does not impose its appearance on the document inside the sandbox.

## Reference sources

The reference website is [catppuccin/website](https://github.com/catppuccin/website), inspected at commit `5618a222991628f2d8af556532f431c725be1721` on 2026-10-14. Its [`_typography.scss`](https://github.com/catppuccin/website/blob/5618a222991628f2d8af556532f431c725be1721/src/styles/_typography.scss) uses a native sans-serif stack. Its [`_buttons.scss`](https://github.com/catppuccin/website/blob/5618a222991628f2d8af556532f431c725be1721/src/styles/_buttons.scss) uses 120-degree gradients, including blue to sky. The [official palette](https://catppuccin.com/palette/) defines the Mocha colors.

The application adapts those choices to a compact dashboard. Base, mantle, and crust establish depth. Text and subtext establish hierarchy. Blue identifies actions and focus. Sapphire provides a related gradient endpoint. Status colors retain semantic meaning. Mauve is not an action accent.

The native font stack avoids remote font requests. The publication wrapper retains its independent stylesheet. Its trusted header is separated from the authenticated content iframe so the library link can navigate while the document keeps its own network denial policy. Tabler outline icons provide consistent geometry; their local notices retain attribution.

## Library behavior

The existing shadcn Base UI menus remain responsible for focus, keyboard interaction, and positioning. The [shadcn dashboard block](https://ui.shadcn.com/blocks) informs the sidebar, header, summary, and list composition. The dashboard presents artifact information rather than unrelated chart fixtures.

Library search and publication filters use server-rendered GET navigation. Filtering runs before pagination across the owner's records. Filtering only the current page in React would hide matching artifacts on later pages. Search parameters survive pagination and can be bookmarked. Native forms remain usable before hydration.

The dashboard query is separate from the MCP list contract. The publication home destination comes from validated dashboard configuration. Artifact titles, metadata, and HTML cannot choose that destination.

## Verification

The existing `verify-artifacts` preview drive records the baseline and updated desktop/mobile library, detail page, and publication header. The extended drive exercises search, publication filters, no-match recovery, and the publication home link. Store tests cover filtering before pagination and owner isolation. Existing identity, retained revision, export, and network containment proofs remain required.

## Publication navigation and containment

Chrome blocks even a trusted home link when `Connection-Allowlist: ()` applies to the entire wrapper. The publication therefore serves its exact revision at an authenticated content endpoint. That response retains the sandbox CSP and empty connection allowlist. The trusted wrapper has no executable scripts and loads only its same-origin content frame. Removing the wrapper allowlist permits normal panel login redirects without granting network access to the generated document.

The content endpoint revalidates the viewer session and current published revision. It denies non-iframe requests and never redirects anonymous content requests into login. The wrapper and content responses use `Cross-Origin-Opener-Policy: same-origin` to prevent a cross-origin opener from receiving messages through the frame's parent.

The retained verifier compares the actual loaded content response and keeps exact legacy `srcdoc` verification for older deployed wrappers. Network proofs must exercise the served iframe, not only the trusted header.
