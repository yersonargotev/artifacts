# Artifact design judgment

Choose [Candidate A](design-a.md) as the base. It gives the owner complete retained revisions and protected stable publication through one transactional content store. Maintainers inherit one artifact API and one authorization path. [Candidate B](design-b.md) adds object storage coordination without a measured size requirement. Its useful details can strengthen A without adding R2.

This is an independent design review against [the acceptance predicate and rubric](frame.md). Scores assess the written designs for the first increment. They do not certify implementation or runtime behavior. Native Workers compatibility remains the parent's separate evidence gate. Neither candidate's Node fallback decides the storage choice.

The throughput checkpoint is n/a for this read-only investigation. Only this judgment file changes. No application code, cloud resources, or Memory changes are part of this review.

Scores use a five-point scale. Five means the written contract fully addresses the criterion. Four means a specific detail or proof remains. Three means the proposed implementation carries avoidable responsibility for the known scope.

| Rubric criterion | A | B | Judgment |
| --- | --- | --- | --- |
| Complete immutable revisions and stale-writer protection | 5 | 5 | Both preserve complete snapshots and compare the expected head inside a transaction. A also commits the content bytes in that transaction. B requires prior object writes and retained orphans. |
| Canonical ownership and operation scopes | 5 | 5 | Both derive the owner from verified identity and enforce per-operation scopes. A keeps publication authorization behind the same backend policy. |
| Anonymous and revoked publication denial | 4 | 4 | Both require live central-session checks on every content request. Each needs browser evidence for documents, downloads, callbacks, and revocation. Attachment revision binding needs an explicit contract. |
| Executable artifact isolation | 4 | 4 | Both specify an opaque sandbox, restrictive CSP, and attachment disposition. The exact wrapper and browser behavior remain unproved. |
| First increment on authorized infrastructure with repeatable proofs | 4 | 3 | A needs Turso and a publication Worker. B additionally needs private R2 provisioning, credentials, object failures, and orphan handling. Runtime hosting proofs remain open for both. |
| One invariant owner, small API, and provider-neutral export | 5 | 3 | A hides one transactional store behind domain commands. B hides two stores but still makes maintainers own their coordination. Both can produce portable exports. |
| Total | 27 | 24 | Select A. |

Adopt the following implementation contract.

1. `packages/artifacts` owns `create`, `read`, `update`, `publish`, `list`, `history`, and `export`. Its restricted publication read operation enforces the viewer policy. MCP and panel adapters parse inputs, construct verified actors, and call this API. They never write artifact tables directly.
2. A revision is one immutable snapshot containing metadata, the content kind and text, every file path and byte sequence, its parent, sequence, digest, timestamp, and client attribution. Retain all metadata accepted by the input schema. Reject unsupported fields rather than silently dropping them. A's explicit title and description suffice unless the accepted artifact input promises additional metadata.
3. Store the complete canonical snapshot in Turso. Use A's initial limits of 1 MiB decoded revision content and 32 attachments as explicit product bounds. Count metadata and content encoding overhead when planning transport limits. Reject malformed encodings, unsafe paths, duplicate normalized paths, and oversized requests at ingress. These bounds are not claims about Turso or Workers capacity.
4. `artifact` owns canonical owner identity and the head pointer. Immutable `artifact_revision` rows own historical content. `artifact_publication` owns the selected revision and publication version. Composite foreign keys establish artifact membership. `artifact_command` owns retry receipts. `publication_grant` owns one-use browser handoffs. No R2 bucket or persistent publication-session table is required by this contract.
5. Every mutation includes a request ID. Use B's explicit receipt key of `(owner_id, request_id)`. Hash the operation kind and every normalized semantic argument, including expected versions. Check current authority before returning a stored receipt. Matching retries return their committed result. Changed payloads under an existing key fail. Successful creation, update, or publication commits its receipt in the same transaction as its state change.
6. Update requires `expectedRevisionId`. The transaction verifies ownership, allocates the sequence, inserts the complete revision, and advances the head conditionally. A lost comparison rolls back all new rows. A stale writer receives the current head ID and cannot overwrite it. Busy retries preserve the caller's expected revision.
7. Publication requires a revision ID and `expectedPublicationVersion`. Version zero means unpublished. Verify the expected version before considering a same-revision no-op. A fresh request with a stale version conflicts even if its requested revision is currently selected. A matching receipt remains replayable. A successful pointer change increments the version. Publishing never changes the head or the URL.
8. The publication Worker holds its cookie key and a service credential for narrowly scoped backend routes. It receives no database credential. The existing panel owns account login. One-use grants bind the artifact, browser transaction, canonical owner, central session, allowed callback, and expiry. The backend consumes each grant atomically. Viewer cookies are host-only, Secure, HttpOnly, and artifact-scoped. Every document and file read rechecks the central session and owner through the backend. Responses use `private, no-store`. Backend failure returns 503.
9. The trusted publication shell renders self-contained HTML through an escaped `srcdoc` iframe with `sandbox="allow-scripts"`. It exposes no credentialed message bridge. The enforced CSP blocks external connections and unintended executable resources. Text and Markdown remain inert. Attachment download controls belong to the trusted shell. Downloads use attachment disposition and `nosniff`.
10. Bind attachment requests to the revision rendered in the shell. Do not resolve an unversioned file path against whichever publication pointer happens to be current later. A publication download route checks that its requested revision still matches the selected publication. If publication changes, it requires a refresh instead of returning bytes from another revision. The panel's separately authenticated historical route can download any revision owned by the user.
11. Adopt B's deterministic export format and historical preview behavior. Export one explicit revision as a ZIP containing `artifact.json`, the content document, and `files/`. Sort members and normalize ZIP metadata so repeated exports have the same digest. Include artifact metadata and file digests, but no credentials. Keep A's bounded inline MCP export for this increment. Prove actual Claude and Codex delivery with a representative ZIP. The panel downloads the same archive bytes. An authenticated URL alone does not prove a CLI can obtain the export.

