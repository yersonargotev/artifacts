# Candidate A. Immutable snapshots with authenticated reads from a publication Worker

## Problem

The owner needs one artifact that Claude can create and Codex can change, with immutable history and a stable published URL. The existing application has identity but no artifact storage. `apps/mcp/src/http.ts` registers only `whoami`. `apps/dashboard/src/pages/index.astro` shows identity and connection instructions. `packages/db/src/schema.ts` adds panel sessions and OIDC transactions to Better Auth's schema. This candidate keeps Turso as the only content store. Publication changes a database pointer. A separate Cloudflare Worker reads that pointer through an authenticated backend endpoint and never receives database write credentials.

This candidate interprets an artifact as a document with attached files. HTML publication renders self-contained HTML. Files remain intact for reading and export. Arbitrary multi-file websites with runtime imports are a different requirement and would need a different renderer. This restriction must remain explicit in synthesis.

## Usage

The MCP client receives the artifact ID and revision ID after each successful command. The published URL depends only on the artifact ID.

```ts
const created = await artifacts.create(actor, {
	requestId: crypto.randomUUID(),
	snapshot: {
		metadata: { title: 'Quarterly forecast', description: 'Interactive forecast' },
		content: { kind: 'html', text: '<!doctype html><html>...</html>' },
		files: [{ path: 'forecast.csv', mediaType: 'text/csv', encoding: 'utf8', data: 'quarter,revenue\nQ1,42\n' }],
	},
});

const before = await artifacts.read(actor, { artifactId: created.artifactId, revision: 'head' });
const changed = await artifacts.update(actor, {
	artifactId: before.artifactId,
	expectedRevisionId: before.revisionId,
	requestId: crypto.randomUUID(),
	snapshot: { ...before.snapshot, metadata: { ...before.snapshot.metadata, title: 'Revised forecast' } },
});

const published = await artifacts.publish(actor, {
	artifactId: changed.artifactId,
	revisionId: changed.revisionId,
	expectedPublicationVersion: 0,
	requestId: crypto.randomUUID(),
});
```

The `artifacts_create`, `artifacts_read`, `artifacts_update`, `artifacts_publish`, and `artifacts_export` tools call these operations. `artifacts_list` and `artifacts_history` make discovery possible without recovering IDs from old conversations. A stale update returns `revision_conflict` and the current head revision ID. The client reads the latest revision and decides how to reconcile its changes. It never overwrites a concurrent change silently.

The owner opens `PUBLISH_URL/a/{artifactId}`. An anonymous browser goes through the existing panel and account login. After publication of another revision, the same URL renders the new revision. The panel lists artifacts, shows their revision history, links to the published URL, and downloads any selected revision.

## Shape

Per Model the Domain, each revision contains every historical value. Head and publication are independent pointers. Per Boundary Discipline and Type System Discipline, Zod parses transport inputs into branded IDs and validated snapshots once.

```ts
type ArtifactId = string & { readonly __artifactId: unique symbol };
type RevisionId = string & { readonly __revisionId: unique symbol };
type ArtifactSnapshot = Readonly<{
	metadata: Readonly<{ title: string; description: string }>;
	content: { readonly kind: 'html' | 'markdown' | 'text'; readonly text: string };
	files: readonly Readonly<{ path: string; mediaType: string; encoding: 'utf8' | 'base64'; data: string }>[];
}>;
type ArtifactActor = Readonly<{
	userId: string; sessionId: string; clientId: string;
	permissions: ReadonlySet<'read' | 'write' | 'publish'>;
}>;
type Revision = Readonly<{
	artifactId: ArtifactId; revisionId: RevisionId; parentRevisionId: RevisionId | null;
	sequence: number; snapshot: ArtifactSnapshot; sha256: string; createdAt: string; authorClientId: string;
}>;
type Publication =
	| { readonly kind: 'unpublished'; readonly version: 0 }
	| { readonly kind: 'published'; readonly version: number; readonly revisionId: RevisionId; readonly url: string };

interface ArtifactStore {
	create(actor: ArtifactActor, command: CreateArtifact): Promise<Revision>;
	read(actor: ArtifactActor, query: ReadArtifact): Promise<Revision>;
	update(actor: ArtifactActor, command: UpdateArtifact): Promise<Revision>;
	publish(actor: ArtifactActor, command: PublishArtifact): Promise<Publication>;
	list(actor: ArtifactActor, query: ArtifactPage): Promise<ArtifactListPage>;
	history(actor: ArtifactActor, query: RevisionPage): Promise<RevisionListPage>;
	export(actor: ArtifactActor, query: ExportArtifact): Promise<{ fileName: string; bytes: Uint8Array; sha256: string }>;
	readPublished(viewer: PublicationViewer, artifactId: ArtifactId): Promise<Revision>;
}
```

