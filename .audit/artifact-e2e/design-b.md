# Candidate B. Immutable R2 content with a Turso catalog

## Problem

An owner must create an artifact through Claude, read and change it through Codex, and publish successive immutable revisions at one authenticated URL. The panel must list artifacts, show history, and open any revision. The current system has identity only. `apps/mcp/src/http.ts` registers `whoami`; `apps/mcp/src/identity.ts` verifies both JWT and live introspection. `apps/dashboard/src/identity.ts` owns durable OIDC login and joins panel sessions to central sessions. `packages/db/src/schema.ts` contains identity tables only. `scripts/verify-turso.ts` already exercises committed reads through both Node and web libSQL clients. These boundaries remain intact.

## Usage

```ts
const created = await artifacts.create(actor, {
  requestId, title: 'Quarterly report', kind: 'html',
  content: '<!doctype html><html>...</html>', files: [], metadata: {},
});
const current = await artifacts.read(actor, created.artifactId);
const updated = await artifacts.update(actor, {
  requestId: nextRequestId, artifactId: current.artifactId,
  expectedRevisionId: current.revisionId,
  snapshot: { ...current.snapshot, content: revisedHtml },
});
const published = await artifacts.publish(actor, {
  requestId: publishRequestId, artifactId: updated.artifactId,
  revisionId: updated.revisionId, expectedPublicationVersion: null,
});
// published.url remains the same after subsequent publish operations.
const exported = await artifacts.export(actor, updated.artifactId, updated.revisionId);
```

MCP tools are `create_artifact`, `read_artifact`, `update_artifact`, `publish_artifact`, and `export_artifact`. Reads and export require `artifacts:read`; create/update require `artifacts:write`; publication requires `artifacts:publish`. The current whole-request `artifacts:read` admission remains, with each tool enforcing its additional scope. Owner identity always comes from the verified principal, never an input field. Export returns an authenticated download URL and digest rather than an oversized ZIP in an MCP text response.

## Shape

```ts
type ArtifactId = string & { readonly artifactId: unique symbol };
type RevisionId = string & { readonly revisionId: unique symbol };
type RequestId = string & { readonly requestId: unique symbol };
type FilePath = string & { readonly filePath: unique symbol };
type Actor = Readonly<{ userId: string; sessionId: string; clientId: string;
  scopes: readonly string[] }>;
type Snapshot = Readonly<{ title: string; kind: 'html' | 'markdown' | 'text';
  content: string; files: readonly Readonly<{ path: FilePath; mediaType: string;
  bytes: Uint8Array }>[]; metadata: Readonly<Record<string, unknown>> }>;
type Revision = Readonly<{ artifactId: ArtifactId; revisionId: RevisionId;
  number: number; parentRevisionId: RevisionId | null; snapshot: Snapshot }>;
type MutationResult =
  | { kind: 'committed'; artifactId: ArtifactId; revisionId: RevisionId }
  | { kind: 'conflict'; currentRevisionId: RevisionId };

interface Artifacts {
  create(actor: Actor, input: CreateArtifact): Promise<MutationResult>;
  read(actor: Actor, id: ArtifactId, revision?: RevisionId): Promise<Revision>;
  update(actor: Actor, input: UpdateArtifact): Promise<MutationResult>;
  publish(actor: Actor, input: PublishArtifact): Promise<PublicationResult>;
  export(actor: Actor, id: ArtifactId, revision: RevisionId): Promise<ExportResult>;
  list(actor: Actor, cursor?: string): Promise<ArtifactPage>;
  history(actor: Actor, id: ArtifactId, cursor?: string): Promise<RevisionPage>;
}
```

`packages/artifacts` owns these operations and all artifact SQL/R2 coordination. Its package exports expose only this domain API. `packages/db` continues to own migration definitions. MCP and Astro parse network input with Zod, construct the appropriate actor, and call the same service. They never write artifact tables directly. Publication has a separate Worker adapter and a restricted read API from this package. This boundary hides ownership, snapshot serialization, immutable blobs, conflict handling, and export construction behind seven operations. It follows the model-the-domain and boundary-discipline skills read for this candidate.

The tables are deliberately small.

