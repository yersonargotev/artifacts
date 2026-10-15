# Independent design judgment

Recommend `candidate-shared.md` as the base, with corrected resource discovery and two bounded grafts from `candidate-rest.md`. Both designs preserve the existing store as the artifact authority. Independently usable REST and CLI do not require MCP to consume REST. This is a design verdict, not runtime acceptance.

Throughput checkpoint is not applicable to this read-only investigation. Read both candidates, the rubric, grounding, Arena, Poteto, and design red flags end to end. Checked relevant package exports, error handling, Node support, and the primary RFC. No application changes or tests ran. No child agents were used. The parent retains final selection.

## Scores

Scores assess the proposals as written, before repairs. Five is strongest. Planned verification earns design credit but does not count as completed evidence.

| Rubric criterion | Shared core | MCP consuming REST | Reason |
| --- | --- | --- | --- |
| Preserve isolation, revocation, revisions, receipts, CAS, and publication | 5 | 5 | Both leave authorization-before-replay and transactional mutations in the existing store. Both preserve omitted response fields and prohibit automatic rebasing. Shared lines 344-350 and REST lines 230-232. |
| Complete independently usable authenticated HTTP and CLI workflow | 3 | 4 | Both cover every existing artifact operation, native login, refresh, logout, and retained retry. Shared discovery explicitly mismatches its advertised resource at line 263. REST uses canonical-resource discovery but its subroute challenges need correction at line 200. |
| Concentrate domain and authentication decisions behind small boundaries | 5 | 3 | Shared contracts isolate installation dependencies and preserve class identity at lines 119-136. REST has useful domain methods, but its single client/server package and bundled runtime contracts leave install dependencies and error identity unresolved at lines 249-253. |
| Preserve MCP, panel, and deployment contracts | 5 | 3 | Shared keeps MCP direct and shares only bearer policy at lines 126-128. REST deliberately migrates MCP and adds admission reentry at lines 206-210. Both retain panel sessions and four deployed services. |
| Minimize complexity while providing real cross-transport proof | 3 | 3 | Shared avoids internal HTTP but accepts experimental SQLite. REST uses an unspecified lock dependency and adds internal serialization plus a second identity check. Both propose real races and dropped-response tests; neither has run them. |
| Total | 21/25 | 18/25 | The smaller stable MCP change wins after discovery repair. |

## Required repairs and risks

