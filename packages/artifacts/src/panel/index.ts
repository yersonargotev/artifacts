import { and, count, desc, eq, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import type { Database } from '@artifacts/db';
import { artifact, artifactPublication, artifactRevision, oauthClient } from '@artifacts/db/schema';
import { ArtifactError, historySchema, projectNameSchema, readSchema, type Actor } from '../contracts.ts';
import { createAccess, projectOrder, type Connection } from '../access.ts';
import { libraryPageSize, libraryStatuses, projectKey, type ArtifactCard, type ArtifactDetail, type DetailSnapshot, type RevisionRef, type ContentKind, type LibraryScope, type LibrarySnapshot, type ProjectName, type ScopeRequest, type Tally, type Workspace } from './model.ts';

import { revision } from '../revision.ts';
import { compareRevisions } from '../workflow.ts';

const cursorSchema = z.string().max(160).regex(/^(0|[1-9]\d{0,15}):[a-zA-Z0-9_-]{1,128}$/).refine((value) => {
  const ms = Number(value.split(':')[0]);
  return Number.isSafeInteger(ms) && ms <= 8_640_000_000_000_000;
});
export const panelLibraryQuerySchema = z.strictObject({
  scope: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('all') }), z.strictObject({ kind: z.literal('project'), name: projectNameSchema }), z.strictObject({ kind: z.literal('unfiled') })]).default({ kind: 'all' }),
  status: z.enum(libraryStatuses).default('all'),
  q: z.string().trim().max(256).default(''),
  cursor: cursorSchema.optional(),
});

export const panelDetailQuerySchema = z.strictObject({
  artifactId: readSchema.shape.artifactId,
  revisionId: readSchema.shape.revisionId,
  compareTo: readSchema.shape.revisionId,
  before: historySchema.shape.beforeSequence,
  includeComparison: z.boolean(),
});

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

export function createPanel(db: Database, options: { publishOrigin: string }) {
  const access = createAccess(db, options);
  return {
    async artifact(actor: Actor, value: z.input<typeof panelDetailQuerySchema>): Promise<DetailSnapshot> {
      const input = panelDetailQuerySchema.parse(value);
      return access.transaction(async (connection) => {
        await access.authorize(connection, actor, 'artifacts:read');
        const [owned] = await connection.select({
          artifactId: artifact.id, project: artifact.project, createdAt: artifact.createdAt,
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
        return { workspace: await readWorkspace(connection, actor.userId), detail: {
          artifactId: owned.artifactId, project: owned.project as ProjectName | null, createdAt: owned.createdAt,
          selected: { revision: selectedRevision, author: { clientId: selectedRevision.authorClientId, name: selected.name } },
          head: owned.head, publication: owned.publication && owned.published ? { revision: owned.published, version: owned.publication.version, url: access.publicationUrl(owned.artifactId) } : null,
          history: { entries, before: input.before ?? null, olderBefore: history.length > 5 ? entries.at(-1)!.sequence : null },
          choices: [...choices.values()].sort((left, right) => right.sequence - left.sequence), compared: compared ?? null, comparison,
        } };
      });
    },
    async library(actor: Actor, value: z.input<typeof panelLibraryQuerySchema> = {}): Promise<LibrarySnapshot> {
      const input = panelLibraryQuerySchema.parse(value);
      return access.transaction(async (connection) => {
        await access.authorize(connection, actor, 'artifacts:read');
        const workspace = await readWorkspace(connection, actor.userId);
        const scope = resolveScope(workspace, input.scope);
        if (scope.kind === 'vanishedProject') return { workspace, page: { scope, status: input.status, q: input.q, cards: [], counts: { all: 0, published: 0, unpublished: 0, pending: 0 }, next: null, continued: Boolean(input.cursor) } };
        const matching = and(eq(artifact.ownerId, actor.userId), scope.kind === 'project' ? eq(artifact.project, scope.project.name) : scope.kind === 'unfiled' ? isNull(artifact.project) : undefined,
          input.q ? or(sql`instr(lower(${title}), lower(${input.q})) > 0`, sql`instr(lower(${artifact.id}), lower(${input.q})) > 0`) : undefined);
        const statuses = {
          all: undefined,
          published: eq(artifactPublication.revisionId, artifact.headRevisionId),
          unpublished: isNull(artifactPublication.artifactId),
          pending: and(isNotNull(artifactPublication.artifactId), ne(artifactPublication.revisionId, artifact.headRevisionId)),
        };
        const [ms, cursorId] = input.cursor?.split(':') ?? [];
        const before = ms === undefined ? undefined : or(lt(artifactRevision.createdAt, new Date(Number(ms))), and(eq(artifactRevision.createdAt, new Date(Number(ms))), lt(artifact.id, cursorId)));
        const rows = await connection.select({
          artifactId: artifact.id, title, description: sql<string>`json_extract(${artifactRevision.snapshot}, '$.metadata.description')`.mapWith(String),
          kind: sql<ContentKind>`json_extract(${artifactRevision.snapshot}, '$.content.kind')`, project: artifact.project,
          head: { revisionId: artifactRevision.id, sequence: artifactRevision.sequence, createdAt: artifactRevision.createdAt },
          publication: { version: artifactPublication.version, revisionId: artifactPublication.revisionId },
          published: { revisionId: publishedRevision.id, sequence: publishedRevision.sequence, createdAt: publishedRevision.createdAt },
        }).from(artifact).innerJoin(artifactRevision, headJoin).leftJoin(artifactPublication, publicationJoin)
          .leftJoin(publishedRevision, and(eq(publishedRevision.artifactId, artifact.id), eq(publishedRevision.id, artifactPublication.revisionId)))
          .where(and(matching, statuses[input.status], before)).orderBy(desc(artifactRevision.createdAt), desc(artifact.id)).limit(libraryPageSize + 1);
        const [counts] = await connection.select(tally).from(artifact).innerJoin(artifactRevision, headJoin).leftJoin(artifactPublication, publicationJoin).where(matching);
        const cards: ArtifactCard[] = rows.slice(0, libraryPageSize).map(({ publication, published, project, ...row }) => ({
          ...row, project: project as ProjectName | null,
          publication: publication ? { state: publication.revisionId === row.head.revisionId ? 'published' : 'pending', url: access.publicationUrl(row.artifactId), version: publication.version, revision: published! } : { state: 'unpublished' },
        }));
        const last = cards.at(-1);
        return { workspace, page: { scope, status: input.status, q: input.q, counts: { all: counts.count, published: counts.published - counts.pending, unpublished: counts.count - counts.published, pending: counts.pending }, cards,
          next: rows.length > libraryPageSize && last ? `${last.head.createdAt.getTime()}:${last.artifactId}` : null, continued: Boolean(input.cursor) } };
      });
    },
  };
}

export type Panel = ReturnType<typeof createPanel>;
