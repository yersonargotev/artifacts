import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import type { AccessPolicy } from '@artifacts/config';
import type { Database } from '@artifacts/db';
import { artifact, artifactPublication, artifactRevision, oauthClient } from '@artifacts/db/schema';
import { ArtifactError, exportSchema, historySchema, moveSchema, projectNameSchema, readByIdSchema, type Actor, type Revision } from '../contracts.ts';
import { createAccess, projectOrder, type Connection } from '../access.ts';
import { defaultDirections, libraryPageSize, librarySorts, libraryStatuses, projectKey, type LibrarySort, type ArtifactCard, type ArtifactDetail, type DetailSnapshot, type RevisionRef, type ContentKind, type LibraryScope, type LibrarySnapshot, type ProjectName, type ProjectsSnapshot, type RecentArtifact, type ScopeRequest, type Tally, type Workspace, type PanelMoveInput, type PanelMoveResult, type MoveSubject, type SlugConflict, type PageLink, type PreviewSnapshot } from './model.ts';
import { pageLinks } from './links.ts';
import { revision } from '../revision.ts';
import { compareRevisions } from '../workflow.ts';

// A cursor is `<ms>:<id>` for the default order, and `<key>.<ms>:<id>` when another column sorts the list.
// The key is the sort value of the last card: base64url UTF-8 for a title, an integer for a state rank or revision.
const cursorPattern = /^(?:([A-Za-z0-9_-]{1,1400})\.)?(0|[1-9]\d{0,15}):([a-zA-Z0-9_-]{1,128})$/;
const cursorSchema = z.string().max(1600).regex(cursorPattern).refine((value) => {
  const match = cursorPattern.exec(value);
  const ms = Number(match?.[2]);
  return Boolean(match) && Number.isSafeInteger(ms) && ms <= 8_640_000_000_000_000;
});
const encodeTitle = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
function decodeTitle(value: string): string | undefined {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0))); }
  catch { return undefined; }
}
function cursorKey(sort: LibrarySort, key: string | undefined): string | number | undefined {
  if (key === undefined) return undefined;
  if (sort === 'title') return decodeTitle(key);
  if (sort === 'state') return /^[0-2]$/.test(key) ? Number(key) : undefined;
  if (sort === 'revision') return /^[1-9]\d{0,8}$/.test(key) ? Number(key) : undefined;
  return undefined;
}
export const panelLibraryQuerySchema = z.strictObject({
  scope: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('all') }), z.strictObject({ kind: z.literal('project'), name: projectNameSchema }), z.strictObject({ kind: z.literal('unfiled') })]).default({ kind: 'all' }),
  status: z.enum(libraryStatuses).default('all'),
  q: z.string().trim().max(256).default(''),
  sort: z.enum(librarySorts).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
  cursor: cursorSchema.optional(),
}).superRefine(({ sort = 'updated', cursor }, context) => {
  if (cursor === undefined) return;
  const key = cursorPattern.exec(cursor)?.[1];
  if (sort === 'updated' ? key !== undefined : cursorKey(sort, key) === undefined) context.addIssue({ code: 'custom', path: ['cursor'], message: 'Cursor does not match the sort order' });
});

export const panelDetailQuerySchema = z.strictObject({
  artifactId: readByIdSchema.shape.artifactId,
  revisionId: readByIdSchema.shape.revisionId,
  compareTo: readByIdSchema.shape.revisionId,
  before: historySchema.shape.beforeSequence,
  includeComparison: z.boolean(),
});

export const panelMoveIdsSchema = z.array(readByIdSchema.shape.artifactId).min(1).transform((ids) => [...new Set(ids)].sort()).pipe(z.array(readByIdSchema.shape.artifactId).max(25));
export const panelMoveSchema = z.strictObject({ requestId: moveSchema.shape.requestId, artifactIds: panelMoveIdsSchema, project: projectNameSchema.nullable() });
export const panelSlugConflictSchema = z.strictObject({ project: z.string().nullable(), conflicts: z.array(z.strictObject({ artifactId: readByIdSchema.shape.artifactId, slug: z.string() })).min(1) });
const panelMoveResultSchema = z.strictObject({ project: z.string().nullable(), moved: z.number().int().nonnegative(), unchanged: z.number().int().nonnegative(), missing: z.array(readByIdSchema.shape.artifactId) });