1. Shared line 263 is a discovery blocker. `/.well-known/oauth-protected-resource/api/v1` cannot return a `resource` ending in `/mcp`. The advertised resource must equal the identifier used to construct the metadata URL. Both candidates also attach existing metadata challenges to REST operation subroutes. RFC 9728 section 3.3 requires challenge-discovered metadata to match the requested URL too. See the [metadata validation requirements](https://www.rfc-editor.org/rfc/rfc9728.html#section-3.3).

   Use canonical-resource login and direct discovery at `/.well-known/oauth-protected-resource/mcp`. Require exact returned-resource equality. Keep `/mcp` as the OAuth audience. Use REST routes below `${resource}/v1`. REST subroute challenges can retain Bearer scope/error information without `resource_metadata`; document direct canonical discovery. Keep the existing metadata challenge on the exact MCP resource endpoint. The standalone REST handler must serve canonical metadata without constructing MCP. This repairs discovery without creating a second audience or changing provider grants. The parent independently proposed the same repair after the initial finding.

2. REST lines 179 and 253 promise reconstructed `ArtifactError` values while bundling runtime contracts into the client. The existing MCP checks `instanceof ArtifactError` at `apps/mcp/src/http.ts:42`. Dashboard code also depends on this class at `apps/dashboard/src/publish.ts:30` and `apps/dashboard/src/publication.ts:21`. Separately bundled constructors can turn a conflict into `unavailable`. This is a packaging risk, not an observed failure. Adopt shared lines 130-136 with one external contracts runtime and explicit compatibility re-exports. Provoke an actual store conflict through an installed server and assert HTTP 409. If MCP ever consumes the client, also assert its exact structured error.

3. Runtime import cleanliness is insufficient for install cleanliness. `packages/artifacts/package.json:10` installs the database package, Drizzle, and fflate even for a pure subpath import. REST lines 28, 93-95, and 249-253 leave the packed dependency and declaration strategy underspecified. A combined HTTP package can also install server authentication dependencies for client-only consumers. Shared lines 119-136 provide a clearer solution. Keep distinct contracts, client, and server packages, compiled exports, self-resolving declarations, and an executable CLI. Inspect the installed dependency tree, not only a bundle graph.

4. Shared lines 332-334 explicitly observed the experimental `node:sqlite` warning. SQLite provides real process-owned locking and atomic state updates, but adds a local database and API stability risk. Plain private files are a simpler representation. They still require a proven cross-process exclusion mechanism, atomic replacement, crash recovery, and logout generations. REST line 222 names no selected library and provides no lock proof, so it is not yet a demonstrated simpler implementation. Existing `package.json:7` already requires Node 24 or newer. Retaining private SQLite is defensible for this increment if the CLI documents its supported Node range and passes the subprocess proofs. Keep its schema private and do not extend it to artifact command storage. Do not replace it with stale-lock stealing merely to remove the database.

5. The REST alternative is genuinely MCP consuming REST. Its injected Fetch call still serializes commands, authenticates again, parses responses, and reconstructs errors at REST lines 59-73 and 206-210. It is not a network hop in the default deployment. Rejecting it solely as a network availability dependency would misread this candidate. Its remaining cost is unnecessary protocol work and a broader compatibility change. The user requested independent transports, not one mandatory remote contract for all adapters.

## Base and grafts

Keep shared ownership and its package split. The store remains the only artifact writer. A REST Fetch adapter and MCP adapter call it directly. They share the extracted bearer policy. The panel retains its distinct session policy. The HTTP client owns route encoding, authenticated requests, response validation, and export decoding. The CLI owns login, credential rotation, immutable operation files, stdout, and exit status.

Graft the REST candidate's canonical-resource CLI configuration and `${resource}/v1` routing from lines 7-10 and 212, with the discovery correction above. This removes the API/resource metadata ambiguity without changing the store or adding deployment configuration.

Graft profile-specific DCR reuse and durable refresh-attempt recording from REST lines 218 and 226. Keep shared's stronger login epoch reservation at line 336. A pending login must not overwrite logout or a newer login. A crashed or uncertain refresh must carry enough timing state to avoid repeated use outside the provider's replay window.

Retain exact domain commands in operation files regardless of HTTP route shape. Removing `artifactId` from an outgoing body and restoring it from a validated path can preserve fingerprints, as shared proposes at lines 248-253. Keeping it and rejecting mismatches is also valid, as REST proposes at line 198. Pick one encoding and test the reconstructed store input, including omitted optional fields. Do not add a generic transport abstraction to accommodate both.

## Smallest complete solution and acceptance

The smallest complete implementation adds the pure contracts package, REST package with shared bearer policy, HTTP client package, and compiled CLI. It adds no fifth Worker, no service facade, no repository layer, no second artifact store, no alternate receipt cache, and no privileged forwarded actor. Existing compatibility exports remain because their preservation is explicit.

Before acceptance, run these gates through actual supported interfaces.

- Install packed packages outside the workspace. Run the bin with ordinary Node, import the client, type-check a consumer, and host REST independently of MCP. Assert the intended dependency graph and class identity.
- Exercise every artifact operation through authenticated direct HTTP and CLI subprocesses. Verify complete snapshots, attachments, history pagination, publication versions, and exact deterministic export bytes through MCP and the built panel.
- Race independent clients and database connections from the same head and publication version. Require one winner, one real 409, and no losing revision or receipt. Check changed arguments under one request ID separately.
- Drop a committed response through the real transport. Replay the immutable command, including across transports and after later edits. Require the original receipt and no additional revision. Revoke authority before replay and require denial.
- Complete real browser login and loopback callback. Exercise expiry, simultaneous refresh, process death, logout during refresh, and late login callbacks. Require one token rotation and no restored credentials after logout.
- Test canonical metadata equality and reject the original mismatched metadata. Preserve MCP challenge behavior. Verify a REST-only host can complete documented canonical discovery.
- Write package usage documentation and the repository `artifacts-cli` skill. Execute the skill's documented workflow against the installed bin. A skill file that only restates intended commands does not satisfy the requested tested skill.
- Run existing regressions, type checks, actual panel proof, and Worker builds in their safe sequential build order. No production deployment is included.

Laziness Protocol shaped the choice to keep MCP direct and reject an extra internal protocol layer. Boundary Discipline shaped the separate HTTP adapter and the correction to resource discovery. These are the principle leaves read for this judgment. The design-red-flags screen found no need for a pass-through service or shared mutable artifact cache. Package isolation and credential coordination still require the concrete checks above.

## Synthesized contract verdict

Reviewed `implementation-contract.md` after forming the candidate scores. Accept it for implementation. Its resource/discovery section resolves the RFC blocker. Its package boundaries and distribution section resolve the install graph and error-class risks. It keeps the shared-core base, an independently hosted REST handler, exact commands, and the required real-interface acceptance gates. Its private SQLite choice is an explicit, bounded tradeoff rather than a remaining architecture blocker.

Carry profile-specific DCR reuse and refresh-uncertainty handling into implementation. In particular, do not claim that a timestamp written inside an uncommitted SQLite transaction survives process death. Either persist enough attempt state durably or conservatively require login when the prior refresh outcome cannot be reconciled. Prove the chosen behavior with a killed CLI process. This is an implementation acceptance condition, not a request for another design round.
