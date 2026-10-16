# Workflow boundaries and selected designs

## Runtime flow

The agent invokes the installed CLI. `apps/cli/src/index.ts` validates per-command arguments, binds one credential, and invokes the typed HTTP client. Mutation preparation retains a complete operation before submission. `operations.ts` binds its request ID to owner and canonical resource. The REST handler delegates to the artifact store, which persists immutable snapshots and receipts. A lost successful response must replay that retained operation rather than prepare another edit.

The Astro panel authenticates its own browser session and reads the explicitly selected revision. Its preview route requires iframe admission and returns a document with separate CSP, opaque sandbox, connection allowlist, cache, and DNS policies. The panel's four existing `data-*` markers identify artifact, revision, digest, and publication version. The protected publication route has a separate admission handoff and revision-bound frame. CLI identity and browser identity remain separate.

## Bounded read output

Two independent read-only design agents converged on a local boolean. An independent read-only judge accepted it against compatibility, exact file bytes, exclusive creation, error handling, retry isolation, and API size.

| Shape | Decision |
| --- | --- |
| `read --out FILE --quiet` | Selected. Validate nonempty output before credentials or HTTP. Await existing writer. Return undefined only on success. |
| `read --out FILE --stdout none` | Rejected. An enum adds no needed capability. |
| `read --out FILE --stdout summary` | Rejected. A new receipt creates an unnecessary public JSON shape. |

The selected shape changes only the successful stdout decision. Existing serialization and writeOutput remain authoritative. Mutations and retry cannot accept the flag. Empty `--out` and output failures must remain failures.

## Diagnostics decision

No new endpoint, telemetry, or panel diagnostic UI is justified. Existing exact-state markers identify the selected revision. Frame attributes show the pinned source and containment. Native DevTools supplies real pending/complete status and policy response headers when the connector itself cannot. Native browser version and the existing compatibility predicate identify capability. This combination located and recovered the observed environmental boundary without adding a new sensitive surface.

The verification guidance will expose this available path and require explicit unavailable evidence. An iframe load event alone could also fire on an error document. A new cross-origin postMessage handshake would expand the trusted document protocol and still not prove full response bytes. Neither improves the demonstrated diagnosis enough to earn application code.

## Lifecycle evaluator

A dedicated local evaluator will run the same installed-command lifecycle twice, once for a pinned public registry baseline and once for independently packaged candidate tarballs. Separate private consumers, identities, databases, state, and provenance prevent a version string shared by both builds from implying identical published bytes. Real OAuth browser consent, handlers, and storage remain under test. Fault injection drops the response only after the real handler commits.

The evaluator reports setup, product, skill-execution, and untested paths separately. It is a scripted command-path evaluation, not a causal comparison of autonomous agents or a skill quality score. Production is excluded structurally by the disposable local fixture.
