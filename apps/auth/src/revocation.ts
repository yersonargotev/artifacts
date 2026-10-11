import { eq } from 'drizzle-orm';
import type { Database } from '@artifacts/db';
import { oauthAccessToken, oauthConsent, oauthRefreshToken, session } from '@artifacts/db/schema';

export async function revokeUserIdentity(db: Database, userId: string) {
  await db.delete(session).where(eq(session.userId, userId));
  try {
    await db.transaction(async (tx) => {
      await tx.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, userId));
      await tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, userId));
      await tx.delete(oauthConsent).where(eq(oauthConsent.userId, userId));
    });
  } catch {
    console.error('Central sessions revoked; OAuth grant cleanup could not complete');
  }
}
