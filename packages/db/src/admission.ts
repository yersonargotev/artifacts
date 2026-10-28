import { and, eq } from 'drizzle-orm';
import type { AccessPolicy } from '@artifacts/config';
import type { Database } from './index.ts';
import { artifact, artifactShare, user } from './schema.ts';

type Connection = Pick<Database, 'select'>;

export function createAdmission(db: Database, policy: AccessPolicy) {
  async function email(value: string, connection: Connection = db): Promise<boolean> {
    const address = value.trim().toLowerCase();
    if (address === policy.ownerEmail) return true;
    if (!policy.allowGuests) return false;
    const shared = await connection.select({ id: artifactShare.id }).from(artifactShare)
      .where(and(eq(artifactShare.kind, 'email'), eq(artifactShare.value, address))).limit(1);
    if (shared.length) return true;
    const owned = await connection.select({ id: artifact.id }).from(artifact)
      .innerJoin(user, eq(artifact.ownerId, user.id)).where(eq(user.email, address)).limit(1);
    return owned.length > 0;
  }
  return {
    email,
    async user(userId: string, connection: Connection = db): Promise<boolean> {
      const found = await connection.select({ email: user.email }).from(user).where(eq(user.id, userId)).get();
      return Boolean(found && await email(found.email, connection));
    },
  };
}
