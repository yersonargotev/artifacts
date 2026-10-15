# Task frame

The change is complete when actual authenticated CLI subprocesses and direct HTTP calls create, list, read, update, inspect history, publish and export retained artifacts. Those artifacts must interoperate with existing HTTP MCP tools and the built Astro panel. A losing concurrent write must receive a conflict. Replaying a committed request after its response is lost must return the original receipt without another revision. Ownership, missing scopes and revoked sessions must fail closed before receipt replay.

The work covers a reusable Fetch REST server, a typed HTTP client, a Node CLI with usable OAuth login, package documentation, a repository-owned artifacts-cli skill and reproducible integration proof. The comparison must decide deployment composition and whether MCP calls REST or the domain store. No database migration, UI redesign or production deployment is presumed necessary.

Rigor is high because a transport adapter can accidentally alter receipt fingerprints or admit a revoked session. Baseline is 59 passing tests. The next gates are independent architecture candidates, a cross-judge, implementation in verifiable units, real HTTP and CLI tests, browser interoperability, and independent code and decision-trail review.

# Initial grounding

A Snapshot holds metadata, content and retained attachments. ArtifactRead combines owner identity, current head, optional publication and one immutable revision. createArtifactStore owns authorization and transactional state transitions. Command receipts are scoped to the canonical owner and request ID. Schema parsing preserves omitted response fields. An explicit full response and an omitted response can hash differently, so transports must not normalize optional fields before a retry.

The bearer authorizer currently lives in apps/mcp/src/identity.ts. It verifies signature and resource claims, obtains fresh authenticated introspection, reconciles claims and constructs a verified principal. The store separately checks live central sessions and scopes. The panel uses opaque OIDC sessions and calls the same store. Publication has an independent Worker and no database credentials. Auth already supports public native registration and PKCE with loopback callbacks.

The preserved rationale is recorded in docs/decisions/artifacts.md and docs/decisions/identity.md. The former explicitly gives all SQL, receipts and concurrency to the store. The latter chose app-local authentication while callers had different credential types. REST introduces a second bearer caller, which now justifies extracting that specific shared policy without combining panel authentication.
