import { and, count, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@artifacts/db';
import { artifact, artifactCommand, session } from '@artifacts/db/schema';
import { ArtifactError, type Actor, type ProjectSummary } from './contracts.ts';
import { canonicalJson, sha256 } from './serialization.ts';
import { projectKey, type PanelMoveInput, type PanelMoveResult } from './panel/model.ts';

export type Connection = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;
const deletedReceiptSchema = z.strictObject({ kind: z.literal('artifact_deleted'), artifactId: z.string().min(1).max(128) });

export const projectOrder = (left: string, right: string) => left.localeCompare(right, 'en') || (left < right ? -1 : 1);

function isBusy(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return ('code' in error && typeof error.code === 'string' && /SQLITE_BUSY|SQLITE_LOCKED/.test(error.code)) || isBusy(error.cause);
}

export function createAccess(db: Database, options: { publishOrigin: string }) {
  const origin = new URL(options.publishOrigin).origin;

  async function liveSession(connection: Connection, userId: string, sessionId: string) {
    const [found] = await connection.select().from(session).where(and(eq(session.id, sessionId), eq(session.userId, userId), gt(session.expiresAt, new Date()))).limit(1);
    if (!found) throw new ArtifactError('forbidden', 'A live owner session is required');
    return found;
  }

  async function authorize(connection: Connection, actor: Actor, scope: string) {
    if (!actor.scopes.includes(scope)) throw new ArtifactError('forbidden', `The ${scope} scope is required`, { requiredScope: scope });
    return liveSession(connection, actor.userId, actor.sessionId);
  }

  async function ownedProjects(connection: Connection, ownerId: string): Promise<ProjectSummary[]> {
    const rows = await connection.select({ name: sql<string>`${artifact.project}`, artifactCount: count() }).from(artifact).where(and(eq(artifact.ownerId, ownerId), isNotNull(artifact.project))).groupBy(artifact.project);
    return rows.sort((left, right) => projectOrder(left.name, right.name));
  }

  async function projectSpelling(connection: Connection, ownerId: string, name: string): Promise<string> {
    const key = projectKey(name);
    return (await ownedProjects(connection, ownerId)).find((project) => projectKey(project.name) === key)?.name ?? name;
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

  async function receipt<T>(actor: Actor, scope: string, kind: string, input: { requestId: string }, output: z.ZodType<T>, work: (connection: Connection) => Promise<T>): Promise<{ result: T; fresh: boolean }> {
    const payloadHash = await sha256(canonicalJson({ kind, input }));
    return transaction(async (connection) => {
      await authorize(connection, actor, scope);
      const [receipt] = await connection.select().from(artifactCommand).where(and(eq(artifactCommand.ownerId, actor.userId), eq(artifactCommand.requestId, input.requestId))).limit(1);
      if (receipt) {
        const result: unknown = JSON.parse(receipt.result);
        if (deletedReceiptSchema.safeParse(result).success) throw new ArtifactError('not_found', 'Artifact deleted');
        if (receipt.payloadHash !== payloadHash) throw new ArtifactError('request_conflict', 'Request ID already used with different arguments');
        return { result: output.parse(result), fresh: false };
      }
      const result = await work(connection);
      await connection.insert(artifactCommand).values({ ownerId: actor.userId, requestId: input.requestId, payloadHash, result: canonicalJson(result), createdAt: new Date() });
      return { result, fresh: true };
    });
  }

  function command<T extends { artifactId: string }>(actor: Actor, scope: string, kind: string, input: { requestId: string }, output: z.ZodType<T>, work: (connection: Connection) => Promise<T>): Promise<T> {
    return receipt(actor, scope, kind, input, output, work).then(({ result }) => result);
  }

  function panelMove(actor: Actor, input: PanelMoveInput, output: z.ZodType<PanelMoveResult>, work: (connection: Connection) => Promise<PanelMoveResult>): Promise<PanelMoveResult> {
    return receipt(actor, 'artifacts:write', 'panel_move', input, output, work).then(({ result }) => result);
  }

  return { transaction, authorize, liveSession, command, receipt, panelMove, projectSpelling, ownedProjects, callback: `${origin}/callback`, publicationUrl: (artifactId: string) => `${origin}/a/${encodeURIComponent(artifactId)}` };
}
