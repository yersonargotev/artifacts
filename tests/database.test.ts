import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { openDatabase } from '../packages/db/src/index.ts';
import { migrateDatabase } from '../packages/db/src/migrate.ts';
import { panelSession, session, user } from '../packages/db/src/schema.ts';

test('migrations are repeatable and central-session deletion cascades to panel sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-db-'));
  const url = `file:${join(directory, 'identity.db')}`;
  await migrateDatabase(url);
  await migrateDatabase(url);
  const { db, client } = await openDatabase({ url });
  try {
    const now = new Date();
    const expiresAt = new Date(Date.now() + 60_000);
    await db.insert(user).values({ id: 'owner', name: 'Owner', email: 'owner@example.test' });
    await db.insert(session).values({ id: 'central', userId: 'owner', token: 'opaque', expiresAt, updatedAt: now });
    const panel = { tokenHash: 'hash', authSessionId: 'central', issuer: 'http://localhost:4100/api/auth', subject: 'owner', clientId: 'panel', scopes: ['openid'], expiresAt };
    await db.insert(panelSession).values(panel);
    await db.delete(session).where(eq(session.id, 'central'));
    assert.deepEqual(await db.select().from(panelSession), []);
    await assert.rejects(db.insert(panelSession).values(panel), (error: Error) => error.cause instanceof Error && /FOREIGN KEY/.test(error.cause.message));
  } finally {
    client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
