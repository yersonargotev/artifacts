import { and, asc, desc, eq, exists, gt, lt, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import { zipSync, type Zippable } from 'fflate';
import type { Database } from '@artifacts/db';
import { artifact, artifactCommand, artifactPublication, artifactRevision, artifactShare, publicationGrant, session, user } from '@artifacts/db/schema';
import { ArtifactError, artifactReadSchema, consumeGrantSchema, createSchema, decodeFile, deleteSchema, deleteResultSchema, exportSchema, historySchema, issueGrantSchema, listSchema, listSharesSchema, moveResultSchema, moveSchema, publishResultSchema, publishSchema, readSchema, shareResultSchema, shareSchema, unshareResultSchema, unshareSchema, updateSchema, viewerSchema, type Actor, type Archive, type ArtifactRead, type ArtifactSummary, type MoveResult, type ProjectSummary, type Publication, type Revision, type Share, type SharedRead, type UnshareResult, type UpdateInput, type Viewer } from './contracts.ts';
import { canonicalJson, sha256 } from './serialization.ts';
import { createAccess, type Connection } from './access.ts';
import { revision } from './revision.ts';
import type { SharedArtifactSummary } from './contracts.ts';

export * from './contracts.ts';

const artifactReceiptSchema = artifactReadSchema.extend({ project: artifactReadSchema.shape.project.default(null) });

export function createArtifactStore(db: Database, options: { publishOrigin: string }) {
  const { transaction, authorize, liveSession, command, projectSpelling, ownedProjects, publicationUrl: urlFor, callback } = createAccess(db, options);
  const publication = (artifactId: string, row: typeof artifactPublication.$inferSelect | undefined): Publication | null => row ? { revisionId: row.revisionId, version: row.version, url: urlFor(artifactId) } : null;
  const summary = (row: { artifact: typeof artifact.$inferSelect; title: string; publication: typeof artifactPublication.$inferSelect | null }): ArtifactSummary => ({ artifactId: row.artifact.id, title: row.title, headRevisionId: row.artifact.headRevisionId, createdAt: row.artifact.createdAt.toISOString(), project: row.artifact.project, publication: publication(row.artifact.id, row.publication ?? undefined) });
  const shareOf = (row: typeof artifactShare.$inferSelect): Share => ({ shareId: row.id, artifactId: row.artifactId, kind: row.kind, value: row.value, createdAt: row.createdAt.toISOString() });
  const displayName = (name: string) => name.trim() || 'Usuario de Artifacts';

  async function owned(connection: Connection, ownerId: string, artifactId: string) {
    const [found] = await connection.select().from(artifact).where(and(eq(artifact.id, artifactId), eq(artifact.ownerId, ownerId))).limit(1);
    if (!found) throw new ArtifactError('not_found', 'Artifact not found');
    return found;
  }

  async function canView(connection: Connection, userId: string, artifactId: string) {
    const sharedWithViewer = connection.select({ id: artifactShare.id }).from(artifactShare)
      .innerJoin(user, and(eq(user.id, userId), eq(user.emailVerified, true)))
      .where(and(eq(artifactShare.artifactId, artifact.id), eq(artifactShare.kind, 'email'), eq(artifactShare.value, sql`lower(${user.email})`)));
    const [found] = await connection.select().from(artifact).where(and(eq(artifact.id, artifactId), or(eq(artifact.ownerId, userId), exists(sharedWithViewer)))).limit(1);
    return found;
  }

  async function readArtifact(connection: Connection, found: typeof artifact.$inferSelect, revisionId = found.headRevisionId): Promise<ArtifactRead> {
    const [row] = await connection.select().from(artifactRevision).where(and(eq(artifactRevision.artifactId, found.id), eq(artifactRevision.id, revisionId))).limit(1);
    if (!row) throw new ArtifactError('not_found', 'Revision not found');
    const [selected] = await connection.select().from(artifactPublication).where(eq(artifactPublication.artifactId, found.id)).limit(1);
    return { artifactId: found.id, ownerId: found.ownerId, headRevisionId: found.headRevisionId, project: found.project, publication: publication(found.id, selected), revision: revision(row) };
  }

  async function readOwned(connection: Connection, ownerId: string, artifactId: string, revisionId?: string): Promise<ArtifactRead> {
    return readArtifact(connection, await owned(connection, ownerId, artifactId), revisionId);
  }

  const store = {
    async create(actor: Actor, value: z.input<typeof createSchema>): Promise<ArtifactRead> {
      const input = createSchema.parse(value);
      const snapshot = canonicalJson(input.snapshot);
      const digest = await sha256(snapshot);
      return command(actor, 'artifacts:write', 'create', input, artifactReceiptSchema, async (connection) => {
        const artifactId = crypto.randomUUID();
        const revisionId = crypto.randomUUID();
        const createdAt = new Date();
        const project = input.project === undefined ? null : await projectSpelling(connection, actor.userId, input.project);
        await connection.insert(artifact).values({ id: artifactId, ownerId: actor.userId, headRevisionId: revisionId, createdAt, project });
        await connection.insert(artifactRevision).values({ id: revisionId, artifactId, parentRevisionId: null, sequence: 1, authorUserId: actor.userId, authorClientId: actor.clientId, createdAt, sha256: digest, snapshot });
        return readOwned(connection, actor.userId, artifactId);
      });
    },

    async read(actor: Actor, value: z.input<typeof readSchema>): Promise<ArtifactRead> {
      const input = readSchema.parse(value);
      return transaction(async (connection) => {
        await authorize(connection, actor, 'artifacts:read');
        return readOwned(connection, actor.userId, input.artifactId, input.revisionId);
      });
    },

    async update(actor: Actor, value: UpdateInput): Promise<ArtifactRead> {
      const input = updateSchema.parse(value);
      const snapshot = canonicalJson(input.snapshot);
      const digest = await sha256(snapshot);
      return command(actor, 'artifacts:write', 'update', input, artifactReceiptSchema, async (connection) => {
        const current = await readOwned(connection, actor.userId, input.artifactId);
        if (current.headRevisionId !== input.expectedRevisionId) throw new ArtifactError('conflict', 'Artifact head changed', { currentRevisionId: current.headRevisionId });
        const revisionId = crypto.randomUUID();
        await connection.insert(artifactRevision).values({ id: revisionId, artifactId: input.artifactId, parentRevisionId: current.headRevisionId, sequence: current.revision.sequence + 1, authorUserId: actor.userId, authorClientId: actor.clientId, createdAt: new Date(), sha256: digest, snapshot });
        const changed = await connection.update(artifact).set({ headRevisionId: revisionId }).where(and(eq(artifact.id, input.artifactId), eq(artifact.ownerId, actor.userId), eq(artifact.headRevisionId, input.expectedRevisionId))).returning({ id: artifact.id });
        if (changed.length !== 1) throw new ArtifactError('conflict', 'Artifact head changed');
        return readOwned(connection, actor.userId, input.artifactId);
      });
    },

    async publish(actor: Actor, value: z.input<typeof publishSchema>) {
      const input = publishSchema.parse(value);
      return command(actor, 'artifacts:publish', 'publish', input, publishResultSchema, async (connection) => {
        const current = await readOwned(connection, actor.userId, input.artifactId, input.revisionId);
        const version = current.publication?.version ?? 0;
        if (version !== input.expectedPublicationVersion) throw new ArtifactError('conflict', 'Publication changed', { currentPublicationVersion: version });
        if (current.publication?.revisionId === input.revisionId) return { artifactId: input.artifactId, ...current.publication };
        const values = { artifactId: input.artifactId, revisionId: input.revisionId, version: version + 1 };
        if (version === 0) await connection.insert(artifactPublication).values(values);
        else {
          const changed = await connection.update(artifactPublication).set(values).where(and(eq(artifactPublication.artifactId, input.artifactId), eq(artifactPublication.version, input.expectedPublicationVersion))).returning({ version: artifactPublication.version });
          if (changed.length !== 1) throw new ArtifactError('conflict', 'Publication changed');
        }
        return { ...values, url: urlFor(input.artifactId) };
      });
    },

    async share(actor: Actor, value: z.input<typeof shareSchema>): Promise<Share> {
      const input = shareSchema.parse(value);
      return command(actor, 'artifacts:publish', 'share', input, shareResultSchema, async (connection) => {
        await owned(connection, actor.userId, input.artifactId);
        await connection.insert(artifactShare).values({ id: crypto.randomUUID(), artifactId: input.artifactId, kind: 'email', value: input.email, createdBy: actor.userId, createdAt: new Date() }).onConflictDoNothing();
        const [row] = await connection.select().from(artifactShare).where(and(eq(artifactShare.artifactId, input.artifactId), eq(artifactShare.kind, 'email'), eq(artifactShare.value, input.email))).limit(1);
        return shareOf(row!);
      });
    },

    async unshare(actor: Actor, value: z.input<typeof unshareSchema>): Promise<UnshareResult> {
      const input = unshareSchema.parse(value);
      return command(actor, 'artifacts:publish', 'unshare', input, unshareResultSchema, async (connection) => {
        await owned(connection, actor.userId, input.artifactId);
        const removed = await connection.delete(artifactShare).where(and(eq(artifactShare.id, input.shareId), eq(artifactShare.artifactId, input.artifactId))).returning({ shareId: artifactShare.id });
        if (removed.length !== 1) throw new ArtifactError('not_found', 'Share not found');
        return { artifactId: input.artifactId, shareId: input.shareId };
      });
    },

    async listShares(actor: Actor, value: z.input<typeof listSharesSchema>): Promise<{ items: Share[] }> {
      const input = listSharesSchema.parse(value);
      return transaction(async (connection) => {
        await authorize(connection, actor, 'artifacts:publish');
        await owned(connection, actor.userId, input.artifactId);
        const rows = await connection.select().from(artifactShare).where(eq(artifactShare.artifactId, input.artifactId)).orderBy(asc(artifactShare.kind), asc(artifactShare.value));
        return { items: rows.map(shareOf) };
      });
    },

    async listSharedWithMe(actor: Actor): Promise<{ items: SharedArtifactSummary[] }> {
      return transaction(async (connection) => {
        await authorize(connection, actor, 'artifacts:read');
        const viewer = alias(user, 'viewer');
        const owner = alias(user, 'owner');
        const rows = await connection.select({ artifactId: artifact.id, title: sql<string>`json_extract(${artifactRevision.snapshot}, '$.metadata.title')`.mapWith(String), ownerName: owner.name }).from(artifactShare)
          .innerJoin(viewer, and(eq(viewer.id, actor.userId), eq(viewer.emailVerified, true), eq(artifactShare.value, sql`lower(${viewer.email})`)))
          .innerJoin(artifact, eq(artifact.id, artifactShare.artifactId))
          .innerJoin(artifactPublication, eq(artifactPublication.artifactId, artifact.id))
          .innerJoin(artifactRevision, and(eq(artifactRevision.artifactId, artifact.id), eq(artifactRevision.id, artifactPublication.revisionId)))
          .innerJoin(owner, eq(owner.id, artifact.ownerId))
          .where(and(eq(artifactShare.kind, 'email'), ne(artifact.ownerId, actor.userId)))
          .orderBy(desc(artifactShare.createdAt), asc(artifact.id));
        return { items: rows.map((row) => ({ ...row, ownerName: displayName(row.ownerName), url: urlFor(row.artifactId) })) };
      });
    },

    async delete(actor: Actor, value: z.input<typeof deleteSchema>) {
      const input = deleteSchema.parse(value);
      return command(actor, 'artifacts:write', 'delete', input, deleteResultSchema, async (connection) => {
        const current = await readOwned(connection, actor.userId, input.artifactId);
        if (current.headRevisionId !== input.expectedRevisionId || (current.publication?.version ?? 0) !== input.expectedPublicationVersion) {
          throw new ArtifactError('conflict', 'Artifact changed since confirmation', { currentRevisionId: current.headRevisionId, currentPublicationVersion: current.publication?.version ?? 0 });
        }
        const matching = and(eq(artifactCommand.ownerId, actor.userId), sql`json_extract(${artifactCommand.result}, '$.artifactId') = ${input.artifactId}`);
        await connection.update(artifactCommand).set({ payloadHash: '', result: canonicalJson({ kind: 'artifact_deleted', artifactId: input.artifactId }) }).where(matching);
        const removed = await connection.delete(artifact).where(and(eq(artifact.id, input.artifactId), eq(artifact.ownerId, actor.userId))).returning({ artifactId: artifact.id });
        if (removed.length !== 1) throw new ArtifactError('not_found', 'Artifact not found');
        return { artifactId: input.artifactId };
      });
    },

    async move(actor: Actor, value: z.input<typeof moveSchema>): Promise<MoveResult> {
      const input = moveSchema.parse(value);
      return command(actor, 'artifacts:write', 'move', input, moveResultSchema, async (connection) => {
        await owned(connection, actor.userId, input.artifactId);
        const project = input.project === null ? null : await projectSpelling(connection, actor.userId, input.project);
        await connection.update(artifact).set({ project }).where(and(eq(artifact.id, input.artifactId), eq(artifact.ownerId, actor.userId)));
        return { artifactId: input.artifactId, project };
      });
    },

    async projects(actor: Actor): Promise<{ items: ProjectSummary[] }> {
      return transaction(async (connection) => {
        await authorize(connection, actor, 'artifacts:read');
        return { items: await ownedProjects(connection, actor.userId) };
      });
    },

    async list(actor: Actor, value: z.input<typeof listSchema> = {}): Promise<{ items: ArtifactSummary[]; nextCursor: string | null }> {
      const input = listSchema.parse(value);
      return transaction(async (connection) => {
        await authorize(connection, actor, 'artifacts:read');
        const project = input.project === undefined ? undefined : eq(artifact.project, await projectSpelling(connection, actor.userId, input.project));
        const rows = await connection.select({ artifact, title: sql<string>`json_extract(${artifactRevision.snapshot}, '$.metadata.title')`.mapWith(String), publication: artifactPublication }).from(artifact)
          .innerJoin(artifactRevision, and(eq(artifactRevision.artifactId, artifact.id), eq(artifactRevision.id, artifact.headRevisionId)))
          .leftJoin(artifactPublication, eq(artifactPublication.artifactId, artifact.id))
          .where(and(eq(artifact.ownerId, actor.userId), project, input.cursor ? gt(artifact.id, input.cursor) : undefined)).orderBy(asc(artifact.id)).limit(input.limit + 1);
        const items = rows.slice(0, input.limit).map(summary);
        return { items, nextCursor: rows.length > input.limit ? items.at(-1)?.artifactId ?? null : null };
      });
    },

    async history(actor: Actor, value: z.input<typeof historySchema>): Promise<{ items: Revision[]; nextBeforeSequence: number | null }> {
      const input = historySchema.parse(value);
      return transaction(async (connection) => {
        await authorize(connection, actor, 'artifacts:read');
        await owned(connection, actor.userId, input.artifactId);
        const rows = await connection.select().from(artifactRevision).where(and(eq(artifactRevision.artifactId, input.artifactId), input.beforeSequence ? lt(artifactRevision.sequence, input.beforeSequence) : undefined)).orderBy(desc(artifactRevision.sequence)).limit(input.limit + 1);
        const items = rows.slice(0, input.limit).map(revision);
        return { items, nextBeforeSequence: rows.length > input.limit ? items.at(-1)?.sequence ?? null : null };
      });
    },

    async export(actor: Actor, value: z.input<typeof exportSchema>): Promise<Archive> {
      const input = exportSchema.parse(value);
      const document = await store.read(actor, input);
      const selected = document.revision;
      const files = [...selected.snapshot.files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
      const fileManifest = await Promise.all(files.map(async (file) => ({ path: file.path, mediaType: file.mediaType, encoding: file.encoding, size: decodeFile(file).length, sha256: await sha256(decodeFile(file)) })));
      const { snapshot, ...revisionMetadata } = selected;
      const extension = { html: 'html', markdown: 'md', text: 'txt' }[snapshot.content.kind];
      const manifest = { formatVersion: 1, artifactId: document.artifactId, ownerId: document.ownerId, revision: revisionMetadata, metadata: snapshot.metadata, content: { kind: snapshot.content.kind, path: `content.${extension}` }, files: fileManifest };
      const archive: Zippable = {
        'artifact.json': new TextEncoder().encode(`${canonicalJson(manifest)}\n`),
        [`content.${extension}`]: new TextEncoder().encode(snapshot.content.text),
      };
      for (const file of files) archive[`files/${file.path}`] = decodeFile(file);
      const bytes = zipSync(archive, { level: 0, mtime: new Date(1980, 0, 1, 0, 0, 0), os: 0, attrs: 0 });
      return { filename: `${document.artifactId}-${selected.id}.zip`, mediaType: 'application/zip', base64: Buffer.from(bytes).toString('base64'), sha256: await sha256(bytes) };
    },

    async issuePublicationGrant(actor: Actor, value: z.input<typeof issueGrantSchema>): Promise<{ code: string; expiresAt: number }> {
      const input = issueGrantSchema.parse(value);
      const code = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
      const codeHash = await sha256(code);
      return transaction(async (connection) => {
        const current = await authorize(connection, actor, 'artifacts:read');
        if (!await canView(connection, actor.userId, input.artifactId)) throw new ArtifactError('not_found', 'Artifact not found');
        const [published] = await connection.select({ revisionId: artifactPublication.revisionId }).from(artifactPublication).where(eq(artifactPublication.artifactId, input.artifactId)).limit(1);
        if (!published) throw new ArtifactError('not_found', 'Artifact is not published');
        const expiresAt = Math.min(Date.now() + 60_000, current.expiresAt.getTime());
        await connection.insert(publicationGrant).values({ codeHash, state: input.state, artifactId: input.artifactId, userId: actor.userId, sessionId: actor.sessionId, callback, expiresAt: new Date(expiresAt) });
        return { code, expiresAt };
      });
    },

    async consumePublicationGrant(value: z.input<typeof consumeGrantSchema>): Promise<Viewer> {
      const input = consumeGrantSchema.parse(value);
      const codeHash = await sha256(input.code);
      return transaction(async (connection) => {
        const [found] = await connection.select({ grant: publicationGrant, session }).from(publicationGrant).innerJoin(session, and(eq(session.id, publicationGrant.sessionId), eq(session.userId, publicationGrant.userId)))
          .where(and(eq(publicationGrant.codeHash, codeHash), eq(publicationGrant.state, input.state), eq(publicationGrant.artifactId, input.artifactId), eq(publicationGrant.callback, callback), gt(publicationGrant.expiresAt, new Date()), gt(session.expiresAt, new Date()))).limit(1);
        if (!found || !await canView(connection, found.grant.userId, input.artifactId)) throw new ArtifactError('invalid_grant', 'Publication grant is invalid or expired');
        const consumed = await connection.delete(publicationGrant).where(eq(publicationGrant.codeHash, codeHash)).returning({ codeHash: publicationGrant.codeHash });
        if (consumed.length !== 1) throw new ArtifactError('invalid_grant', 'Publication grant was already consumed');
        return { artifactId: input.artifactId, userId: found.grant.userId, sessionId: found.grant.sessionId, expiresAt: Math.min(Date.now() + 60 * 60_000, found.session.expiresAt.getTime()) };
      });
    },

    async readPublished(viewerValue: Viewer, value: z.input<typeof readSchema>): Promise<ArtifactRead | SharedRead> {
      const viewer = viewerSchema.parse(viewerValue);
      const input = readSchema.parse(value);
      if (viewer.artifactId !== input.artifactId || viewer.expiresAt <= Date.now()) throw new ArtifactError('forbidden', 'Publication viewer is invalid or expired');
      return transaction(async (connection) => {
        await liveSession(connection, viewer.userId, viewer.sessionId);
        const found = await canView(connection, viewer.userId, input.artifactId);
        if (!found) throw new ArtifactError('not_found', 'Artifact not found');
        const [selected] = await connection.select().from(artifactPublication).where(eq(artifactPublication.artifactId, input.artifactId)).limit(1);
        const published = publication(input.artifactId, selected);
        if (!published || (input.revisionId && input.revisionId !== published.revisionId)) throw new ArtifactError('not_found', 'Published revision not found');
        const read = await readArtifact(connection, found, published.revisionId);
        if (found.ownerId === viewer.userId) return read;
        const [owner] = await connection.select({ name: user.name }).from(user).where(eq(user.id, found.ownerId)).limit(1);
        return { artifactId: read.artifactId, ownerName: displayName(owner!.name), publication: published, revision: { id: read.revision.id, createdAt: read.revision.createdAt, sha256: read.revision.sha256, snapshot: read.revision.snapshot } };
      });
    },
  };
  return store;
}

export type ArtifactStore = ReturnType<typeof createArtifactStore>;
