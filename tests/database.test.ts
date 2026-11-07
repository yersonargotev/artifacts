import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { openDatabase } from '../packages/db/src/index.ts';
import { migrateDatabase } from '../packages/db/src/migrate.ts';
import { panelSession, session, user } from '../packages/db/src/schema.ts';
import { reindexSearch, type Snapshot } from '../packages/artifacts/src/index.ts';
import { designSnapshot } from './helpers.ts';

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

test('the search migration backfills Markdown and text heads, and an owner deletion cascades out of the index', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-db-'));
  const migrations = fileURLToPath(new URL('../packages/db/migrations', import.meta.url));
  const before = join(directory, 'migrations');
  await cp(migrations, before, { recursive: true });
  const journal = JSON.parse(await readFile(join(before, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { tag: string }) => entry.tag < '0006');
  await writeFile(join(before, 'meta/_journal.json'), JSON.stringify(journal));
  const url = `file:${join(directory, 'search.db')}`;
  const { db, client } = await openDatabase({ url });
  try {
    await migrate(db, { migrationsFolder: before });
    await client.execute("INSERT INTO user (id, name, email) VALUES ('owner', 'Owner', 'owner@example.test')");
    const heads = [['markdown', 'Una tarde en Envigado'], ['text', 'Envigado en texto'], ['html', '<p>Envigado</p>']] as const;
    for (const [index, [kind, text]] of heads.entries()) {
      const snapshot = JSON.stringify({ metadata: { title: `Página ${kind}`, description: 'Búsqueda' }, content: { kind, text }, files: [] });
      await client.batch([
        { sql: 'INSERT INTO artifact (id, owner_id, head_revision_id, created_at) VALUES (?, ?, ?, 0)', args: [`a${index}`, 'owner', `r${index}`] },
        { sql: "INSERT INTO artifact_revision (id, artifact_id, sequence, author_user_id, author_client_id, created_at, sha256, snapshot) VALUES (?, ?, 1, 'owner', 'client', 0, '', ?)", args: [`r${index}`, `a${index}`, snapshot] },
      ], 'write');
    }
    await client.execute("INSERT INTO artifact_revision (id, artifact_id, sequence, author_user_id, author_client_id, created_at, sha256, snapshot) VALUES ('old', 'a0', 2, 'owner', 'client', 0, '', '{\"metadata\":{\"title\":\"Old\",\"description\":\"\"},\"content\":{\"kind\":\"markdown\",\"text\":\"Sabaneta\"},\"files\":[]}')");
    await migrateDatabase(url);
    await migrateDatabase(url);
    const search = async (query: string) => (await client.execute({ sql: 'SELECT artifact_id, title, description FROM artifact_search WHERE artifact_search MATCH ? ORDER BY artifact_id', args: [query] })).rows.map((row) => ({ ...row }));
    assert.deepEqual(await search('envigado'), [{ artifact_id: 'a0', title: 'Página markdown', description: 'Búsqueda' }, { artifact_id: 'a1', title: 'Página text', description: 'Búsqueda' }]);
    assert.deepEqual(await search('busqueda pagina'), await search('envigado'), 'accents fold in the title and description');
    assert.deepEqual(await search('sabaneta'), [], 'only head revisions are backfilled');
    await db.delete(user).where(eq(user.id, 'owner'));
    assert.equal((await client.execute('SELECT count(*) AS total FROM artifact_search')).rows[0]!.total, 0);
  } finally {
    client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('reindexSearch rebuilds one row per head for every kind and converges when run again', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-db-'));
  const url = `file:${join(directory, 'reindex.db')}`;
  await migrateDatabase(url);
  const { db, client } = await openDatabase({ url });
  try {
    await client.execute("INSERT INTO user (id, name, email) VALUES ('owner', 'Owner', 'owner@example.test')");
    const heads: Snapshot[] = [
      { metadata: { title: 'Página html', description: '' }, content: { kind: 'html', text: '<p class="itagui">Una tarde en Envigado</p>' }, files: [] },
      { ...designSnapshot(), metadata: { title: 'Tablero Guatape', description: '' } },
      { metadata: { title: 'Página markdown', description: '' }, content: { kind: 'markdown', text: 'Caldas' }, files: [] },
    ];
    for (const [index, snapshot] of heads.entries()) {
      await client.batch([
        { sql: 'INSERT INTO artifact (id, owner_id, head_revision_id, created_at) VALUES (?, ?, ?, 0)', args: [`a${index}`, 'owner', `r${index}`] },
        { sql: "INSERT INTO artifact_revision (id, artifact_id, sequence, author_user_id, author_client_id, created_at, sha256, snapshot) VALUES (?, ?, 1, 'owner', 'client', 0, '', ?)", args: [`r${index}`, `a${index}`, JSON.stringify(snapshot)] },
      ], 'write');
    }
    await client.execute("INSERT INTO artifact_search (artifact_id, title, description, body) VALUES ('a2', 'Stale', '', 'obsoleto')");
    const search = async (query: string) => (await client.execute({ sql: 'SELECT artifact_id FROM artifact_search WHERE artifact_search MATCH ? ORDER BY artifact_id', args: [query] })).rows.map((row) => row.artifact_id);

    assert.equal(await reindexSearch(db), 3);
    assert.equal(await reindexSearch(db), 3);
    assert.deepEqual(await search('envigado'), ['a0'], 'HTML is found by its visible text');
    assert.deepEqual(await search('itagui'), [], 'HTML attributes are not indexed');
    assert.deepEqual(await search('guatape'), ['a1'], 'design is found by its title');
    assert.deepEqual(await search('board'), [], 'the canvas is not indexed');
    assert.deepEqual(await search('caldas'), ['a2']);
    assert.deepEqual(await search('obsoleto'), [], 'a drifted row is replaced');
    assert.deepEqual((await client.execute('SELECT artifact_id, count(*) AS total FROM artifact_search GROUP BY artifact_id ORDER BY artifact_id')).rows.map((row) => [row.artifact_id, row.total]), [['a0', 1], ['a1', 1], ['a2', 1]]);
  } finally {
    client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
