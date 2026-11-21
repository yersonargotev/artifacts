import type { artifactRevision } from '@artifacts/db/schema';
import { snapshotSchema, type Revision, type Snapshot } from '@yargote/artifacts-contracts';

export function revision(row: typeof artifactRevision.$inferSelect): Revision {
  return { id: row.id, parentRevisionId: row.parentRevisionId, sequence: row.sequence, authorUserId: row.authorUserId, authorClientId: row.authorClientId, createdAt: row.createdAt.toISOString(), sha256: row.sha256, snapshot: snapshotSchema.parse(JSON.parse(row.snapshot)) };
}

export const revisionMetadata = (snapshot: Snapshot) => ({ title: snapshot.metadata.title, description: snapshot.metadata.description, kind: snapshot.content.kind });
