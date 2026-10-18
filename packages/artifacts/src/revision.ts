import type { artifactRevision } from '@artifacts/db/schema';
import { snapshotSchema, type Revision } from './contracts.ts';

export function revision(row: typeof artifactRevision.$inferSelect): Revision {
  return { id: row.id, parentRevisionId: row.parentRevisionId, sequence: row.sequence, authorUserId: row.authorUserId, authorClientId: row.authorClientId, createdAt: row.createdAt.toISOString(), sha256: row.sha256, snapshot: snapshotSchema.parse(JSON.parse(row.snapshot)) };
}