const publishedRevision = alias(artifactRevision, 'published_revision');
const headJoin = and(eq(artifactRevision.artifactId, artifact.id), eq(artifactRevision.id, artifact.headRevisionId));
const publicationJoin = eq(artifactPublication.artifactId, artifact.id);
const title = sql<string>`json_extract(${artifactRevision.snapshot}, '$.metadata.title')`.mapWith(String);
const tally = {
  count: count(),
  published: sql<number>`coalesce(sum(case when ${artifactPublication.artifactId} is not null then 1 else 0 end), 0)`.mapWith(Number),
  pending: sql<number>`coalesce(sum(case when ${artifactPublication.artifactId} is not null and ${artifactPublication.revisionId} != ${artifact.headRevisionId} then 1 else 0 end), 0)`.mapWith(Number),
};
const zeroTally = (): Tally => ({ count: 0, published: 0, pending: 0 });
// Pending sorts first, then unpublished, then published.
const stateRank = sql<number>`case when ${artifactPublication.artifactId} is null then 1 when ${artifactPublication.revisionId} != ${artifact.headRevisionId} then 0 else 2 end`;
const sortColumns = { title: sql`${title} collate nocase`, state: stateRank, revision: sql`${artifactRevision.sequence}` } as const;
const stateRanks = { pending: 0, unpublished: 1, published: 2 } as const;

function resolveScope(workspace: Workspace, request: ScopeRequest): LibraryScope {
  if (request.kind === 'all') return request;
  if (request.kind === 'unfiled') return { kind: 'unfiled', tally: workspace.unfiled };
  const project = workspace.projects.find(({ name }) => projectKey(name) === projectKey(request.name));
  return project ? { kind: 'project', project } : { kind: 'vanishedProject', name: request.name };
}

async function readWorkspace(connection: Connection, ownerId: string): Promise<Workspace> {
  const groups = await connection.select({ name: artifact.project, ...tally, updatedAt: sql<number>`max(${artifactRevision.createdAt})`.mapWith(Number) }).from(artifact)
    .innerJoin(artifactRevision, headJoin).leftJoin(artifactPublication, publicationJoin)
    .where(eq(artifact.ownerId, ownerId)).groupBy(artifact.project);
  const unfiled = groups.find(({ name }) => name === null);
  const workspace: Workspace = {
    total: groups.reduce((total, group) => ({ count: total.count + group.count, published: total.published + group.published, pending: total.pending + group.pending }), zeroTally()),
    unfiled: unfiled ? { count: unfiled.count, published: unfiled.published, pending: unfiled.pending } : zeroTally(),
    projects: groups.flatMap(({ name, updatedAt, ...counts }) => name === null ? [] : [{ name: name as ProjectName, updatedAt: new Date(updatedAt), ...counts }]).sort((left, right) => projectOrder(left.name, right.name)),
  };
  return workspace;
}

async function resolveLinks(connection: Connection, ownerId: string, page: { project: string | null; slug: string | null }, selected: Revision): Promise<PageLink[] | null> {
  if (selected.snapshot.content.kind !== 'markdown') return null;
  const candidates = pageLinks(selected.snapshot.content.text, page.slug);
  const slugs = [...new Set(candidates.flatMap(({ candidate }) => candidate.kind === 'slug' ? [candidate.slug] : []))];
  const targets = slugs.length === 0 ? [] : await connection.select({ artifactId: artifact.id, slug: artifact.slug, title }).from(artifact).innerJoin(artifactRevision, headJoin)
    .where(and(eq(artifact.ownerId, ownerId), page.project === null ? isNull(artifact.project) : eq(artifact.project, page.project), inArray(artifact.slug, slugs)));
  const bySlug = new Map(targets.map((target) => [target.slug, target]));
  return candidates.map(({ href, text, candidate }) => {
    if (candidate.kind === 'broken') return { href, text, target: { state: 'broken', reason: candidate.reason } };
    const found = bySlug.get(candidate.slug);
    return { href, text, target: found ? { state: 'resolved', artifactId: found.artifactId, slug: candidate.slug, title: found.title } : { state: 'broken', reason: 'missing' } };
  });
}