| Table | Shape and indexes |
| --- | --- |
| `artifact` | `id`, `owner_id`, `head_revision_id`, `created_at`; owner/list index. |
| `artifact_revision` | `id`, `artifact_id`, `number`, `parent_revision_id`, immutable title/kind/metadata, content digest, immutable file manifest, creator session/client attribution, `created_at`; unique `(artifact_id, number)` and `(artifact_id, id)`. |
| `artifact_publication` | One row per artifact, revision pointer, publication version, stable opaque path, timestamp; unique stable path; composite foreign key proves revision belongs to artifact. |
| `artifact_operation` | `(owner_id, request_id)` primary key, operation kind, normalized request digest, committed result. |
| `publication_login` | Hashed one-use state and grant, artifact ID, central session ID, callback origin, expiry. |
| `publication_session` | Hashed opaque token, artifact ID, central session ID, expiry; central-session deletion cascades. |

Files and content bytes live in a private R2 bucket at content-addressed keys scoped to the owner. No public bucket URL exists. Metadata and file manifests belong only to a revision. List reads join the head revision to get its title. History reads immutable revision rows. A revision resolves every file directly from its manifest, without reconstructing a patch chain.

The R2 writer uploads and verifies immutable bytes before the database transaction. It never overwrites a key with different bytes. Inside a write transaction, the service verifies the owner and live central session, checks an existing idempotency receipt, inserts the revision, updates the artifact head only where the previous head equals `expectedRevisionId`, and inserts the receipt. Zero changed rows roll back the entire revision. Two writers therefore produce one successful advance and one explicit conflict. The losing caller rereads before deciding its next full snapshot. Number allocation occurs under the same transaction. A replay with the same request ID and digest returns the committed result; a changed digest is rejected. These decisions follow make-operations-idempotent.

Uploading before SQL can leave an unreferenced R2 object after a crash. It cannot produce a committed revision with a missing byte object. Retain these harmless objects for this increment. A later separately authorized garbage collector would need a grace period and reference checks. Readers never depend on a garbage collection job.

Publication changes only its pinned revision pointer and increments its version through compare-and-swap. `expectedPublicationVersion: null` means first publication. Further publication supplies the returned version. Editing does not silently expose a draft. Republishing never creates a different URL. Revision IDs and manifests stay immutable after publication. Export builds a deterministic ZIP containing `artifact.json`, the content file, and `files/` from one exact revision. The manifest includes digests and attribution. No credentials or session tokens enter the archive.

## Publication login and executable HTML

The publication Worker is a distinct application and hostname. It binds the private bucket read-only and connects to Turso through `@libsql/client/web`. It has no owner password, Better Auth secret, or R2 write/deployment credentials. Each document/download request requires an artifact-scoped viewer session whose central session still exists and whose owner matches the artifact owner. It reads authorization from the primary database, without positive caching. Database outages return 503 and missing sessions lead to login. Authenticated responses are `private, no-store` and are never served through a public edge cache.

An unauthenticated request creates a short-lived, one-use login state and host-only Secure HttpOnly transaction cookie, then redirects to the existing panel. The panel authenticates through its existing OIDC flow and validates the pending state, target artifact, callback allowlist, and owner. It creates a hashed one-use grant bound to that state and its live central session. The Worker callback consumes grant and state atomically, checks the transaction cookie and live central session, then sets an artifact-scoped viewer cookie. The callback redirects immediately to the clean stable URL. It uses `no-store` and `no-referrer`; callback query parameters are excluded from request logs. This grant is a bounded login handoff, not a reusable unauthenticated share link. Global central-session revocation invalidates viewer access on the next request.

Executable bytes must never run as the panel, auth app, or trusted publication shell. The Worker serves a trusted shell with an iframe using `sandbox="allow-scripts"`, without `allow-same-origin`, forms, popup, or top-navigation permissions. HTML renders as a self-contained `srcdoc` value serialized with safe attribute escaping. The opaque iframe origin cannot read the viewer cookie, parent DOM, local storage, or authenticated APIs. Its CSP permits inline artifact scripts/styles and data/blob images, with `connect-src 'none'`, `form-action 'none'`, and no external frames or workers. Markdown/text render inertly. Attachments are authenticated downloads with `Content-Disposition: attachment`, `nosniff`, and an octet-stream fallback.

This candidate explicitly requires self-contained published HTML. Original attachment files remain revisioned, readable through MCP, and exported, but are not executable same-origin asset routes. Arbitrary multi-file web applications would need a separately isolated per-artifact origin and a stronger deployment contract. A sandbox plus authenticated relative asset routes is insufficient by itself. Opaque origins complicate fetch/CORS and SameSite cookies, and adding `allow-same-origin` to make those work defeats isolation. The self-contained constraint must be accepted or this candidate must be rejected before implementation.

## Deployment and identity migration