The following points must be resolved before acceptance.

- Implement and test publication version precedence, receipt replay, and concurrent publishers. A's same-revision no-op sentence otherwise leaves a stale-request ambiguity.
- Define revision-bound attachment URLs and the republish behavior above. A document and its downloads must not silently mix revisions.
- Preserve every accepted historical metadata field and binary file byte. Test the exported archive contents rather than only its digest or filename.
- Verify the exact sandbox and CSP in a real browser. Attempt parent access, authenticated fetches, external requests, frame escape, and executable attachment navigation. A separate hostname alone does not establish this result.
- Prove anonymous denial and central-session revocation for both HTML and direct file routes. Verify grant replay rejection and callback cleanup.
- Keep runtime deployment, identity migration, and real Claude-to-Codex use as acceptance gates. An implementation check or `whoami` does not replace them. Store work can proceed while the separate Workers probe runs.

The following constraints are acceptable for the first increment.

- Published artifacts are self-contained documents with intact downloadable attachments. Arbitrary relative JavaScript imports and multi-file websites are outside the supplied scope. State this limit in the tool and product contract.
- Full snapshots duplicate bytes across revisions. No measured size requirement justifies a second content store.
- Every publication request depends on backend authorization and Turso. This buys a single enforcement path and revocation on the next request.
- The initial size and attachment limits are reversible product choices. Larger requirements can be assessed when observed. They do not justify speculative provider interfaces now.
- The user authenticates again after an issuer change. Preserve the canonical owner identity and password account through the migration. Do not silently replace the owner or present localhost grants as deployed credentials.

The useful grafts from B are its explicit owner/request receipt key, deterministic archive manifest, and revision-bound historical preview. Do not graft its R2 coordination, direct publication database credentials, additional viewer-session table, or larger unmeasured limits. Its authenticated download URL is an option only after client retrieval is proved.

The [Laziness Protocol](../../.agents/skills/principle-laziness-protocol/SKILL.md) shaped the choice of one content store. [Model the Domain](../../.agents/skills/principle-model-the-domain/SKILL.md) shaped the independent head and publication pointers and complete revision snapshot. [Boundary Discipline](../../.agents/skills/principle-boundary-discipline/SKILL.md) shaped validated ingress and thin MCP and panel adapters. [Prove It Works](../../.agents/skills/principle-prove-it-works/SKILL.md) keeps browser and actual-client checks as required evidence rather than design claims.