export function createPanel(db: Database, options: { publishOrigin: string; access: AccessPolicy }) {
  const access = createAccess(db, options);
  return {
    async move(actor: Actor, value: PanelMoveInput): Promise<PanelMoveResult> {
      const input = panelMoveSchema.parse(value);
      return access.panelMove(actor, input, panelMoveResultSchema, async (connection) => {
        const project = input.project === null ? null : await access.projectSpelling(connection, actor.userId, input.project);
        const found = await connection.select({ id: artifact.id, project: artifact.project, slug: artifact.slug }).from(artifact)
          .where(and(eq(artifact.ownerId, actor.userId), inArray(artifact.id, input.artifactIds)));
        const moving = found.filter((row) => row.project !== project);
        const changing = moving.map((row) => row.id);
        const conflicts: SlugConflict[] = [];
        for (const row of moving) {
          if (row.slug === null) continue;
          const shared = moving.some((other) => other.id !== row.id && other.slug === row.slug);
          if (shared || await access.bySlug(connection, actor.userId, project, row.slug)) conflicts.push({ artifactId: row.id, slug: row.slug });
        }
        if (conflicts.length) throw new ArtifactError('slug_conflict', 'Moved artifacts would reuse slugs in the destination', { project, conflicts: conflicts.sort((left, right) => left.artifactId.localeCompare(right.artifactId)) });
        if (changing.length) await connection.update(artifact).set({ project }).where(and(eq(artifact.ownerId, actor.userId), inArray(artifact.id, changing)));
        const owned = new Set(found.map((row) => row.id));
        return { project, moved: changing.length, unchanged: found.length - changing.length, missing: input.artifactIds.filter((id) => !owned.has(id)) };
      });
    },
    async moveSubject(actor: Actor, value: readonly string[]): Promise<MoveSubject> {
      const ids = panelMoveIdsSchema.parse(value);
      return access.transaction(async (connection) => {
        await access.authorize(connection, actor, 'artifacts:read');
        const items = await connection.select({ artifactId: artifact.id, title, project: artifact.project }).from(artifact).innerJoin(artifactRevision, headJoin)
          .where(and(eq(artifact.ownerId, actor.userId), inArray(artifact.id, ids))).orderBy(artifact.id);
        return { workspace: await readWorkspace(connection, actor.userId), items: items.map((item) => ({ ...item, project: item.project as ProjectName | null })) };
      });
    },
    async projectsIndex(actor: Actor): Promise<ProjectsSnapshot> {
      return access.transaction(async (connection) => {
        await access.authorize(connection, actor, 'artifacts:read');
        const workspace = await readWorkspace(connection, actor.userId);
        const ranked = connection.select({ artifactId: artifact.id, project: artifact.project, title: title.as('title'), createdAt: artifactRevision.createdAt,
          rank: sql<number>`row_number() over (partition by ${artifact.project} order by ${artifactRevision.createdAt} desc, ${artifact.id} desc)`.as('rank'),
        }).from(artifact).innerJoin(artifactRevision, headJoin).where(eq(artifact.ownerId, actor.userId)).as('ranked');
        const rows = await connection.select({ artifactId: ranked.artifactId, project: ranked.project, title: ranked.title }).from(ranked)
          .where(sql`${ranked.rank} <= 3`).orderBy(desc(ranked.createdAt), desc(ranked.artifactId));
        const recent = new Map<string | null, RecentArtifact[]>();
        for (const { project, ...reference } of rows) {
          const group = recent.get(project) ?? [];
          group.push(reference);
          recent.set(project, group);
        }
        return { workspace, overview: {
          projects: [...workspace.projects].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || projectOrder(left.name, right.name))
            .map((project) => ({ project, recent: recent.get(project.name) ?? [] })),
          unfiled: { tally: workspace.unfiled, recent: recent.get(null) ?? [] },
        } };
      });
    },
    async artifact(actor: Actor, value: z.input<typeof panelDetailQuerySchema>): Promise<DetailSnapshot> {
      const input = panelDetailQuerySchema.parse(value);
      return access.transaction(async (connection) => {
        await access.authorize(connection, actor, 'artifacts:read');
        const [owned] = await connection.select({
          artifactId: artifact.id, project: artifact.project, slug: artifact.slug, createdAt: artifact.createdAt,
          head: { revisionId: artifactRevision.id, sequence: artifactRevision.sequence, createdAt: artifactRevision.createdAt },
          publication: { version: artifactPublication.version },
          published: { revisionId: publishedRevision.id, sequence: publishedRevision.sequence, createdAt: publishedRevision.createdAt },
        }).from(artifact).innerJoin(artifactRevision, headJoin).leftJoin(artifactPublication, publicationJoin)
          .leftJoin(publishedRevision, and(eq(publishedRevision.artifactId, artifact.id), eq(publishedRevision.id, artifactPublication.revisionId)))
          .where(and(eq(artifact.id, input.artifactId), eq(artifact.ownerId, actor.userId))).limit(1);
        if (!owned) throw new ArtifactError('not_found', 'Artifact not found');
        const [selected] = await connection.select({ row: artifactRevision, name: oauthClient.name }).from(artifactRevision)
          .leftJoin(oauthClient, eq(oauthClient.clientId, artifactRevision.authorClientId))
          .where(and(eq(artifactRevision.artifactId, owned.artifactId), eq(artifactRevision.id, input.revisionId ?? owned.head.revisionId))).limit(1);
        if (!selected) throw new ArtifactError('not_found', 'Revision not found');
        const selectedRevision = revision(selected.row);
        const history = await connection.select({ revisionId: artifactRevision.id, sequence: artifactRevision.sequence, createdAt: artifactRevision.createdAt,
          clientId: artifactRevision.authorClientId, name: oauthClient.name }).from(artifactRevision)
          .leftJoin(oauthClient, eq(oauthClient.clientId, artifactRevision.authorClientId))
          .where(and(eq(artifactRevision.artifactId, owned.artifactId), input.before === undefined ? undefined : lt(artifactRevision.sequence, input.before)))
          .orderBy(desc(artifactRevision.sequence)).limit(6);
        const entries = history.slice(0, 5).map(({ clientId, name, ...ref }) => ({ ...ref, author: { clientId, name } }));
        const selectedRef: RevisionRef = { revisionId: selectedRevision.id, sequence: selectedRevision.sequence, createdAt: selected.row.createdAt };
        const choices = new Map<string, RevisionRef>([...entries, owned.head, ...(owned.published ? [owned.published] : []), selectedRef].map((ref) => [ref.revisionId, ref]));
        const compareTo = [input.compareTo, owned.published?.revisionId, owned.head.revisionId, selectedRevision.parentRevisionId, entries.find((entry) => entry.revisionId !== selectedRevision.id)?.revisionId].find((id) => id && id !== selectedRevision.id);
        let compared = compareTo ? choices.get(compareTo) : undefined;
        if (compareTo && !compared) {
          [compared] = await connection.select({ revisionId: artifactRevision.id, sequence: artifactRevision.sequence, createdAt: artifactRevision.createdAt }).from(artifactRevision)
            .where(and(eq(artifactRevision.artifactId, owned.artifactId), eq(artifactRevision.id, compareTo))).limit(1);
          if (!compared) throw new ArtifactError('not_found', 'Revision not found');
          choices.set(compared.revisionId, compared);
        }
        let comparison: ArtifactDetail['comparison'] = null;
        if (input.includeComparison && compared) {
          const [row] = await connection.select().from(artifactRevision)
            .where(and(eq(artifactRevision.artifactId, owned.artifactId), eq(artifactRevision.id, compared.revisionId))).limit(1);
          comparison = await compareRevisions(revision(row!), selectedRevision);
        }
        const links = await resolveLinks(connection, actor.userId, owned, selectedRevision);
        return { workspace: await readWorkspace(connection, actor.userId), detail: {
          artifactId: owned.artifactId, project: owned.project as ProjectName | null, slug: owned.slug, createdAt: owned.createdAt,
          selected: { revision: selectedRevision, author: { clientId: selectedRevision.authorClientId, name: selected.name } },
          head: owned.head, publication: owned.publication && owned.published ? { revision: owned.published, version: owned.publication.version, url: access.publicationUrl(owned.artifactId) } : null,
          history: { entries, before: input.before ?? null, olderBefore: history.length > 5 ? entries.at(-1)!.sequence : null },
          choices: [...choices.values()].sort((left, right) => right.sequence - left.sequence), compared: compared ?? null, comparison, links,
        } };
      });
    },
    async preview(actor: Actor, value: z.input<typeof exportSchema>): Promise<PreviewSnapshot> {
      const input = exportSchema.parse(value);
      return access.transaction(async (connection) => {
        await access.authorize(connection, actor, 'artifacts:read');
        const [found] = await connection.select({ project: artifact.project, slug: artifact.slug, row: artifactRevision }).from(artifactRevision)
          .innerJoin(artifact, eq(artifact.id, artifactRevision.artifactId))
          .where(and(eq(artifact.id, input.artifactId), eq(artifact.ownerId, actor.userId), eq(artifactRevision.id, input.revisionId))).limit(1);
        if (!found) throw new ArtifactError('not_found', 'Revision not found');
        const selected = revision(found.row);
        return { artifactId: input.artifactId, revision: selected, links: await resolveLinks(connection, actor.userId, found, selected) };
      });
    },
    async library(actor: Actor, value: z.input<typeof panelLibraryQuerySchema> = {}): Promise<LibrarySnapshot> {
      const input = panelLibraryQuerySchema.parse(value);
      return access.transaction(async (connection) => {
        await access.authorize(connection, actor, 'artifacts:read');
        const workspace = await readWorkspace(connection, actor.userId);
        const scope = resolveScope(workspace, input.scope);
        if (scope.kind === 'vanishedProject') return { workspace, page: { scope, status: input.status, q: input.q, sort: input.sort ?? 'updated', direction: input.direction ?? defaultDirections[input.sort ?? 'updated'], cards: [], counts: { all: 0, published: 0, unpublished: 0, pending: 0 }, next: null, continued: Boolean(input.cursor) } };
        const matching = and(eq(artifact.ownerId, actor.userId), scope.kind === 'project' ? eq(artifact.project, scope.project.name) : scope.kind === 'unfiled' ? isNull(artifact.project) : undefined,
          input.q ? or(sql`instr(lower(${title}), lower(${input.q})) > 0`, sql`instr(lower(${artifact.id}), lower(${input.q})) > 0`) : undefined);
        const statuses = {
          all: undefined,
          published: eq(artifactPublication.revisionId, artifact.headRevisionId),
          unpublished: isNull(artifactPublication.artifactId),
          pending: and(isNotNull(artifactPublication.artifactId), ne(artifactPublication.revisionId, artifact.headRevisionId)),
        };
        const { sort = 'updated' } = input;
        const direction = input.direction ?? defaultDirections[sort];
        const ordered: typeof asc = direction === 'asc' ? asc : desc;
        const beyond: typeof gt = direction === 'asc' ? gt : lt;
        const order = sort === 'updated' ? [ordered(artifactRevision.createdAt), ordered(artifact.id)] : [ordered(sortColumns[sort]), desc(artifactRevision.createdAt), desc(artifact.id)];
        const [, key, ms, cursorId] = input.cursor ? cursorPattern.exec(input.cursor)! : [];
        const at = ms === undefined ? undefined : new Date(Number(ms));
        const before = at === undefined ? undefined : sort === 'updated'
          ? or(beyond(artifactRevision.createdAt, at), and(eq(artifactRevision.createdAt, at), beyond(artifact.id, cursorId!)))
          : or(beyond(sortColumns[sort], cursorKey(sort, key)), and(eq(sortColumns[sort], cursorKey(sort, key)), or(lt(artifactRevision.createdAt, at), and(eq(artifactRevision.createdAt, at), lt(artifact.id, cursorId!)))));
        const rows = await connection.select({
          artifactId: artifact.id, title, description: sql<string>`json_extract(${artifactRevision.snapshot}, '$.metadata.description')`.mapWith(String),
          kind: sql<ContentKind>`json_extract(${artifactRevision.snapshot}, '$.content.kind')`, project: artifact.project, slug: artifact.slug,
          head: { revisionId: artifactRevision.id, sequence: artifactRevision.sequence, createdAt: artifactRevision.createdAt },
          publication: { version: artifactPublication.version, revisionId: artifactPublication.revisionId },
          published: { revisionId: publishedRevision.id, sequence: publishedRevision.sequence, createdAt: publishedRevision.createdAt },
        }).from(artifact).innerJoin(artifactRevision, headJoin).leftJoin(artifactPublication, publicationJoin)
          .leftJoin(publishedRevision, and(eq(publishedRevision.artifactId, artifact.id), eq(publishedRevision.id, artifactPublication.revisionId)))
          .where(and(matching, statuses[input.status], before)).orderBy(...order).limit(libraryPageSize + 1);
        const [counts] = await connection.select(tally).from(artifact).innerJoin(artifactRevision, headJoin).leftJoin(artifactPublication, publicationJoin).where(matching);
        const cards: ArtifactCard[] = rows.slice(0, libraryPageSize).map(({ publication, published, project, ...row }) => ({
          ...row, project: project as ProjectName | null,
          publication: publication ? { state: publication.revisionId === row.head.revisionId ? 'published' : 'pending', url: access.publicationUrl(row.artifactId), version: publication.version, revision: published! } : { state: 'unpublished' },
        }));
        const last = cards.at(-1);
        const lastKey = !last || sort === 'updated' ? '' : `${sort === 'title' ? encodeTitle(last.title) : sort === 'revision' ? last.head.sequence : stateRanks[last.publication.state]}.`;
        return { workspace, page: { scope, status: input.status, q: input.q, sort, direction, counts: { all: counts.count, published: counts.published - counts.pending, unpublished: counts.count - counts.published, pending: counts.pending }, cards,
          next: rows.length > libraryPageSize && last ? `${lastKey}${last.head.createdAt.getTime()}:${last.artifactId}` : null, continued: Boolean(input.cursor) } };
      });
    },
  };
}

export type Panel = ReturnType<typeof createPanel>;
