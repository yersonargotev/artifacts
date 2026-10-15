# Implementation contract

Status is accepted after independent cross-judgment. See design-judgment.md. No production changes are authorized.

## Chosen data shapes

Reuse Snapshot, Actor, ArtifactRead, Revision, Publication, Archive, UpdateInput and the existing strict schemas. Move their canonical implementation plus workflow/serialization to a database-free contracts package. Preserve existing public package entry points as compatibility re-exports. The store is the single owner of domain state, receipts, authorization and transactions.

CLI prepared operations are a discriminated create/update/publish union. Each retained envelope binds the exact command to the canonical resource and verified owner before sending. Credentials are separate per-resource records with a generation/epoch and signed-in/signed-out state. No command contains credentials.

## Public package boundaries

- @artifacts/contracts owns domain schemas, types, error identity and pure workflow helpers. It has no DB, ZIP implementation, MCP, HTTP server or CLI dependency.
- @artifacts/rest exposes createArtifactRestApp and the shared bearer authorizer entry point. It accepts a caller-created ArtifactStore and standard configuration and returns a Fetch handler. It contains no artifact SQL.
- @artifacts/client exposes createArtifactHttpClient, domain methods and typed errors. It depends only on contracts and runtime Fetch. It does not own credential storage or automatic conflict handling.
- apps/cli exposes the artifacts Node binary. It owns arguments, native OAuth, private local credentials, retained operation files and output.
- apps/mcp composes REST and MCP at the host entry points. MCP tools still call the store directly. The shared bearer implementation moves without changing existing verification policy.
- The Astro panel and publication keep their current admission and store APIs.

## Resource, URLs and discovery

Keep the exact existing MCP_URL as the canonical OAuth resource. Default CLI login is `artifacts login --server RESOURCE`. The typed client accepts that resource and derives the REST base `${resource}/v1`. A resource ending at /mcp therefore has routes under /mcp/v1. The path name is retained for existing grants and does not require the MCP protocol.

The standalone Fetch REST handler serves the canonical protected-resource metadata derived from the resource URL, plus health and REST routes. It does not construct or import the MCP handler. Add a standalone Node REST entry point and command, using the existing resource host/listener configuration. It is an alternative to the combined local listener, not an additional mandatory service. Default Worker deployment remains the existing four services.

The CLI fetches metadata directly using the configured canonical resource and checks exact resource equality. It does not infer a resource from a REST subroute challenge. REST subroute challenges contain Bearer error/scope without resource_metadata. This avoids a URL mismatch under RFC 9728 section 3.3. Existing MCP metadata and challenges remain compatible. Endpoint URLs require HTTPS except exact loopback HTTP, no credentials/query/fragment, and no credential-bearing redirects. OAuth endpoints remain on the verified issuer origin.

## REST operations

Paths below are relative to `${resource}/v1`.

| Method | Path | Body or query |
| --- | --- | --- |
| GET | /identity | None |
| POST | /artifacts | Complete existing create command |
| GET | /artifacts | limit, cursor |
| GET | /artifacts/:artifactId | revisionId, response |
| PUT | /artifacts/:artifactId | Complete existing update command, route and body IDs must match |
| GET | /artifacts/:artifactId/history | limit, beforeSequence, response |
| PUT | /artifacts/:artifactId/publication | Complete existing publish command, route and body IDs must match |
| GET | /artifacts/:artifactId/revisions/:revisionId/export | Exact binary ZIP with filename and SHA-256 headers |

Return 201 for create and replay, 200 for other successful operations. Use `{ error: { code, message, details } }` for stable errors. Preserve conflict details. Map invalid input to 400, unauthenticated to 401, forbidden to 403, not_found to 404, conflicts to 409, oversized body to 413, wrong content type to 415, unsupported method to 405 with Allow, and dependency failure to 503. Use no-store on protected responses and errors. Authenticate operation scopes before dispatch, then retain the store's independent checks. Bound request streaming at 8 MiB before parsing. Query parameters must reject unknown or repeated keys and malformed integers.

Full/compact/summary projection follows existing behavior after full receipts return. Preserve omitted response and every command argument. Binary export decodes the current deterministic Archive, never rebuilds it. The client validates JSON schemas and archive digest, refuses redirects, and bounds responses for the maximum ten-revision page.

## CLI behavior

Support login, logout, whoami, create, list, read, update, edit, history, publish, export and retry. Use standard Node argument parsing or an established installed parser. JSON goes to stdout, diagnostics and operation recovery guidance to stderr. Explicit complete command-file input is supported for mutations. Snapshot files and convenience edit changes preserve the complete domain shape.

Retain a complete operation before its first request. Use collision-resistant request IDs, private files and exclusive creation. Retry loads that exact operation, verifies current resource/owner, and sends unchanged input. Never rebuild an update or alter expected versions after a conflict. One submission per HTTP-client method call. CLI may simply expose explicit retry instead of hiding network retries. Retained receipts and fresh state must be distinguishable.

Use openid-client 6.8.8 already in the repository for native OAuth code/PKCE and refresh. Bind exact loopback before browser navigation, validate state/path/issuer, bound callback and network waits, clean listeners on all exits, and support --no-browser. DCR uses a public native client and requires no server secret. Normal commands may accept an access token through a documented environment variable for automation, never require a token argument.

Use a private local SQLite credential table with Node 24's builtin only in the CLI. A separate credential-free SQLite lock file holds process exclusion while the credential database commits refresh-attempt uncertainty before network I/O. Document its experimental status. Transactions serialize refresh and logout across processes and release on process death. Keep network waits bounded, reread credentials after lock acquisition, and advance an epoch for login/logout so a late callback cannot restore cleared credentials. Do not hold a writer transaction while waiting for browser interaction. Store directory/files must be private. Reuse the profile-specific DCR client. Persist refresh-attempt uncertainty before the network request in a committed write. A marker inside an uncommitted transaction cannot survive process death. Refresh uncertainty outside the provider replay window requires login, never indefinite replay of an old token.

Logout revokes refresh if possible and clears local credentials. Report unconfirmed remote revocation honestly. Issued JWTs can remain valid until expiry or existing central-session revocation. Add no new global-revocation endpoint.

## Distribution and documentation

Keep workspace source exports working. Build compiled ESM JavaScript and declarations into a separate package staging directory. Produce local tarballs and a real installed Node bin with no tsx dependency. Client consumption must not install DB dependencies. Preserve one contracts runtime between separately packed store and REST so domain errors map correctly. Validate a real conflict in an external consumer.

Provide README/reference documentation for packages and CLI, exact direct REST examples, configuration, authentication, error/retry behavior, deployment topology and compatibility. The repository canonical skill belongs in skills/artifacts-cli/SKILL.md with only resources it needs. It must work when copied by itself and be forward-tested by a fresh agent using real commands.

## Verification and work ownership

Follow .audit/rest-cli/coverage.md. Root owns architecture, decisions and final review. One implementation owner coordinates disjoint code work and tests after this contract is accepted. Implementation is sequenced through contracts, REST, client/CLI, integration/packaging. Run relevant checks at each boundary. Do not run Node panel and Worker builds concurrently. Existing tests, typecheck, browser paths and Worker builds are final gates. New proof must use real HTTP, CLI subprocesses and actual Chrome, not store calls as authoring evidence.

No production deployment, npm publication, account mutation outside disposable fixtures, merge, force push or data deletion. A ready PR is permitted by the explicitly invoked workflow after independent review and verified checks.
