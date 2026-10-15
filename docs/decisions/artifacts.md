# Retained artifacts and protected publication

## Decision

Store complete bounded revision snapshots in Turso. A snapshot contains metadata, a content document, and attachment bytes. Immutable revisions share one canonical owner and have separate head and published pointers. The store owns all authorization, session checks, optimistic concurrency, receipts, archive generation, and publication grants. MCP and HTTP adapters do not contain artifact SQL.

Two independent designs compared transactional snapshots with an R2-backed catalog. The initial known requirement needs small complete artifacts, not large websites. A 1 MiB decoded limit and 32 attachments let accepted bytes and pointers commit together without a separate upload lifecycle. The R2 candidate contributed deterministic archive structure and artifact-scoped viewing. [The recorded comparison](../../.audit/artifact-e2e/design-judgment.md) contains the scoring and synthesis.

Use native Cloudflare Workers for authorization, MCP, the Astro panel, and publication. Workerd and deployed flows verify the actual web libSQL path. The Node dashboard build remains available locally. Artifact contracts and the store share one external package instance in the Node build so domain errors retain their identity; Worker builds bundle both.

## Commands

An owner-scoped request receipt commits with each mutation. Matching retries return the original result after checking current authority. A request ID reused with changed arguments fails. Updates compare the expected head revision; publication compares its expected version before a same-revision no-op. Revision membership is enforced by composite foreign keys, and a trigger rejects historical updates.

Exports are provider-neutral ZIPs containing the metadata/provenance manifest, content document, and every attachment from the chosen immutable revision. File order, timestamps, and attributes are fixed. Both MCP and panel use the same archive implementation.

## Publication boundary

The publication Worker has only public origins and two publication secrets. It has no database credential. An encrypted transaction cookie binds the initial browser to artifact and state. The panel's live owner session issues a hashed short-lived grant. Exchange consumes that grant once and returns an artifact-scoped viewer, limited by its central session. Every subsequent document and file request rechecks the live central session, ownership, and current publication through a service-authenticated endpoint.

Both internal endpoints authenticate in their own handlers. Middleware also checks the service credential before exempting the exact internal routes from browser Origin policy. This redundancy closes framework route aliases, including trailing slashes, without treating Origin as authentication.

Published HTML executes only in an opaque iframe sandbox. Escaped metadata and the trusted wrapper remain outside it. CSP blocks executable external assets, subframes, forms, workers, and access to the parent. Raw panel preview accepts only iframe browser requests and has same-origin frame ancestry protection; the parent panel also restricts frames.

The publication iframe loads an authenticated revision-bound content response with its own sandbox CSP and empty connection allowlist. The trusted wrapper has no scripts and can navigate back to the panel. The content route checks the current publication and live session on every request. Cross-Origin-Opener-Policy separates trusted application documents from cross-origin openers, which connection allowlists do not cover. The [blue dashboard decision](catppuccin-blue.md) records the navigation change and its verification.

CSP does not cover every network channel. The connection allowlist header disables explicit connections, including WebRTC, in supported Chrome. Current Chrome 154 was verified using an active unrestricted UDP control and zero packets from both protected surfaces, while interaction and downloads still worked. Chrome 152+ support follows [the browser vendor's documentation](https://developer.chrome.com/blog/connection-allowlist-announcement). Other user agents receive escaped HTML source with scripts disabled. The user agent selects rendering compatibility; it never admits access. Authentication is mandatory in both modes.

Attachments always download with `nosniff` and restrictive sandbox headers. Their URLs pin the displayed revision. Once that revision is no longer published, its attachment URL is denied so a document cannot mix historical and current file bytes.

## Identity and deployment

The existing identity moved through a consistent snapshot and a conflict-checked destination transaction. All application rows and the canonical owner were compared before configuration changed. The original database and private configuration remain available for rollback. New public confidential clients coexist with the migrated local clients because issuer/resource/callback origins changed.

The authorization Worker's metadata transport allows only the two exact trusted vendor documents used by Codex and Claude. Redirects and unapproved JWKS destinations fail. Node retains its existing DNS-pinned transport. Both deployed clients completed real OAuth; successful builds alone were not accepted as that evidence.

## Initial scope

HTML is self-contained; attachments are retained downloads rather than relative executable website assets. Markdown and text render inertly. Complete history is paginated at five revisions by default and ten maximum; lists use lightweight summaries. This scope supports the first accepted end-to-end artifact without an object-storage or compilation layer.
