import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient as createWebClient } from '@libsql/client/web';
import { eq, inArray } from 'drizzle-orm';
import { openDatabase } from '../packages/db/src/index.ts';
import { migrateDatabase } from '../packages/db/src/migrate.ts';
import { panelSession, session, user } from '../packages/db/src/schema.ts';
import { revokeUserIdentity } from '../apps/auth/src/revocation.ts';

process.loadEnvFile('.env.turso');
const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
assert(url && ['libsql:', 'https:'].includes(new URL(url).protocol), 'A remote DATABASE_URL is required');
assert(authToken, 'DATABASE_AUTH_TOKEN is required');

await migrateDatabase(url, authToken);
await migrateDatabase(url, authToken);
console.log('PASS: remote migrations apply repeatedly.');

const { db, client } = await openDatabase({ url, authToken });
const web = createWebClient({ url, authToken });
const ownerId = `turso-proof-${randomUUID()}`;
const rollbackId = `${ownerId}-rollback`;
const centralId = `${ownerId}-central`;
const tokenHash = `${ownerId}-panel`;
const rollback = new Error('Intentional transaction rollback');
const expiresAt = new Date(Date.now() + 60_000);
const panel = {
  tokenHash, authSessionId: centralId, issuer: 'https://auth.example.test/api/auth',
  subject: ownerId, clientId: 'turso-proof', scopes: ['openid'], expiresAt,
};

try {
  assert.equal(Number((await web.execute('PRAGMA foreign_keys')).rows[0]?.foreign_keys), 1);
  await assert.rejects(db.transaction(async (tx) => {
    await tx.insert(user).values({ id: rollbackId, name: 'Turso proof', email: `${rollbackId}@example.test` });
    throw rollback;
  }), (error: unknown) => error === rollback);
  assert.deepEqual(await db.select().from(user).where(eq(user.id, rollbackId)), []);
  assert.equal((await web.execute({ sql: 'SELECT id FROM user WHERE id = ?', args: [rollbackId] })).rows.length, 0);
  console.log('PASS: transaction rollback leaves no rows through Node or web clients.');

  await db.transaction(async (tx) => {
    await tx.insert(user).values({ id: ownerId, name: 'Turso proof', email: `${ownerId}@example.test` });
    await tx.insert(session).values({ id: centralId, userId: ownerId, token: `${ownerId}-opaque`, expiresAt, updatedAt: new Date() });
    await tx.insert(panelSession).values(panel);
  });
  assert.equal((await web.execute({ sql: 'SELECT token_hash FROM panel_session WHERE token_hash = ?', args: [tokenHash] })).rows.length, 1);
  console.log('PASS: committed identity and panel sessions are visible to the web client.');

  await revokeUserIdentity(db, ownerId);
  assert.deepEqual(await db.select().from(session).where(eq(session.id, centralId)), []);
  assert.deepEqual(await db.select().from(panelSession).where(eq(panelSession.tokenHash, tokenHash)), []);
  assert.equal((await web.execute({ sql: 'SELECT token_hash FROM panel_session WHERE token_hash = ?', args: [tokenHash] })).rows.length, 0);
  await assert.rejects(db.insert(panelSession).values(panel), (error: unknown) => {
    if (!(error instanceof Error)) return false;
    return /FOREIGN KEY/i.test(`${error.message} ${error.cause instanceof Error ? error.cause.message : ''}`);
  });
  console.log('PASS: application revocation cascades and dangling panel sessions are rejected.');
} finally {
  try {
    await db.delete(user).where(inArray(user.id, [ownerId, rollbackId]));
    assert.equal((await web.execute({ sql: 'SELECT id FROM user WHERE id IN (?, ?)', args: [ownerId, rollbackId] })).rows.length, 0);
  } finally {
    web.close();
    client.close();
  }
}
console.log('PASS: proof identities cleaned up; remote libSQL database boundary verified.');
