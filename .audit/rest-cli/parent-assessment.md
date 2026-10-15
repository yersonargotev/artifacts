# Parent design assessment

Both candidates were read end to end. The preferred base is shared-core adapters.

| Criterion | Shared core | MCP consumes REST |
| --- | --- | --- |
| Preserve invariants | 5 | 5 |
| Complete independent clients | 5 | 5 |
| Concentrated boundaries | 4 | 3 |
| Existing compatibility | 5 | 3 |
| Implementation and operations | 4 | 3 |

Both retain the same transactional owner and can satisfy functional requirements. The canonical REST candidate changes every MCP operation into HTTP serialization and requires another fresh admission. Its in-process Fetch option removes a network deployment but does not remove those costs. The requested independent REST does not require MCP to consume it. Shared-core adapters therefore preserve more current behavior with fewer mechanisms.

Required synthesis corrections and grafts:

- Keep three reusable packages for contracts, REST and HTTP client, plus the CLI app. The client install graph must exclude DB dependencies.
- Use resource-relative REST paths from the REST-canonical candidate, `${resource}/v1`, with the existing canonical OAuth metadata at the path derived from that resource. Do not advertise `/mcp` as the resource from a well-known document derived from `/api/v1`. The draft shared-core metadata does not satisfy RFC 9728 resource matching.
- Provide a REST-only server entry point that uses the same configured resource host and store without constructing MCP. Default production composition remains the existing Worker, with both protocols and no fifth service.
- Preserve existing MCP behavior and direct store calls. Extract the identical bearer policy only. Keep the panel's different credential policy unchanged.
- Retain complete mutation operation files, verified owner and resource binding, exact request IDs and optional fields. No automatic conflict rebase.
- Accept private Node SQLite credential storage as a reversible implementation choice for process-safe refresh, atomic persistence and crash lock release. Node 24 is already required. Document its experimental status, keep it out of HTTP packages, and prove real subprocess behavior.
- Use compiled staging packages rather than changing workspace exports. Prove normal Node usage and installed CLI commands from an external temporary consumer.

Final selection waits for the independent cross-judge. No implementation has begun.
