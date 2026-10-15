import { and, asc, count, desc, eq, gt, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { zipSync, type Zippable } from 'fflate';
import type { Database } from '@artifacts/db';
import { artifact, artifactCommand, artifactPublication, artifactRevision, publicationGrant, session } from '@artifacts/db/schema';
import { ArtifactError, artifactReadSchema, consumeGrantSchema, createSchema, decodeFile, exportSchema, historySchema, issueGrantSchema, libraryQuerySchema, listSchema, publishResultSchema, publishSchema, readSchema, snapshotSchema, updateSchema, viewerSchema, type Actor, type Archive, type ArtifactLibraryPage, type ArtifactRead, type ArtifactSummary, type Publication, type Revision, type UpdateInput, type Viewer } from './contracts.ts';
import { canonicalJson, sha256 } from './serialization.ts';

export * from './contracts.ts';

type Connection = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;
type RevisionRow = typeof artifactRevision.$inferSelect;

function revision(row: RevisionRow): Revision {
  return { id: row.id, parentRevisionId: row.parentRevisionId, sequence: row.sequence, authorUserId: row.authorUserId, authorClientId: row.authorClientId, createdAt: row.createdAt.toISOString(), sha256: row.sha256, snapshot: snapshotSchema.parse(JSON.parse(row.snapshot)) };
}

function isBusy(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return ('code' in error && typeof error.code === 'string' && /SQLITE_BUSY|SQLITE_LOCKED/.test(error.code)) || isBusy(error.cause);
}

export function createArtifactStore(db: Database, options: { publishOrigin: string }) {
  const origin = new URL(options.publishOrigin).origin;
  const callback = `${origin}/callback`;
  const urlFor = (artifactId: string) => `${origin}/a/${encodeURIComponent(artifactId)}`;
  const publication = (artifactId: string, row: typeof artifactPublication.$inferSelect | undefined): Publication | null => row ? { revisionId: row.revisionId, version: row.version, url: urlFor(artifactId) } : null;

  async function liveSession(connection: Connection, userId: string, sessionId: string) {
    const [found] = await connection.select().from(session).where(and(eq(session.id, sessionId), eq(session.userId, userId), gt(session.expiresAt, new Date()))).limit(1);
    if (!found) throw new ArtifactError('forbidden', 'A live owner session is required');
    return found;
  }

  async function authorize(connection: Connection, actor: Actor, scope: string) {
    if (!actor.scopes.includes(scope)) throw new ArtifactError('forbidden', `The ${scope} scope is required`, { requiredScope: scope });
    return liveSession(connection, actor.userId, actor.sessionId);
  }

  async function owned(connection: Connection, ownerId: string, artifactId: string) {
    const [found] = await connection.select().from(artifact).where(and(eq(artifact.id, artifactId), eq(artifact.ownerId, ownerId))).limit(1);
    if (!found) throw new ArtifactError('not_found', 'Artifact not found');
    return found;
  }

  async function readOwned(connection: Connection, ownerId: string, artifactId: string, revisionId?: string): Promise<ArtifactRead> {
    const found = await owned(connection, ownerId, artifactId);
    const [row] = await connection.select().from(artifactRevision).where(and(eq(artifactRevision.artifactId, artifactId), eq(artifactRevision.id, revisionId ?? found.headRevisionId))).limit(1);
    if (!row) throw new ArtifactError('not_found', 'Revision not found');
    const [selected] = await connection.select().from(artifactPublication).where(eq(artifactPublication.artifactId, artifactId)).limit(1);
    return { artifactId, ownerId, headRevisionId: found.headRevisionId, publication: publication(artifactId, selected), revision: revision(row) };
  }

  async function transaction<T>(work: (connection: Connection) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await db.transaction(work); }
      catch (error) {
        if (attempt >= 5 || !isBusy(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
      }
    }
  }

  async function command<T>(actor: Actor, scope: string, kind: string, input: { requestId: string }, output: z.ZodType<T>, work: (connection: Connection) => Promise<T>): Promise<T> {
    const payloadHash = await sha256(canonicalJson({ kind, input }));
    return transaction(async (connection) => {
      await authorize(connection, actor, scope);
      const [receipt] = await connection.select().from(artifactCommand).where(and(eq(artifactCommand.ownerId, actor.userId), eq(artifactCommand.requestId, input.requestId))).limit(1);
      if (receipt) {
        if (receipt.payloadHash !== payloadHash) throw new ArtifactError('request_conflict', 'Request ID already used with different arguments');
        return output.parse(JSON.parse(receipt.result));
      }
      const result = await work(connection);
      await connection.insert(artifactCommand).values({ ownerId: actor.userId, requestId: input.requestId, payloadHash, result: canonicalJson(result), createdAt: new Date() });
      return result;
    });
  }

  const store = {
    async create(actor: Actor, value: z.input<typeof createSchema>): Promise<ArtifactRead> {
      const input = createSchema.parse(value);
      const snapshot = canonicalJson(input.snapshot);
      const digest = await sha256(snapshot);
      return command(actor, 'artifacts:write', 'create', input, artifactReadSchema, async (connection) => {
        const artifactId = crypto.randomUUID();
        const revisionId = crypto.randomUUID();
        const createdAt = new Date();
        await connection.insert(artifact).values({ id: artifactId, ownerId: actor.userId, headRevisionId: revisionId, createdAt });
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
      return command(actor, 'artifacts:write', 'update', input, artifactReadSchema, async (connection) => {
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

    async list(actor: Actor, value: z.input<typeof listSchema> = {}): Promise<{ items: ArtifactSummary[]; nextCursor: string | null }> {
      const input = listSchema.parse(value);
      return transaction(async (connection) => {
        await authorize(connection, actor, 'artifacts:read');
        const rows = await connection.select({ artifact, title: sql<string>`json_extract(${artifactRevision.snapshot}, '$.metadata.title')`.mapWith(String), publication: artifactPublication }).from(artifact)
          .innerJoin(artifactRevision, and(eq(artifactRevision.artifactId, artifact.id), eq(artifactRevision.id, artifact.headRevisionId)))
          .leftJoin(artifactPublication, eq(artifactPublication.artifactId, artifact.id))
          .where(and(eq(artifact.ownerId, actor.userId), input.cursor ? gt(artifact.id, input.cursor) : undefined)).orderBy(asc(artifact.id)).limit(input.limit + 1);
        const items = rows.slice(0, input.limit).map((row) => ({ artifactId: row.artifact.id, title: row.title, headRevisionId: row.artifact.headRevisionId, createdAt: row.artifact.createdAt.toISOString(), publication: publication(row.artifact.id, row.publication ?? undefined) }));
        return { items, nextCursor: rows.length > input.limit ? items.at(-1)?.artifactId ?? null : null };
      });
    },

    async queryLibrary(actor: Actor, value: z.input<typeof libraryQuerySchema> = {}): Promise<ArtifactLibraryPage> {
      const input = libraryQuerySchema.parse(value);
      const limit = 25;
      const title = sql<string>`json_extract(${artifactRevision.snapshot}, '$.metadata.title')`.mapWith(String);
      const statuses = {
        all: undefined,
        published: isNotNull(artifactPublication.artifactId),
        unpublished: isNull(artifactPublication.artifactId),
        pending: and(isNotNull(artifactPublication.artifactId), ne(artifactPublication.revisionId, artifact.headRevisionId)),
      };
      const matching = and(eq(artifact.ownerId, actor.userId), input.q ? or(sql`instr(lower(${title}), lower(${input.q})) > 0`, sql`instr(lower(${artifact.id}), lower(${input.q})) > 0`) : undefined);
      return transaction(async (connection) => {
        await authorize(connection, actor, 'artifacts:read');
        const rows = await connection.select({ artifact, title, publication: artifactPublication }).from(artifact)
          .innerJoin(artifactRevision, and(eq(artifactRevision.artifactId, artifact.id), eq(artifactRevision.id, artifact.headRevisionId)))
          .leftJoin(artifactPublication, eq(artifactPublication.artifactId, artifact.id))
          .where(and(matching, statuses[input.status], input.cursor ? gt(artifact.id, input.cursor) : undefined)).orderBy(asc(artifact.id)).limit(limit + 1);
        const [counts] = await connection.select({
          all: count(),
          published: sql<number>`coalesce(sum(case when ${artifactPublication.artifactId} is not null then 1 else 0 end), 0)`.mapWith(Number),
          unpublished: sql<number>`coalesce(sum(case when ${artifactPublication.artifactId} is null then 1 else 0 end), 0)`.mapWith(Number),
          pending: sql<number>`coalesce(sum(case when ${artifactPublication.artifactId} is not null and ${artifactPublication.revisionId} != ${artifact.headRevisionId} then 1 else 0 end), 0)`.mapWith(Number),
        }).from(artifact)
          .innerJoin(artifactRevision, and(eq(artifactRevision.artifactId, artifact.id), eq(artifactRevision.id, artifact.headRevisionId)))
          .leftJoin(artifactPublication, eq(artifactPublication.artifactId, artifact.id)).where(matching);
        const items = rows.slice(0, limit).map((row) => ({ artifactId: row.artifact.id, title: row.title, headRevisionId: row.artifact.headRevisionId, createdAt: row.artifact.createdAt.toISOString(), publication: publication(row.artifact.id, row.publication ?? undefined) }));
        return { items, nextCursor: rows.length > limit ? items.at(-1)?.artifactId ?? null : null, counts };
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
        const found = await readOwned(connection, actor.userId, input.artifactId);
        if (!found.publication) throw new ArtifactError('not_found', 'Artifact is not published');
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
          .innerJoin(artifact, and(eq(artifact.id, publicationGrant.artifactId), eq(artifact.ownerId, publicationGrant.userId)))
          .where(and(eq(publicationGrant.codeHash, codeHash), eq(publicationGrant.state, input.state), eq(publicationGrant.artifactId, input.artifactId), eq(publicationGrant.callback, callback), gt(publicationGrant.expiresAt, new Date()), gt(session.expiresAt, new Date()))).limit(1);
        if (!found) throw new ArtifactError('invalid_grant', 'Publication grant is invalid or expired');
        const consumed = await connection.delete(publicationGrant).where(eq(publicationGrant.codeHash, codeHash)).returning({ codeHash: publicationGrant.codeHash });
        if (consumed.length !== 1) throw new ArtifactError('invalid_grant', 'Publication grant was already consumed');
        return { artifactId: input.artifactId, userId: found.grant.userId, sessionId: found.grant.sessionId, expiresAt: Math.min(Date.now() + 60 * 60_000, found.session.expiresAt.getTime()) };
      });
    },

    async readPublished(viewerValue: Viewer, value: z.input<typeof readSchema>): Promise<ArtifactRead> {
      const viewer = viewerSchema.parse(viewerValue);
      const input = readSchema.parse(value);
      if (viewer.artifactId !== input.artifactId || viewer.expiresAt <= Date.now()) throw new ArtifactError('forbidden', 'Publication viewer is invalid or expired');
      return transaction(async (connection) => {
        await liveSession(connection, viewer.userId, viewer.sessionId);
        await owned(connection, viewer.userId, input.artifactId);
        const [selected] = await connection.select().from(artifactPublication).where(eq(artifactPublication.artifactId, input.artifactId)).limit(1);
        if (!selected || (input.revisionId && input.revisionId !== selected.revisionId)) throw new ArtifactError('not_found', 'Published revision not found');
        return readOwned(connection, viewer.userId, input.artifactId, selected.revisionId);
      });
    },
  };
  return store;
}

export type ArtifactStore = ReturnType<typeof createArtifactStore>;