Propose a 1 MiB decoded revision limit and 32 attachments. These are product limits, not measured platform limits. Reject absolute paths, dot segments, backslashes, NUL, duplicate normalized names, invalid base64, and excess decoded bytes. ZIP members use only validated paths. Canonical snapshot serialization makes revision digests and request hashes stable.

`packages/db` owns five new tables. `artifact` stores owner and head. `artifact_revision` stores immutable snapshot JSON, parent, sequence, digest, timestamp, and author client. `artifact_publication` stores the revision pointer and publication version. `artifact_command` stores an idempotency request ID, payload hash, and result. `publication_grant` stores a hashed one-use handoff code, transaction binding, artifact, owner, central session, and expiry. Compound foreign keys prevent heads, parents, and publications from referencing another artifact. A central-session foreign key cascades grant revocation.

Creation commits artifact, revision, head, and command receipt together. Update opens a write transaction, checks the receipt, reads the owner-scoped head, compares the expected revision, inserts the snapshot, and conditionally updates the head with `WHERE head_revision_id = expectedRevisionId`. It requires exactly one changed row. A failed comparison rolls back the revision and receipt. A matching retry returns the original result. Reusing a request ID with a different payload fails. Transient busy errors may retry the entire transaction, never substitute a newer expected revision. Two concurrent writers must produce one committed revision and one `revision_conflict`, with no orphan row.

Publication checks ownership, publish permission, revision membership, and expected publication version in one transaction. Publishing an older revision intentionally rolls back the published view. Publishing the already-selected revision is a no-op. Draft edits never publish implicitly. No application operation updates or deletes a revision. The existing remote transaction proof in `scripts/verify-turso.ts` is useful groundwork, but this new compare-and-swap race requires its own two-client Turso proof.

`packages/artifacts/src/index.ts` owns the deep store interface and all artifact writes. Package exports hide its persistence internals. `packages/db/src/schema.ts` and migrations own tables. MCP and the panel do not write them directly. `apps/mcp/src/server.ts` opens the database and injects the store, so README's current claim that MCP has no database credentials must change. `apps/mcp/src/http.ts` maps its verified principal to an actor and registers the tools. `apps/dashboard/src/runtime.ts` injects the same store into list, history, export, and handoff routes. `apps/publication/src/index.ts` owns a Workers fetch handler. Its `view.ts` owns wrapper escaping, sandbox policy, and download headers.

MCP retains signature verification plus live introspection. Each tool also requires its specific scope. Read, list, history, and export require `artifacts:read`. Create and update require write. Publish requires publish. The dashboard derives owner permissions from its existing verified session, not its `openid profile` scopes. Submitted owner IDs never influence authorization. All reads filter by owner before disclosing existence. Claude and Codex share access through the immutable user ID, while revision audit fields preserve their different OAuth client IDs.

The ZIP contains a revision manifest, the original content document, and attachments under `files/`. A maintained ZIP library must be selected after checking its Node and Worker support. No inspected manifest has one. The panel downloads bytes. MCP returns a bounded base64 ZIP with filename, MIME type, and checksum, without relying on browser cookies or anonymous download URLs.

## Publication login and HTML isolation