Keep Better Auth, its Node CIMD transport, and the Astro Node adapter in a Node runtime. Do not infer Worker compatibility from the web libSQL proof. Deploy the existing three Node applications behind HTTPS ingress, with a separate Cloudflare publication Worker. A Cloudflare Container running the pinned Node build and hostname-based reverse proxy is the proposed provider path. Container availability, image deployment, persistent public origins, and cold-start behavior require a concrete probe before choosing it. If the account does not support that runtime, public Node hosting is an external prerequisite; this design does not pretend an ordinary Worker can host these entrypoints unchanged.

Create committed deployment configuration, container image definition, migrations, and secret-name inventory. Use the authenticated `cf` CLI only after the actual native Worker and container paths are proven. Configure distinct auth, panel, MCP, and publication origins. Supply secrets through protected provider secret storage. Do not print `.env.turso`, credentials, or migration dumps.

Migrate the existing owner before bootstrapping deployment. Back up the local database; suspend identity mutations briefly; copy the owner row and password account preserving IDs, password hash, and timestamps. Copy existing signing keys and clients only if their issuer, resource, and callbacks remain unchanged. Public origins differ from loopback, so register fresh deployed panel/introspection clients and resource links rather than retargeting live local credentials. Preserve the same owner ID. Do not copy transient OIDC transactions or local panel sessions. Local CLI grants remain local; reauthenticate both deployed CLIs against the public MCP URL. A repeatable migration checks identical destination rows and aborts on mismatch. Switch configuration only after foreign keys, owner ID, password login, and deployed client registration pass.

The panel uses the existing session identity for list, history, and open. Its open action selects an immutable revision. Published latest opens the stable publication URL. Historical preview uses the same sandbox policy with a revision-bound authenticated viewer route. Export uses the panel session or a verified MCP bearer token, never a bare signed public download URL.

## Synthesis decision

Pending the parent architect comparison. This candidate is structurally distinct from storing complete revision bytes in Turso. Its base advantage is a relational catalog with immutable object storage, while login is delegated to the already verified panel rather than a second OIDC implementation.

## Tradeoffs accepted

- We accept unreferenced R2 objects after failed writes in exchange for never exposing partially committed revisions.
- We accept one catalog transaction plus object reads in exchange for keeping binary file bytes outside identity SQL storage.
- We accept panel availability during first viewer login in exchange for one OIDC implementation and consistent account ownership.
- We accept self-contained HTML publication in exchange for safe script execution on available single-host Worker deployment.
- We accept retaining Node hosting in exchange for preserving tested Better Auth and Astro behavior.

## Alternatives considered

Whole revision snapshots in Turso hide more storage coordination behind the same public API and remove R2 orphan handling. They lose when large binaries make relational reads and export inefficient; no current measured artifact size requires R2. A publication Worker implementing independent OIDC hides redirect handling but exposes a second credential registration and revocation model to maintainers. It loses because the existing panel already owns those policies. A same-origin HTML route is shorter but exposes browser credential authority to artifact code and fails the isolation requirement.

## Open questions and risks

Is self-contained HTML sufficient, or must published documents execute arbitrary relative file assets? Does the authenticated Cloudflare account expose a usable Node container runtime? What upload bounds can the deployment support without buffering unacceptable ZIPs? These are unresolved evidence or product constraints, not claims of deployed support. The initial safe boundary is 5 MiB content, 20 MiB total file bytes, and 100 files per revision, enforced once at ingress and in export size planning.

## Next implementation step

Probe the native publication Worker and Node hosting path, then implement a disposable end-to-end create/read/update/CAS/export proof against private R2 and the catalog before wiring the tools and panel.

## Verification gates

Prove byte-for-byte revision immutability, historical metadata, Unicode/path rejection, deterministic export, operation replay, two simultaneous writers, two simultaneous publishers, R2 failure before commit, and cross-owner rejection. Run the existing identity suite. In the browser, prove anonymous denial, login handoff replay rejection, historical preview, script isolation, attachment download, logout/revocation denial, and no secrets in the publication response. Finally run deployed Claude to create/publish, deployed Codex to read/update/republish, and the logged-in panel to confirm both revisions and the same stable URL. CLI `whoami` alone does not satisfy the cross-tool requirement.

## Design red-flag screen

The artifact service is the sole writer. Domain exports hide SQL/R2 internals. Revision metadata has one source. Publication consumes revision manifests and does not recreate content. MCP and panel both use one operation path. Login handoff is one protocol with atomic consumption. CAS, composite foreign keys, and package exports encode the invariants rather than relying on neighboring examples, following encode-lessons-in-structure. The additional storage provider earns its boundary only if the synthesis accepts binary size as a known requirement.
