import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Client } from '@libsql/client';
import { createAuth } from '../apps/auth/src/auth.ts';
import { createAuthApp } from '../apps/auth/src/http.ts';
import { openDatabase } from '../packages/db/src/index.ts';
import { migrateDatabase } from '../packages/db/src/migrate.ts';
import { migrateIdentity } from '../scripts/migrate-identity.ts';
import { callWhoami, fixture, grant } from './helpers.ts';

const run = promisify(execFile);

async function databases(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-copy-'));
  const sourceUrl = `file:${join(directory, 'source.db')}`;
  const targetUrl = `file:${join(directory, 'target.db')}`;
  await migrateDatabase(sourceUrl);
  await migrateDatabase(targetUrl);
  const source = await openDatabase({ url: sourceUrl, intMode: 'bigint' });
  const target = await openDatabase({ url: targetUrl, intMode: 'bigint' });
  t.after(async () => {
    source.client.close();
    target.client.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, sourceUrl, targetUrl, source, target, copy: () => migrateIdentity({ url: sourceUrl }, { url: targetUrl }) };
}

async function applicationRows(client: Client) {
  const names = await client.execute("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name <> '__drizzle_migrations' ORDER BY name");
  const tables = [];
  for (const { name } of names.rows) {
    const result = await client.execute(`SELECT * FROM "${String(name).replaceAll('"', '""')}" ORDER BY rowid`);
    tables.push({ name, columns: result.columns, rows: result.rows.map((row) => result.columns.map((_, index) => row[index])) });
  }
  return tables;
}

async function seedIdentity(client: Client) {
  await client.execute("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('owner-id', 'Test owner', 'owner@example.test', 1000, 2000)");
  await client.execute("INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES ('password-account-id', 'owner-id', 'credential', 'owner-id', 'preserved-password-hash', 1000, 2000)");
}

test('copy preserves existing passwords, owner identity, OAuth secrets, keys, tokens, and sessions and replays without new rows', async (t) => {
  const app = await fixture();
  t.after(() => app.close());
  const { targetUrl, target } = await databases(t);
  const token = await grant(app);
  const central = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
  assert(central);
  await app.client.execute({
    sql: 'INSERT INTO panel_session (token_hash, auth_session_id, issuer, subject, client_id, scopes, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: ['panel-token-hash', central.session.id, app.config.issuer, app.ownerId, token.clientId, '["openid","artifacts:read"]', Date.now() + 60_000],
  });
  await app.client.execute("INSERT INTO oidc_transaction (token_hash, state, nonce, verifier, expires_at) VALUES ('oidc-token-hash', 'oidc-state', 'oidc-nonce', 'oidc-verifier', 2000000000000)");
  const before = await applicationRows(app.client);
  const targetMigrations = await target.client.execute('SELECT * FROM __drizzle_migrations');
  const first = await migrateIdentity({ url: app.databaseUrl }, { url: targetUrl });
  assert.equal(first.tables.find((table) => table.name === 'user')?.inserted, 1);
  const copied = await applicationRows(target.client);
  const sourceAsBigints = await openDatabase({ url: app.databaseUrl, intMode: 'bigint' });
  try {
    assert.deepEqual(copied, await applicationRows(sourceAsBigints.client));
  } finally {
    sourceAsBigints.client.close();
  }
  assert.deepEqual((await target.client.execute('SELECT * FROM __drizzle_migrations')).rows, targetMigrations.rows);
  const replay = await migrateIdentity({ url: app.databaseUrl }, { url: targetUrl });
  assert.equal(replay.tables.reduce((count, table) => count + table.inserted, 0), 0);
  assert.deepEqual(await applicationRows(target.client), copied);
  assert.deepEqual(await applicationRows(app.client), before);
  assert.equal((await target.client.execute('PRAGMA foreign_key_check')).rows.length, 0);

  const authTarget = await openDatabase({ url: targetUrl });
  t.after(() => authTarget.client.close());
  const auth = createAuth(authTarget.db, app.config);
  const session = await auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
  assert.equal(session?.user.id, app.ownerId);
  assert.equal(session?.session.id, central.session.id);
  const signIn = await auth.api.signInEmail({ body: { email: 'owner@example.test', password: app.password } });
  assert.equal(signIn.user.id, app.ownerId);
  app.setAuthHandler(createAuthApp(authTarget.db, app.config));
  assert.equal((await callWhoami(app.config.resource, token.access_token)).status, 200);
});

test('a conflicting target owner rolls back rows inserted before the conflict', async (t) => {
  const { source, target, copy } = await databases(t);
  await seedIdentity(source.client);
  await target.client.execute("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('owner-id', 'Other owner', 'other@example.test', 3000, 4000)");
  const before = await applicationRows(target.client);
  await assert.rejects(copy(), /conflicting data in table user/);
  assert.deepEqual(await applicationRows(target.client), before);
  assert.deepEqual((await target.client.execute('SELECT id, email FROM user')).rows.map((row) => [row.id, row.email]), [['owner-id', 'other@example.test']]);
  assert.equal((await target.client.execute('SELECT count(*) AS count FROM account')).rows[0]?.count, 0n);
  assert.equal((await source.client.execute('SELECT password FROM account')).rows[0]?.password, 'preserved-password-hash');
});

test('an unrelated target row prevents replay without deleting or changing it', async (t) => {
  const { source, target, copy } = await databases(t);
  await seedIdentity(source.client);
  await copy();
  await target.client.execute("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('unrelated-id', 'Unrelated owner', 'unrelated@example.test', 3000, 4000)");
  const before = await applicationRows(target.client);
  await assert.rejects(copy(), /conflicting data in table user/);
  assert.deepEqual(await applicationRows(target.client), before);
  assert.equal((await target.client.execute('SELECT count(*) AS count FROM user')).rows[0]?.count, 2n);
});

test('an incompatible target schema rolls back the copy instead of dropping source columns', async (t) => {
  const { source, target, copy } = await databases(t);
  await seedIdentity(source.client);
  await source.client.execute('CREATE TABLE zz_identity (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
  await source.client.execute("INSERT INTO zz_identity VALUES ('identity-id', 'preserved-value')");
  await target.client.execute('CREATE TABLE zz_identity (id TEXT PRIMARY KEY)');
  const before = await applicationRows(target.client);
  await assert.rejects(copy(), /Target schema differs for table zz_identity/);
  assert.deepEqual(await applicationRows(target.client), before);
  assert.equal((await target.client.execute('SELECT count(*) AS count FROM user')).rows[0]?.count, 0n);
  assert.equal((await source.client.execute('SELECT value FROM zz_identity')).rows[0]?.value, 'preserved-value');
});

test('copy preserves blobs, full-width integers, real numbers, nulls, duplicate rows, and quoted identifiers', async (t) => {
  const { source, target, copy } = await databases(t);
  const schema = 'CREATE TABLE "binary""table" ("value""column" BLOB, integer_value INTEGER, real_value REAL, optional_value TEXT)';
  await source.client.execute(schema);
  await target.client.execute(schema);
  const blob = new Uint8Array([0, 255, 128, 39, 34, 10]);
  for (let index = 0; index < 2; index++) {
    await source.client.execute({ sql: 'INSERT INTO "binary""table" VALUES (?, ?, ?, ?)', args: [blob, 9223372036854775807n, 1.25, null] });
  }
  await target.client.execute({ sql: 'INSERT INTO "binary""table" VALUES (?, ?, ?, ?)', args: [blob, 9223372036854775807n, 1.25, null] });
  const copied = await copy();
  assert.deepEqual(copied.tables.find((table) => table.name === 'binary"table'), { name: 'binary"table', rows: 2, inserted: 1 });
  const rows = (await target.client.execute('SELECT * FROM "binary""table"')).rows.map((row) => [Buffer.from(row[0] as ArrayBuffer), row[1], row[2], row[3]]);
  assert.deepEqual(rows, [[Buffer.from(blob), 9223372036854775807n, 1.25, null], [Buffer.from(blob), 9223372036854775807n, 1.25, null]]);
  assert.equal((await copy()).tables.reduce((count, table) => count + table.inserted, 0), 0);
});

test('foreign key cycles copy through one deferred destination transaction', async (t) => {
  const { source, target, copy } = await databases(t);
  const schema = [
    'CREATE TABLE cycle_left (id TEXT PRIMARY KEY, right_id TEXT NOT NULL REFERENCES cycle_right(id))',
    'CREATE TABLE cycle_right (id TEXT PRIMARY KEY, left_id TEXT NOT NULL REFERENCES cycle_left(id))',
  ];
  for (const sql of schema) {
    await source.client.execute(sql);
    await target.client.execute(sql);
  }
  await source.client.batch([
    'PRAGMA defer_foreign_keys = ON',
    "INSERT INTO cycle_left VALUES ('left-id', 'right-id')",
    "INSERT INTO cycle_right VALUES ('right-id', 'left-id')",
  ], 'write');
  await copy();
  assert.deepEqual((await target.client.execute('SELECT cycle_left.id, cycle_right.id FROM cycle_left JOIN cycle_right ON cycle_left.right_id = cycle_right.id AND cycle_right.left_id = cycle_left.id')).rows.map((row) => [row[0], row[1]]), [['left-id', 'right-id']]);
  assert.equal((await target.client.execute('PRAGMA foreign_key_check')).rows.length, 0);
});

test('verification rejects a target trigger that changes copied identity and rolls everything back', async (t) => {
  const { source, target, copy } = await databases(t);
  await seedIdentity(source.client);
  await target.client.execute("CREATE TRIGGER corrupt_owner AFTER INSERT ON user BEGIN UPDATE user SET email = 'changed@example.test' WHERE id = NEW.id; END");
  await assert.rejects(copy(), /conflicting data in table user/);
  assert.equal((await target.client.execute('SELECT count(*) AS count FROM user')).rows[0]?.count, 0n);
  assert.equal((await target.client.execute('SELECT count(*) AS count FROM account')).rows[0]?.count, 0n);
  assert.equal((await source.client.execute('SELECT email FROM user')).rows[0]?.email, 'owner@example.test');
});

test('foreign key verification rejects an orphan in the source without committing partial data', async (t) => {
  const { source, target, copy } = await databases(t);
  await source.client.execute('PRAGMA foreign_keys = OFF');
  await source.client.execute("INSERT INTO account (id, account_id, provider_id, user_id, password, updated_at) VALUES ('orphan-id', 'missing-owner', 'credential', 'missing-owner', 'orphan-password-hash', 2000)");
  await assert.rejects(copy(), /foreign key verification failed/);
  assert.equal((await target.client.execute('SELECT count(*) AS count FROM account')).rows[0]?.count, 0n);
  assert.equal((await source.client.execute('SELECT id FROM account')).rows[0]?.id, 'orphan-id');
});

test('CLI reads explicit environment files, ignores inherited database settings, and never rewrites files or prints secrets', async (t) => {
  const { directory, sourceUrl, targetUrl, source, target } = await databases(t);
  await seedIdentity(source.client);
  const sourceFile = join(directory, '.env');
  const targetFile = join(directory, '.env.turso');
  const sourceEnv = `DATABASE_URL=${sourceUrl}\nOWNER_PASSWORD=private-owner-password\n`;
  const targetEnv = `DATABASE_URL=${targetUrl}\nPANEL_CLIENT_SECRET=private-panel-client-secret\n`;
  await writeFile(sourceFile, sourceEnv, { mode: 0o600 });
  await writeFile(targetFile, targetEnv, { mode: 0o600 });
  const result = await run(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../scripts/migrate-identity.ts', import.meta.url)), '--source-env', sourceFile, '--target-env', targetFile], {
    cwd: directory,
    env: { ...process.env, DATABASE_URL: 'invalid-inherited-url', DATABASE_AUTH_TOKEN: 'private-inherited-token' },
    timeout: 15_000,
  });
  assert.match(result.stdout, /Identity migration verified \d+ tables and 2 rows\./);
  assert.doesNotMatch(result.stderr, /Identity migration failed/);
  assert.doesNotMatch(result.stdout + result.stderr, /private-|preserved-password-hash|owner@example/);
  assert.equal(await readFile(sourceFile, 'utf8'), sourceEnv);
  assert.equal(await readFile(targetFile, 'utf8'), targetEnv);
  assert.deepEqual((await target.client.execute('SELECT user_id, password FROM account')).rows.map((row) => [row.user_id, row.password]), [['owner-id', 'preserved-password-hash']]);
});