A separate hostname protects panel and auth cookies. It does not stop artifact scripts from fetching other resources protected by a publication cookie. The Worker therefore serves a fixed wrapper with escaped `srcdoc` inside `iframe sandbox="allow-scripts"`. Never grant same-origin, forms, popups, or top navigation. Enforced CSP must block external scripts, connections, external images, nested frames, objects, and base changes while allowing intended inline scripts, styles, and data images. Prove its inheritance into the chosen `srcdoc` construction in a real browser. The wrapper exposes no message handler that fetches content on the artifact's behalf. The panel escapes all metadata.

The HTML Standard defines an opaque origin for this sandbox and warns against combining same-origin and script permissions. [HTML Standard](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox). Enforced CSP is a second boundary. [CSP specification](https://www.w3.org/TR/CSP3/).

1. Anonymous `/a/{id}` creates a signed, HttpOnly, Secure, host-only transaction cookie and redirects to a fixed panel handoff route.
2. The panel requires its existing login, checks artifact ownership and publication, then creates a short-lived one-use code bound to artifact and transaction. Preserve a validated local return path through OIDC rather than the current unconditional callback redirect to `/`.
3. The Worker callback checks state and cookie, then exchanges the code through an authenticated HTTPS backend call. The backend atomically consumes the grant and checks the live central session again.
4. The Worker issues an encrypted cookie scoped to the artifact and central session. A per-artifact cookie name prevents one open artifact from replacing another's grant. No grant or account token enters the artifact document.
5. Every page and attachment request calls the backend with verified viewer claims. The backend checks central-session existence and expiry, artifact scope, owner, and current publication pointer. Revocation denies the next request. Backend failure returns 503.

The Worker holds only a cookie key and backend service credential. It has no database token, Better Auth secret, or authoring credential. Exact internal backend routes require service authentication. They must bypass the browser middleware's Origin condition only after that separate admission succeeds. Return destinations are fixed configuration. Codes are hashed, consumed once, never logged, and removed from the callback URL by redirect. Use no-store responses and no positive authorization cache. Attachments use download disposition and nosniff so HTML and SVG cannot create an unsandboxed execution path.

## Deployment and identity migration

`apps/auth/src/auth.ts` imports `@better-auth/cimd/node`. The installed transport imports `node:dns/promises.lookup` and uses `https.request` with a pinned DNS lookup. Cloudflare's current documentation lists `dns.lookup` as unimplemented. Merely setting Node compatibility cannot establish equivalence for this dependency. Do not replace the pinned transport with ordinary fetch just to make deployment pass. [Cloudflare DNS documentation](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/).

The conservative deployment alternative preserves Node 24 for authorization, MCP, and the Astro Node build. The parent is independently probing a Worker-safe transport restricted to exact trusted CIMD metadata and JWKS hosts. Its real result should decide whether native Workers can replace this alternative. A Cloudflare Container can host those processes behind a small host-routing Worker, with a separate Workers-native publication deployment. Cloudflare documents Docker as the image build prerequisite and requires its Workers Paid plan for Containers. Verify account entitlement, Docker, and current deploy tooling before selecting this route. These prerequisites are not established by the existing authenticated `cf` login. [Containers setup](https://developers.cloudflare.com/containers/get-started/), [Containers overview](https://developers.cloudflare.com/containers/).

Use explicit configured hosts for auth, MCP, panel, and publication. Forward the original Host expected by current handlers. Keep secrets in deployment secret storage. Use stable `workers.dev` hosts if a custom zone is unavailable. A repository remote is unnecessary for direct deployment. A named Cloudflare Tunnel to Node services can prove the HTTPS flows, but a laptop-backed process is an availability limitation and must not be described as a durable hosted deployment. Native Workers for all services is an alternative only after actual CIMD, OIDC, and SSR runtime proofs pass.

Move the existing identity only after artifact tests pass locally. Do not rerun bootstrap against empty Turso and call a newly created owner the same identity.

1. Stop local writers and snapshot the local database using the database's backup mechanism. Retain the existing `.env` privately for rollback.
2. Apply the committed schema to the chosen Turso database. Check whether it contains the synthetic remote-proof records or any real identity before copying.
3. Copy user and account records with their exact primary keys and password hashes. Copy OAuth clients, resources, links, consents, and signing-key records deliberately. Preserve encryption secrets required to interpret stored values. Validate row counts, relationships, foreign keys, and owner ID before cutover.
4. Treat the switch from local to HTTPS issuer and resource URLs as a credential boundary. Preserve account identity, but require fresh browser and CLI login. Do not represent old localhost tokens as valid against the deployed issuer. Register new confidential clients for the deployed callbacks and resource links, with separate deployment secrets.
5. Start the deployed applications against Turso, verify the original owner ID through panel and both real clients, and keep the old local database read-only until the proof completes. After remote writes begin, rollback needs a reverse data transfer rather than switching the old database back into service.

An implementation should produce a manifest of copied table counts and identity IDs without logging passwords, hashes, keys, tokens, or complete database rows. The migration is repeatable only when it checks matching existing records and stops on conflicts. It must not overwrite a different remote identity silently.

The final proof uses actual Claude and Codex sessions against the deployed MCP URL. Claude creates an artifact and publishes revision 1. A signed-in browser opens its stable URL and records the rendered marker. Codex reads that artifact, changes it using revision 1 as the expected version, and publishes revision 2. The same browser URL renders the changed marker. The panel lists both revisions. Export of revision 1 still contains its original bytes. A fresh browser is redirected to account login. A foreign account and a stale revision cannot modify or read it. Global revocation denies the published URL on its next request.

## Synthesis decision

Pending comparison with the other candidate. Candidate A's base is one transactional Turso store and a publication Worker that pulls only authorized published snapshots. Its main cost is the authenticated backend dependency on every publication request. Its main scope restriction is self-contained document rendering.

## Tradeoffs accepted

- We accept duplicated revision bytes in exchange for one database transaction and exact historical exports.
- We accept publication reads depending on the backend and Turso in exchange for immediate revocation and no public copies to invalidate.
- We accept self-contained HTML and attachment exports in exchange for opaque-origin isolation without an asset URL rewriting runtime.
- We accept a browser handoff protocol in exchange for reusing the existing account and keeping all database credentials out of the publication Worker.
- We accept Node hosting prerequisites in exchange for preserving the pinned CIMD transport and current Astro adapter behavior.

## Alternatives considered

Direct Turso access from the Worker removes the backend HTTP call but gives the publication deployment broad database visibility unless credentials are constrained independently. A query helper alone does not constrain a leaked token. It also duplicates session and owner enforcement across runtimes.

Pushing bundles to R2 on publication removes database content reads from each page load. It introduces a two-system commit, orphan cleanup, publication reconciliation, and another authorization layer. It becomes attractive for large assets or multi-file sites. It is more responsibility than a 1 MiB document requires.

Serving artifact HTML directly from the Worker's login origin removes the wrapper but gives that script access to cookie-authorized same-origin responses. HttpOnly does not prevent authenticated fetch. This alternative is rejected.

A unique hostname per artifact can isolate documents and support ordinary relative assets. It requires wildcard domain control, per-artifact admission, and a deliberate cookie design. That is a better direction if multi-file websites are a known requirement, but it is not assumed here.

## Open questions and risks

- Does publication need arbitrary multi-file web applications, or does self-contained HTML with downloadable files satisfy the user's intended artifacts?
- Does the Cloudflare account support Containers, and can this machine build and push the image with the installed tooling?
- Can the existing Claude and Codex model-provider sessions run real conversations against the deployed OAuth server without further account interaction?
- Does the chosen browser enforce the exact wrapper CSP and sandbox policy for inline scripts, data images, attachment links, and attempted credentialed fetches?

These questions identify required evidence. The first is a product scope assumption. The others can be answered by read-only discovery or a narrowly scoped runtime proof.

## Red flag screen

The store completes each domain command without caller-managed stages. All artifact writes have one owner. Package exports hide persistence internals. MCP and the panel use the same operation path. Input schemas generate tool types. There is no second content store, synchronization worker, generic provider abstraction, or backend-select flag. The publication handoff adds a boundary because it transfers authority across cookie hosts, not because authentication happens earlier in the sequence.

## Next implementation step

Implement snapshot parsing and the transactional store, then prove competing updates, owner isolation, immutable historical export, and publication-pointer independence against two remote libSQL clients.
