# REST and CLI boundaries

## Problem and decision

CLI users and direct HTTP consumers need retained artifact operations without an MCP client. Keep the artifact store as the owner of authorization, immutable revisions, optimistic concurrency, publication and transactional receipts. Add a REST adapter and typed HTTP client. MCP continues to call that same store directly.

Two independent designs compared shared-core adapters with MCP consuming REST. The latter used an in-process Fetch call in the default Worker, so it did not require a network hop. It still added serialization, another admission check and a broader MCP compatibility change. Independent REST does not need that dependency. The [design judgment](../../.audit/rest-cli/design-judgment.md) records the comparison. The [implementation contract](../../.audit/rest-cli/implementation-contract.md) contains signatures, routes and acceptance gates.

## Package ownership

`@artifacts/contracts` owns domain schemas, errors and workflow helpers without database dependencies. Existing artifacts exports remain compatible. `@artifacts/rest` owns the Fetch handler and shared bearer verification. `@artifacts/client` owns authenticated requests, response validation and archive verification. The CLI owns OAuth login, credentials, complete operation files and terminal output.

The database store keeps every mutation and receipt in one transaction. Neither HTTP adapter contains artifact SQL. The panel retains its separate OIDC session policy and direct store access. Publication retains its independent Worker and protected viewer admission.

The separate contracts package prevents a client-only installation from acquiring the server database dependencies. The server and store share one contracts runtime so an `ArtifactError` keeps its identity across package boundaries. Compiled distribution packages are built separately from workspace source exports.

## Authentication and deployment

The existing complete `MCP_URL` remains the canonical OAuth resource. REST uses `${resource}/v1`. The CLI takes that canonical resource in `login --server`, retrieves its exact protected-resource metadata and checks equality. REST subroute challenges omit `resource_metadata`, because challenge-derived metadata must match the requested URL under [RFC 9728 section 3.3](https://www.rfc-editor.org/info/rfc9728/#section-3.3). Existing MCP challenges remain compatible.

Native login uses public registration, browser authorization, PKCE and an exact loopback callback. The [native-app OAuth specification](https://datatracker.ietf.org/doc/html/rfc8252) describes that browser and callback model. The CLI receives no introspection or database secret. REST and MCP share signature verification and fresh introspection. The store independently checks live owner sessions and operation scopes before returning receipts.

Default deployment composes REST and MCP in the existing Worker. A reusable Fetch factory and REST-only Node entry point can serve the API without constructing MCP. The four existing deployed services remain sufficient. This change does not deploy production or register a second audience.

## Retries and local state

The CLI retains a complete mutation before sending it. Its operation binds the exact arguments, request ID, expected versions, owner and resource. One invocation uses the same access token for identity, edit preparation and submission, so a concurrent login cannot change its owner between requests. Retrying preserves omitted response fields and returns the original receipt. Conflicts stop the operation. A new read and deliberate new command are required to incorporate another writer's changes.

A private SQLite lock file serializes refresh and logout between CLI processes. A separate credential database commits refresh-attempt uncertainty before the network request, so process death cannot erase that marker. Login generations prevent a delayed callback from restoring signed-out credentials. Node 24 already meets the repository runtime requirement, but its SQLite API is experimental. That risk is confined to private CLI storage and is covered by subprocess tests. Uncertain refresh state must survive process death before the provider request begins.

Logout revokes refresh credentials when possible and clears local credentials. The installed provider does not revoke self-contained access JWTs. A copied JWT may remain valid until expiry. Existing central-session revocation remains the immediate cross-client boundary. The [real provider probe](../../.audit/rest-cli/oauth-probe.md) records that behavior.

## Compatibility and evidence

MCP tool names, schemas, receipt fingerprints, projections and stateless protocol behavior remain stable. The panel keeps its library, review, preview, publication and export behavior. REST changes neither the database schema nor immutable revision bytes.

The [acceptance matrix](../../.audit/rest-cli/coverage.md) requires actual CLI subprocesses, direct HTTP, MCP interoperability, the built panel, conflicting writes and lost-response retries. The [runtime record](../../.audit/rest-cli/runtime.md) distinguishes completed checks from pending gates. Design acceptance alone is not runtime proof.
