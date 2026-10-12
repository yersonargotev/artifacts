# Retained artifact workflow

Artifacts keeps full immutable revisions and selects one retained revision for a protected publication. This change completes the owner's review and publication workflow without introducing a browser editor or another storage model.

## Decisions

The artifact store remains the only writer. Existing command receipts, owner checks, live sessions, draft-head comparisons, and publication-version comparisons remain authoritative.

MCP callers can request compact responses. The existing full responses remain the default. Optional response fields have no parsing defaults, so old commands retain their canonical hashes. A supplied response mode belongs to the command's exact retry arguments. The store retains and returns the full result internally. The MCP adapter projects it after the command succeeds.

Client editing produces one complete prepared command. It reads the current head, preserves omitted metadata and attachments, pins the expected revision, and keeps one request ID. The caller can persist that command and retry it unchanged. Preparation never overwrites a conflict by reading a newer head automatically.

The panel derives saved, selected, published, and pending state from retained revision identifiers. Review includes escaped metadata and content comparisons and decoded attachment inventories. The native publication action submits the selected revision, observed publication version, and original request ID. The server independently reads the publication after the command. A concurrent replacement appears as a changed publication rather than a successful current-publication claim.

Retained verification receives a full independent read and an authenticated browser context. It checks actual panel and publication frames, revision identity, policies, downloaded bytes, content expectations, and mobile layout. It never changes retained artifacts or revokes sessions. Existing disposable recipes continue to test the application separately.

New wrappers expose exact revision markers. Current deployments without those markers use the existing revision labels, pinned preview URL, exact ZIP, exact srcdoc, and revision-bound attachment links as evidence. Partial or malformed markers fail verification. They never enable a weaker fallback.

## Alternatives

Two independent candidates considered optional response modes and four additional summary tools. The cross-judge selected optional modes to avoid duplicate invocation paths. The prepared, persistable command and adapter projections were taken from the second candidate.

A server patch protocol would add attachment replacement and deletion rules to another writer interface. A complete prepared client command preserves the existing store contract instead.

Escaped before-and-after text panes provide a complete comparison. A visual diff engine and a browser editor add separate state and rendering requirements and are outside this change.

## Delivery and evidence

Implement and validate the package and MCP contracts first. Integrate panel review and publication next. Run retained verification and existing browser proofs against the integrated product. Finish with independent diff and decision-trail review.

The decisions are recorded in [decisions.tsv](decisions.tsv). Local runtime evidence stays in ignored `.test-artifacts/` directories. Deployed read-only verification is reported separately from local feature proof. Deployment and integration into `main` require the operator's authorization.
