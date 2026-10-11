# Identity design judgment

Use the app-local candidate as the implementation base.
This is a design assessment of the supplied artifacts, not a runtime security certification.
The local candidate fits the first increment with fewer public contracts and stronger explicit race coverage.
Its database dependency is acceptable under the settled shared-libSQL architecture.

## Review scope

Read `brief.md`, `shared/DESIGN.md`, `shared/sketch.ts`, `local/sketch.md`, and `local/rationale.md`.
Read the requested poteto-mode skill and its relevant review and writing instructions.
No repository edits, dependency installation, browser tests, CLI tests, or vendor-source research occurred.
Throughput checkpoint is not applicable to this read-only investigation.
The direct review is complete. Additional delegation was excluded by the assignment.

## Scores

Scores evaluate the proposed design and verification plan, from 1 for weak to 5 for strong.
A score does not mean a test has passed.

| Criterion | Shared | Local | Evidence and tradeoff |
| --- | ---: | ---: | --- |
| Live sid on every request and revocation after refresh | 4 | 4 | Both require fresh authenticated MCP introspection. Shared binds JWT and live identity. Local also specifies central expiry, panel joins, callback races, and cascading deletion. Both leave the actual provider contract unproved. |
| Canonical identity and independent deployment portability | 4 | 4 | Both use canonical user IDs and configured issuer/resource URLs. Shared uses HTTP admission for the panel but still shares panel persistence with auth revocation. Local requires dashboard access to central tables, explicitly accepted under the shared database. |
| Small interfaces and shallow trace | 3 | 5 | Shared exports a factory, policy, verifier port, normalized evidence, and admission types for two different evidence flows. Local exposes one complete admission operation per app. Its database package contains no authorization policy. |
| Deterministic endpoint, browser, and CLI proof | 4 | 4 | Both propose actual applications, negative tokens, outages, replay, and isolated CLIs. Local adds callback/deletion races and previously authenticated transport sessions. Neither specifies executable commands, barriers, or fixtures yet. |
| Reproducibility, library contracts, and local/production distinction | 3 | 4 | Local names startup commands, bootstrap repetition, source-derived schema, local cookie hosts, secure CIMD transport, HTTPS, and connection-level FK verification. Shared relies more heavily on the brief for these details. |
| Total | 18 | 21 | Local wins primarily on interface size and explicit operational detail. |

## Base and two grafts

Keep `authorizeMcp`, `loadPanelIdentity`, and `revokeUserIdentity` app-local.
Keep durable OIDC transactions and opaque browser session cookies from the local candidate.
Keep the panel-to-central-session foreign key plus live expiry checks if real libSQL proves the contract.
Keep provider OAuth handling inside Better Auth, with only the supported extension needed for live sid enforcement.

1. Borrow the shared candidate's private principal brand inside each app's identity module.
   The local sketch says only the boundary constructs a principal, but its structural type does not encode that restriction.
   A private unique-symbol brand makes accidental unchecked construction visible to TypeScript without a shared policy package.
2. Borrow the shared candidate's explicit scope registry as static protocol data.
   Derive provider scope registration and MCP tool requirements from one small value.
   Keep it free of effects, database types, factories, and token policy.
   Add a tiny shared module only if actual imports justify it. Do not create a service framework to host the registry.

## Correctness gates before completion

The following gates remain open in both sketches. They block a completion claim, not the choice of base.

- Inspect the pinned provider's actual JWT, ID-token sid, and RFC 7662 contracts before wiring adapters.
  Never manufacture introspection fields to satisfy a proposed `LiveSession` type.
  Prove that `active: true` requires an existing, unexpired central session for the same canonical subject.
  Prove that the configured confidential resource client can authenticate this introspection request.
- Obtain a token, delete all central sessions, refresh the token if the provider permits it, and call actual protected endpoints.
  Both the original and newly minted tokens must remain denied for the deleted sid.
  Include concurrent refresh-family invalidation. A transaction flag is not evidence that the provider race is repaired.
- Verify foreign-key enforcement on each connection and actual migration output for local file libSQL.
  Coordinate callback insertion and central deletion with explicit barriers, then assert no admitted surviving panel session.
  Document remote Turso verification separately. Local SQLite results alone do not prove the deployed database contract.
- Verify OIDC callback issuer, subject, client audience, sid, state, nonce, and PKCE against real provider output.
  Claim transaction state once atomically and check central-session ownership before inserting a panel row.
  Reject mismatches between signed identity and the central session, even when both exist individually.
- Wrap every protected MCP HTTP request, including requests using an existing transport session.
  Assert literal 401, 403, and 503 behavior through actual endpoints and the resource metadata challenge.
  For the local panel design, an auth HTTP outage can remain available through a live database check.
  A database outage must fail closed. Keep those two outage expectations distinct.

## Implementation handoff

Start with the local candidate's PKCE, introspection, `whoami`, and central deletion vertical proof.
Then add OIDC browser login, durable panel sessions, panel logout, and global revocation.
Use a runnable verification script with disposable data, bounded process waits, explicit race barriers, and preserved personal CLI configuration.
Minimize Reader Load changed the base choice toward app-local admission functions.
Prove It Works keeps source inspection and real endpoint, browser, and CLI evidence as completion gates.
