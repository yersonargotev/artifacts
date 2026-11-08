import { and, asc, count, desc, eq, exists, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { alias, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import { zipSync, type Zippable } from 'fflate';
import { Parser } from 'htmlparser2';
import type { AccessPolicy } from '@artifacts/config';
import { createAdmission } from '@artifacts/db/admission';
import type { Database } from '@artifacts/db';
import { artifact, artifactCommand, artifactInvitationBudget, artifactPublication, artifactRevision, artifactShare, publicationGrant, session, user } from '@artifacts/db/schema';
import { ArtifactError, artifactReadSchema, batchResultSchema, batchSchema, consumeGrantSchema, createSchema, decodeFile, deleteSchema, deleteResultSchema, exportSchema, historySchema, issueGrantSchema, listSchema, listSharesSchema, moveResultSchema, moveSchema, publishResultSchema, publishSchema, readByIdSchema, readSchema, searchSchema, shareCommandResultSchema, shareSchema, unshareResultSchema, unshareSchema, updateSchema, viewerSchema, type Actor, type Archive, type ArtifactRead, type ArtifactSummary, type BatchResult, type MoveResult, type ProjectSummary, type Publication, type Revision, type SearchResult, type Share, type ShareResult, type SharedRead, type Snapshot, type UnshareResult, type UpdateInput, type Viewer } from './contracts.ts';
import { canonicalJson, sha256 } from './serialization.ts';
import { createAccess, isBusy, isConstraint, writeTransaction, type Connection } from './access.ts';
import { planBatch } from './batch.ts';
import { projectKey } from './panel/model.ts';
import { revision } from './revision.ts';
import { invitation, type InvitationSender } from './invitation.ts';
import type { SharedArtifactSummary } from './contracts.ts';

export * from './contracts.ts';

// drizzle-kit does not model FTS5, so the table lives here instead of schema.ts and migration 0006 creates it by hand.
const artifactSearch = sqliteTable('artifact_search', { artifactId: text('artifact_id').notNull(), title: text('title').notNull(), description: text('description').notNull(), body: text('body').notNull() });

function htmlText(html: string): string {
  const chunks: string[] = [];
  let hidden = 0;
  // A space at every tag boundary keeps <p>a</p><p>b</p> as two words.
  const parser = new Parser({
    onopentagname(name) { chunks.push(' '); if (name === 'script' || name === 'style') hidden++; },
    onclosetag(name) { chunks.push(' '); if ((name === 'script' || name === 'style') && hidden > 0) hidden--; },
    ontext(text) { if (hidden === 0) chunks.push(text); },
  });
  parser.end(html);
  return chunks.join('').replace(/\s+/g, ' ').trim();
}

// The canvas JSON of a design is layout, not prose, so a design is found by its metadata alone.
const searchBody: Record<Snapshot['content']['kind'], (text: string) => string> = {
  markdown: (text) => text,
  text: (text) => text,
  html: htmlText,
  design: () => '',
};

const searchRow = (artifactId: string, snapshot: Snapshot) => ({ artifactId, title: snapshot.metadata.title, description: snapshot.metadata.description, body: searchBody[snapshot.content.kind](snapshot.content.text) });

async function indexHead(connection: Connection, artifactId: string, snapshot: Snapshot) {
  await connection.delete(artifactSearch).where(eq(artifactSearch.artifactId, artifactId));
  await connection.insert(artifactSearch).values(searchRow(artifactId, snapshot));
}

type Statement = Parameters<Database['$client']['batch']>[0][number];
const statement = (query: { toSQL(): { sql: string; params: unknown[] } }): Statement => {
  const { sql, params } = query.toSQL();
  return { sql, args: params as Extract<Statement, { args?: unknown }>['args'] };
};
// A write batch cannot branch on a row count, so a move that left its artifact elsewhere or under another head fails a NOT NULL constraint and the store plans again. changes() is no substitute, because an FTS5 insert earlier in the batch keeps a later unmatched update from resetting it.
const moved = (ownerId: string, write: { artifactId: string; revisionId: string; project: string | null; slug: string | null }): Statement => ({
  sql: 'insert into artifact_command (owner_id) select null where not exists (select 1 from artifact where id = ? and owner_id = ? and head_revision_id = ? and project is ? and slug is ?)',
  args: [write.artifactId, ownerId, write.revisionId, write.project, write.slug],
});
// Projects group by letter case but the slug index compares spellings exactly. The batch fails when the owner holds a spelling outside the ones it read and placed, or when those name one project twice because the reads ran at different moments. An empty list fails on the batch's own placed rows.
const spelled = (ownerId: string, known: string[]): Statement => ({
  sql: 'insert into artifact_command (owner_id) select null where exists (select 1 from artifact where owner_id = ? and project not in (select value from json_each(?)))',
  args: [ownerId, JSON.stringify(new Set(known.map(projectKey)).size === known.length ? known : [])],
});
const held = alias(artifact, 'held');

export async function reindexSearch(db: Database): Promise<number> {
  let reindexed = 0;
  for (let last = ''; ;) {
    const page = await db.select({ id: artifact.id }).from(artifact).where(gt(artifact.id, last)).orderBy(asc(artifact.id)).limit(100);
    // One transaction per artifact rereads its head, so a concurrent update is never overwritten with a stale snapshot.
    for (const { id } of page) {
      const indexed = await writeTransaction(db, async (connection) => {
        const [head] = await connection.select({ revision: artifactRevision }).from(artifact)
          .innerJoin(artifactRevision, and(eq(artifactRevision.artifactId, artifact.id), eq(artifactRevision.id, artifact.headRevisionId)))
          .where(eq(artifact.id, id)).limit(1);
        if (!head) return false;
        await indexHead(connection, id, revision(head.revision).snapshot);
        return true;
      });
      if (indexed) reindexed++;
    }
    if (page.length < 100) return reindexed;
    last = page.at(-1)!.id;
  }
}

// Quoting every whitespace-separated chunk turns FTS5 operators in user input into plain terms, and adjacent phrases mean AND.
const matchExpression = (query: string) => query.split(/\s+/).map((term) => `"${term.replaceAll('"', '""')}"`).join(' ');

const artifactReceiptSchema = artifactReadSchema.extend({ project: artifactReadSchema.shape.project.default(null), slug: artifactReadSchema.shape.slug.default(null) });

export function createArtifactStore(db: Database, options: { publishOrigin: string; access: AccessPolicy; sendInvitation?: InvitationSender }) {
  const admission = createAdmission(db, options.access);
  const { transaction, authorize, liveSession, command, receipt, replay, projectSpelling, ownedProjects, bySlug, claimSlug, publicationUrl: urlFor, callback } = createAccess(db, options);
  const publication = (artifactId: string, row: typeof artifactPublication.$inferSelect | undefined): Publication | null => row ? { revisionId: row.revisionId, version: row.version, url: urlFor(artifactId) } : null;
  const summary = (row: { artifact: typeof artifact.$inferSelect; title: string; publication: typeof artifactPublication.$inferSelect | null }): ArtifactSummary => ({ artifactId: row.artifact.id, title: row.title, headRevisionId: row.artifact.headRevisionId, createdAt: row.artifact.createdAt.toISOString(), project: row.artifact.project, slug: row.artifact.slug, publication: publication(row.artifact.id, row.publication ?? undefined) });
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
    return { artifactId: found.id, ownerId: found.ownerId, headRevisionId: found.headRevisionId, project: found.project, slug: found.slug, publication: publication(found.id, selected), revision: revision(row) };
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
        const slug = input.slug ?? null;
        await claimSlug(connection, actor.userId, project, slug);
        await connection.insert(artifact).values({ id: artifactId, ownerId: actor.userId, headRevisionId: revisionId, createdAt, project, slug });
        await connection.insert(artifactRevision).values({ id: revisionId, artifactId, parentRevisionId: null, sequence: 1, authorUserId: actor.userId, authorClientId: actor.clientId, createdAt, sha256: digest, snapshot });
        await indexHead(connection, artifactId, input.snapshot);
        return readOwned(connection, actor.userId, artifactId);
      });
    },

    async read(actor: Actor, value: z.input<typeof readSchema>): Promise<ArtifactRead> {
      const input = readSchema.parse(value);
      return transaction(async (connection) => {
        await authorize(connection, actor, 'artifacts:read');
        if (input.artifactId !== undefined) return readOwned(connection, actor.userId, input.artifactId, input.revisionId);
        const project = input.project === undefined ? null : await projectSpelling(connection, actor.userId, input.project);
        const found = await bySlug(connection, actor.userId, project, input.slug!);
        if (!found) throw new ArtifactError('not_found', 'Artifact not found');
        return readArtifact(connection, found, input.revisionId);
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
        await indexHead(connection, input.artifactId, input.snapshot);
        return readOwned(connection, actor.userId, input.artifactId);
      });
    },

    async batch(actor: Actor, value: z.input<typeof batchSchema>): Promise<BatchResult> {
      const input = batchSchema.parse(value);
      const payloadHash = await sha256(canonicalJson({ kind: 'batch', input }));
      const snapshots = await Promise.all(input.operations.map(async (operation) => {
        if (operation.op === 'move') return undefined;
        const text = canonicalJson(operation.snapshot);
        return { text, digest: await sha256(text) };
      }));
      const ids = input.operations.flatMap((operation) => operation.op !== 'create' && operation.artifactId !== undefined ? [operation.artifactId] : []);
      const slugs = input.operations.flatMap((operation) => [operation.slug, operation.op === 'move' ? operation.from?.slug : undefined].filter((slug) => typeof slug === 'string'));
      // The writes travel as one batch request instead of an interactive transaction, so every read is repeated after a write that a stale read let through.
      for (let conflicts = 0, busy = 0; ;) {
        await authorize(db, actor, 'artifacts:write');
        const [stored, projects, pages] = await Promise.all([
          replay(db, actor.userId, input.requestId, payloadHash, batchResultSchema),
          ownedProjects(db, actor.userId),
          ids.length || slugs.length
            ? db.select({ artifactId: artifact.id, project: artifact.project, slug: artifact.slug, headRevisionId: artifact.headRevisionId, sequence: artifactRevision.sequence }).from(artifact)
              .innerJoin(artifactRevision, and(eq(artifactRevision.artifactId, artifact.id), eq(artifactRevision.id, artifact.headRevisionId)))
              // A move that keeps its slug checks the destination under the slug that its artifact already holds.
              .where(and(eq(artifact.ownerId, actor.userId), or(ids.length ? inArray(artifact.id, ids) : undefined, slugs.length ? inArray(artifact.slug, slugs) : undefined, ids.length ? inArray(artifact.slug, db.select({ slug: held.slug }).from(held).where(and(eq(held.ownerId, actor.userId), inArray(held.id, ids)))) : undefined)))
            : [],
        ]);
        if (stored) return stored.result;
        const { results, writes } = planBatch(input.operations, projects.map(({ name }) => name), pages, () => crypto.randomUUID());
        const createdAt = new Date();
        const author = { authorUserId: actor.userId, authorClientId: actor.clientId, createdAt };
        // Each guard fails the batch when a read no longer holds: the revision sequence index for a concurrent update, the revision foreign key for a delete, the slug index for a claimed slug, the moved check for a concurrent move, update, or delete, the spelled check for a concurrent new project spelling, and the receipt key for a raced retry.
        const statements = writes.flatMap((write) => {
          if (write.op === 'move') return [
            statement(db.update(artifact).set({ project: write.project, slug: write.slug }).where(and(eq(artifact.id, write.artifactId), eq(artifact.ownerId, actor.userId), write.from.project === null ? isNull(artifact.project) : eq(artifact.project, write.from.project), write.from.slug === null ? isNull(artifact.slug) : eq(artifact.slug, write.from.slug)))),
            moved(actor.userId, write),
          ];
          const { text, digest } = snapshots[write.index]!;
          if (write.op === 'create') return [
            statement(db.insert(artifact).values({ id: write.artifactId, ownerId: actor.userId, headRevisionId: write.revisionId, createdAt, project: write.project, slug: write.slug })),
            statement(db.insert(artifactRevision).values({ id: write.revisionId, artifactId: write.artifactId, parentRevisionId: null, sequence: 1, ...author, sha256: digest, snapshot: text })),
            statement(db.insert(artifactSearch).values(searchRow(write.artifactId, write.snapshot))),
          ];
          return [
            statement(db.insert(artifactRevision).values({ id: write.revisionId, artifactId: write.artifactId, parentRevisionId: write.parentRevisionId, sequence: write.sequence, ...author, sha256: digest, snapshot: text })),
            statement(db.update(artifact).set({ headRevisionId: write.revisionId }).where(and(eq(artifact.id, write.artifactId), eq(artifact.ownerId, actor.userId), eq(artifact.headRevisionId, write.parentRevisionId)))),
            statement(db.delete(artifactSearch).where(eq(artifactSearch.artifactId, write.artifactId))),
            statement(db.insert(artifactSearch).values(searchRow(write.artifactId, write.snapshot))),
          ];
        });
        const placed = writes.flatMap((write) => write.op !== 'update' && write.project !== null ? [write.project] : []);
        if (placed.length) statements.push(spelled(actor.userId, [...new Set([...projects.map(({ name }) => name), ...placed])]));
        statements.push(statement(db.insert(artifactCommand).values({ ownerId: actor.userId, requestId: input.requestId, payloadHash, result: canonicalJson({ results }), createdAt })));
        try {
          await db.$client.batch(statements, 'write');
          return { results };
        } catch (error) {
          if (isConstraint(error) && conflicts++ < 2) continue;
          if (isBusy(error) && busy < 5) {
            await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** busy++));
            continue;
          }
          throw error;
        }
      }
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

    async share(actor: Actor, value: z.input<typeof shareSchema>): Promise<ShareResult> {
      const input = shareSchema.parse(value);
      const committed = await receipt(actor, 'artifacts:publish', 'share', input, shareCommandResultSchema, async (connection) => {
        await owned(connection, actor.userId, input.artifactId);
        let [row] = await connection.select().from(artifactShare).where(and(eq(artifactShare.artifactId, input.artifactId), eq(artifactShare.kind, 'email'), eq(artifactShare.value, input.email))).limit(1);
        if (row && input.requireNew) throw new ArtifactError('conflict', 'Access already exists', { reason: 'share_exists' });
        if (!row) {
          const [artifactCount] = await connection.select({ total: count() }).from(artifactShare).where(eq(artifactShare.artifactId, input.artifactId));
          if (artifactCount!.total >= 100) throw new ArtifactError('conflict', 'Artifact share limit reached', { reason: 'share_limit', scope: 'artifact', limit: 100 });
          const [ownerCount] = await connection.select({ total: count() }).from(artifactShare).innerJoin(artifact, eq(artifact.id, artifactShare.artifactId)).where(eq(artifact.ownerId, actor.userId));
          if (ownerCount!.total >= 1000) throw new ArtifactError('conflict', 'Owner share limit reached', { reason: 'share_limit', scope: 'owner', limit: 1000 });
          row = { id: crypto.randomUUID(), artifactId: input.artifactId, kind: 'email', value: input.email, createdBy: actor.userId, createdAt: new Date() };
          await connection.insert(artifactShare).values(row);
        }
        const result: ShareResult = shareOf(row);
        if (!input.notify) return result;
        if (!options.sendInvitation) return { ...result, notification: { status: 'skipped' as const, reason: 'disabled' as const } };
        const [clock] = await connection.select({ day: sql<string>`date('now')`, retryAt: sql<string>`strftime('%Y-%m-%dT00:00:00.000Z', 'now', '+1 day')` }).from(artifact).where(eq(artifact.id, input.artifactId));
        const [budget] = await connection.select().from(artifactInvitationBudget).where(eq(artifactInvitationBudget.ownerId, actor.userId));
        const used = budget?.day === clock!.day ? budget.used : 0;
        if (used >= 100) return { ...result, notification: { status: 'skipped' as const, reason: 'rate_limited' as const, retryAt: clock!.retryAt } };
        const values = { ownerId: actor.userId, day: clock!.day, used: used + 1 };
        if (budget) await connection.update(artifactInvitationBudget).set(values).where(eq(artifactInvitationBudget.ownerId, actor.userId));
        else await connection.insert(artifactInvitationBudget).values(values);
        return { ...result, notification: { status: 'requested' as const } };
      });
      if (committed.fresh && committed.result.notification?.status === 'requested') {
        const deadline = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            (async () => {
              const [current] = await db.select({ recipient: artifactShare.value, ownerName: user.name }).from(artifactShare)
                .innerJoin(artifact, and(eq(artifact.id, artifactShare.artifactId), eq(artifact.ownerId, actor.userId)))
                .innerJoin(user, eq(user.id, artifact.ownerId))
                .where(and(eq(artifactShare.id, committed.result.shareId), eq(artifactShare.artifactId, input.artifactId), eq(artifactShare.kind, 'email'), eq(artifactShare.value, input.email))).limit(1);
              deadline.signal.throwIfAborted();
              if (current) await options.sendInvitation!(invitation(current.recipient, current.ownerName, urlFor(input.artifactId)));
            })(),
            new Promise<never>((_, reject) => { timer = setTimeout(() => { deadline.abort(); reject(new Error('Invitation attempt timed out')); }, 10_000); }),
          ]);
        } catch { console.error('Artifact invitation attempt failed'); }
        finally { clearTimeout(timer); }
      }
      return committed.result;
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
        const named = or(sql`json_extract(${artifactCommand.result}, '$.artifactId') = ${input.artifactId}`, sql`exists (select 1 from json_each(${artifactCommand.result}, '$.results') where json_extract(value, '$.artifactId') = ${input.artifactId})`);
        const matching = and(eq(artifactCommand.ownerId, actor.userId), named);
        await connection.update(artifactCommand).set({ payloadHash: '', result: canonicalJson({ kind: 'artifact_deleted', artifactId: input.artifactId }) }).where(matching);
        const removed = await connection.delete(artifact).where(and(eq(artifact.id, input.artifactId), eq(artifact.ownerId, actor.userId))).returning({ artifactId: artifact.id });
        if (removed.length !== 1) throw new ArtifactError('not_found', 'Artifact not found');
        return { artifactId: input.artifactId };
      });
    },

    async move(actor: Actor, value: z.input<typeof moveSchema>): Promise<MoveResult> {
      const input = moveSchema.parse(value);
      return command(actor, 'artifacts:write', 'move', input, moveResultSchema, async (connection) => {
        const current = await owned(connection, actor.userId, input.artifactId);
        const project = input.project === undefined ? current.project : input.project === null ? null : await projectSpelling(connection, actor.userId, input.project);
        const slug = input.slug === undefined ? current.slug : input.slug;
        await claimSlug(connection, actor.userId, project, slug, current.id);
        await connection.update(artifact).set({ project, slug }).where(and(eq(artifact.id, input.artifactId), eq(artifact.ownerId, actor.userId)));
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

    async search(actor: Actor, value: z.input<typeof searchSchema>): Promise<SearchResult> {
      const input = searchSchema.parse(value);
      const offset = Number(input.cursor ?? 0);
      return transaction(async (connection) => {
        await authorize(connection, actor, 'artifacts:read');
        const project = input.project === undefined ? undefined : eq(artifact.project, await projectSpelling(connection, actor.userId, input.project));
        const rank = sql<number>`bm25(${artifactSearch})`.mapWith(Number);
        const rows = await connection.select({ artifactId: artifact.id, project: artifact.project, slug: artifact.slug, title: artifactSearch.title, snippet: sql<string>`snippet(${artifactSearch}, -1, '**', '**', '…', 16)`.mapWith(String), rank }).from(artifactSearch)
          .innerJoin(artifact, eq(artifact.id, artifactSearch.artifactId))
          .where(and(sql`${artifactSearch} MATCH ${matchExpression(input.query)}`, eq(artifact.ownerId, actor.userId), project))
          .orderBy(rank, asc(artifact.id)).limit(input.limit + 1).offset(offset);
        return { items: rows.slice(0, input.limit), nextCursor: rows.length > input.limit ? String(offset + input.limit) : null };
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
      const extension = { html: 'html', markdown: 'md', text: 'txt', design: 'json' }[snapshot.content.kind];
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
        if (!found || !await admission.user(found.grant.userId, connection) || !await canView(connection, found.grant.userId, input.artifactId)) throw new ArtifactError('invalid_grant', 'Publication grant is invalid or expired');
        const consumed = await connection.delete(publicationGrant).where(eq(publicationGrant.codeHash, codeHash)).returning({ codeHash: publicationGrant.codeHash });
        if (consumed.length !== 1) throw new ArtifactError('invalid_grant', 'Publication grant was already consumed');
        return { artifactId: input.artifactId, userId: found.grant.userId, sessionId: found.grant.sessionId, expiresAt: Math.min(Date.now() + 60 * 60_000, found.session.expiresAt.getTime()) };
      });
    },

    async readPublished(viewerValue: Viewer, value: z.input<typeof readByIdSchema>): Promise<ArtifactRead | SharedRead> {
      const viewer = viewerSchema.parse(viewerValue);
      const input = readByIdSchema.parse(value);
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
