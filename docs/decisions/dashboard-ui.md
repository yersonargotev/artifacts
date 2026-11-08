# Dashboard and publication controls

Astro renders the searchable library rows, publication filters, account controls, and review forms. React hydrates only the title and row menus. Their props contain labels and links, with optional icons and groups for presentation. The library uses `ArtifactSummary.createdAt` and a generic document icon because summaries contain no edited date or content format.

The dashboard uses the shadcn Base UI [button registry source](https://ui.shadcn.com/r/styles/base-nova/button.json) and [dropdown menu registry source](https://ui.shadcn.com/r/styles/base-nova/dropdown-menu.json), retrieved on 2026-10-12. Local copies remove unused variants, submenu controls, and selection controls. The source license remains in `apps/dashboard/src/components/ui/LICENSE`. Base UI owns menu focus, keyboard navigation, and positioning. Tailwind uses the dashboard's [Catppuccin Mocha blue tokens](catppuccin-blue.md) without external fonts or icon packages.

The exact dependency override keeps `@vitejs/plugin-react` at 6.1.1. `@astrojs/react` 7.0.1 declares `oxc-transform-react` ^0.145.0, and plugin 6.1.1 accepts that range. Plugin 6.1.2 requires ^0.152.0. The override prevents an incompatible peer resolution while preserving the integration's declared dependency range.

Astro's built-in `security.csp` generates script hashes in server responses. It retains the panel's existing restrictions and denies script attributes. Middleware remains the fallback for responses without a policy. The preview policy remains independent. The publication separates its trusted header from the revision-bound content response as described in the [Catppuccin design decision](catppuccin-blue.md).

The publication Worker retains its own CSS and native title, Information, and Files disclosures. It loads no dashboard assets or React runtime. Its header stays within 45% of the viewport, leaving at least 55% for the sandboxed document.

Revision selection stays in native GET forms. Publication uses the existing four-field `PublishCommand` and native POST form. Menus do not mutate artifacts. The retained verifier opens the selected export menu and native viewer disclosures before checking the same revision identifiers, archive bytes, attachment bytes, and isolation headers.

## Read mode

The owner moves between artifacts in `/read`, a two-column panel page: the scoped list on the left, the selected artifact's preview filling the right. A publication portal was rejected because the publication Worker authorizes one artifact per cookie and serves no scripts. The panel already holds the owner session and the preview route, so read mode adds no contract, REST, MCP, or Worker change.

The page reads the same `panel.library` page as the library. The `artifact` parameter selects a card by ID. When it names an artifact outside the page, such as a shared link to the second page, `panel.artifact` supplies its head revision and title. Without it the first card is selected. Filter, search, and page links drop the selection, like the cursor, so the list and preview stay in agreement.

Each row is a GET link, so read mode works without JavaScript. A bundled script, hashed by `security.csp`, swaps the preview on a click or on `j` and `k`, pushes the row URL, and restores the selection on `popstate`. It replaces the iframe rather than setting its `src`, because a frame navigation adds a history entry and Back would walk the frame instead of the reader URLs. The preview keeps the detail page's sandbox: `markdownPreviewSandbox` for Markdown and `allow-scripts` otherwise. In read mode the sidebar's project links stay in read mode.
