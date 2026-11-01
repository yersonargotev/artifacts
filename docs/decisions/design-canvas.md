# Retained design canvases

## Decision

A `design` revision stores one JSON canvas index in `content.text` and complete HTML boards in the existing files array. The index supplies geometry, rendering order, optional pages, and optional text notes. Boards remain files so reads, immutable revisions, authorization, publication selection, and deterministic export retain their existing ownership.

[`canvasIndexSchema` and `snapshotSchema`](../../packages/contracts/src/index.ts) enforce the structure and cross-references. An index has at most 32 boards, 32 pages, and 200 notes. Every board appears exactly once in `order` and references a UTF-8 `text/html` file. The existing 32-file and 1 MiB decoded revision budgets apply to boards and other attachments together. No board table, asset server, upload lifecycle, or compilation step is needed.

[`prepare-retained.mjs`](../../skills/artifacts-cli/scripts/prepare-retained.mjs) has two explicit input forms. One positional directory prepares a validated design snapshot from `canvas.json` and flat `boards/*.html` files. Named receipt/read/check options retain their existing verifier-configuration behavior. The directory form preserves index text and board HTML, derives the title from the directory basename, and supplies an empty description. Authors can edit the emitted metadata before saving. Shared contracts validate the complete snapshot. Filesystem checks reject missing, orphan, nonregular, and invalid UTF-8 board inputs.

## Rendering and containment

The renderer table in [`previewDocument`](../../apps/publication/src/document.ts) selects [`canvasDocument`](../../apps/publication/src/canvas.ts) for a design. Both the panel preview and revision-bound publication content already call that document renderer. A board renders in a nested opaque `srcdoc` iframe with `sandbox="allow-scripts"`. Board source and notes are escaped before interpolation. Unsupported browsers receive an inert listing with escaped board source and scripts disabled.

Using `srcdoc` keeps the existing content policy and routes. The content document inherits its current network restrictions, and each board has its own opaque global context. The [publication content handler](../../apps/publication/src/http.ts) retains authenticated revision selection, sandbox CSP, and `Connection-Allowlist: ()`. This choice does not create a new executable attachment route or loosen the policy for HTML artifacts.

[`design-canvas.browser.proof.ts`](../../tests/design-canvas.browser.proof.ts) exercises actual Chrome execution, opaque origin, parent access denial, blocked fetch and popups, and ignored board messages. The proof also checks focus recovery and renderer availability behavior. This is browser behavior to keep testing. A browser change that starts blocking `srcdoc` under `frame-src 'none'` can stop board rendering without a schema change.

A board script still shares renderer resources with its host. A busy script can stall the canvas. Nested `srcdoc` WebRTC probes have also exposed fail-closed renderer crashes in the existing Chrome coverage. Focus recovery returns focus from an inert overview board when the document has focus, but script scheduling leaves a transient input window. Neither `inert` nor the recovery loop is an absolute keyboard isolation boundary. Focus view intentionally enables the selected board's inputs.

## Interaction and authoring

[`canvasDocument`](../../apps/publication/src/canvas.ts) owns drag and wheel pan, cursor-centered zoom, fit, page buttons, and board focus. Focus view uses the declared dimensions and preserves the canvas transform for return. Boards without a page use the first page when pages exist. The canvas ground follows Catppuccin Latte and Mocha. Board documents retain their own styles.

The [canvas authoring guide](../../skills/artifacts-design/references/canvas.md) records the complete index contract, geometry conventions, directory workflow, and font budget. Fonts remain embedded independently in each board through [`embed-fonts.mjs`](../../skills/artifacts-design/scripts/embed-fonts.mjs). Repeated embedded font bytes count repeatedly toward the shared revision limit.

[`design.ts`](../../.agents/skills/verify-artifacts/scripts/design.ts) drives real MCP create/read, panel focus and page selection, protected publication, browser and MCP export, digest-preserving recreation using the independent read's original file order, and the existing complete retained verifier. The [feature recipe](../../.agents/skills/verify-artifacts/features/design.md) states the local scope and separate coverage obligations.

## Scope

This canvas presents retained boards. In-browser board editing, drag-to-save placement, component properties, collaborative editing, shared font fetching, asset hosting, and offscreen script suspension remain outside this change. Those capabilities would add storage or runtime ownership that the current retained-document use case does not need.
