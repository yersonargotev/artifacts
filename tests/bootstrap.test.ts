import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv, promisify } from 'node:util';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { openDatabase } from '../packages/db/src/index.ts';
import { migrateDatabase } from '../packages/db/src/migrate.ts';
import { oauthClient, oauthClientResource, user } from '../packages/db/src/schema.ts';

const run = promisify(execFile);

test('bootstrap registers independent mixed-origin clients and preserves owner IDs, secrets, and resource links', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-bootstrap-'));
  const url = `file:${join(directory, 'identity.db')}`;
  await migrateDatabase(url);
  const { db, client } = await openDatabase({ url });
  try {
    const config = {
      DATABASE_URL: url, AUTH_URL: 'http://localhost:4100', MCP_URL: 'http://127.0.0.1:4101/mcp', DASHBOARD_URL: 'https://panel.example.test',
      BETTER_AUTH_SECRET: randomBytes(32).toString('base64url'), OWNER_EMAIL: 'owner@example.test', OWNER_NAME: 'Test owner', OWNER_PASSWORD: randomBytes(32).toString('base64url'),
    };
    const file = join(directory, '.env');
    await writeFile(file, Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
    const childEnv = { ...process.env };
    for (const key of [...Object.keys(config), 'PANEL_CLIENT_ID', 'PANEL_CLIENT_SECRET', 'MCP_INTROSPECTION_CLIENT_ID', 'MCP_INTROSPECTION_CLIENT_SECRET']) delete childEnv[key];
    const execute = () => run(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../apps/auth/src/bootstrap.ts', import.meta.url))], { cwd: directory, env: childEnv, timeout: 15_000 });
    await execute();
    const first = parseEnv(await readFile(file, 'utf8'));
    assert.equal((await db.select().from(oauthClientResource).where(eq(oauthClientResource.clientId, first.MCP_INTROSPECTION_CLIENT_ID!))).length, 1);
    const owner = await db.select().from(user).get();
    assert(owner);
    await writeFile(file, `${await readFile(file, 'utf8')}MCP_URL=https://artifacts-api.example.test/mcp\nAPI_URL=https://artifacts-api.example.test\n`, { mode: 0o600 });
    await execute();
    await execute();
    const second = parseEnv(await readFile(file, 'utf8'));
    assert(first.PANEL_CLIENT_SECRET === second.PANEL_CLIENT_SECRET);
    assert(first.MCP_INTROSPECTION_CLIENT_SECRET === second.MCP_INTROSPECTION_CLIENT_SECRET);
    assert.equal((await db.select().from(user)).length, 1);
    assert.equal((await db.select().from(user).get())?.id, owner.id);
    assert.equal((await db.select().from(oauthClient).where(eq(oauthClient.clientId, second.PANEL_CLIENT_ID!)).get())?.applicationType, 'web');
    assert.equal((await db.select().from(oauthClient).where(eq(oauthClient.clientId, second.MCP_INTROSPECTION_CLIENT_ID!)).get())?.applicationType, 'native');
    assert.deepEqual((await db.select().from(oauthClientResource).where(eq(oauthClientResource.clientId, second.MCP_INTROSPECTION_CLIENT_ID!))).map((link) => link.resourceId).sort(), [config.MCP_URL, 'https://artifacts-api.example.test', 'https://artifacts-api.example.test/mcp'].sort());
  } finally {
    client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('bootstrap appends public callback clients to the selected private environment file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-bootstrap-selected-'));
  const url = `file:${join(directory, 'identity.db')}`;
  await migrateDatabase(url);
  const { db, client } = await openDatabase({ url });
  try {
    const config = {
      DATABASE_URL: url, AUTH_URL: 'https://auth.example.test', MCP_URL: 'https://mcp.example.test/mcp', DASHBOARD_URL: 'https://panel.example.test',
      BETTER_AUTH_SECRET: randomBytes(32).toString('base64url'), OWNER_EMAIL: 'owner@example.test', OWNER_NAME: 'Test owner', OWNER_PASSWORD: randomBytes(32).toString('base64url'),
    };
    const file = join(directory, '.env.deploy');
    await writeFile(file, Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
    await writeFile(join(directory, '.env'), 'LOCAL_ENVIRONMENT=preserved\n', { mode: 0o600 });
    const childEnv: NodeJS.ProcessEnv = { ...process.env, ARTIFACTS_ENV_FILE: file };
    for (const key of [...Object.keys(config), 'PANEL_CLIENT_ID', 'PANEL_CLIENT_SECRET', 'MCP_INTROSPECTION_CLIENT_ID', 'MCP_INTROSPECTION_CLIENT_SECRET']) delete childEnv[key];
    await run(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../apps/auth/src/bootstrap.ts', import.meta.url))], { cwd: directory, env: childEnv, timeout: 15_000 });
    const selected = parseEnv(await readFile(file, 'utf8'));
    assert(selected.PANEL_CLIENT_SECRET && selected.MCP_INTROSPECTION_CLIENT_SECRET);
    const panel = await db.select().from(oauthClient).where(eq(oauthClient.clientId, selected.PANEL_CLIENT_ID!)).get();
    assert(panel);
    assert.equal(panel.redirectUris, '["https://panel.example.test/auth/callback"]');
    assert.equal(await readFile(join(directory, '.env'), 'utf8'), 'LOCAL_ENVIRONMENT=preserved\n');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
