import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { Client } from '@libsql/client';

const require = createRequire(import.meta.url);
const sdkPath = require.resolve('@libsql/client');
const nativeRequire = createRequire(sdkPath);
const Native = nativeRequire('libsql') as typeof import('libsql');
function field(row: unknown, name: string): unknown {
  assert.ok(row && typeof row === 'object' && name in row);
  return Reflect.get(row, name);
}
const entrypoints = [
  ['ESM', (await import('@libsql/client')).createClient, import.meta.resolve('@libsql/client')],
  ['CJS', require('@libsql/client').createClient as typeof import('@libsql/client').createClient, pathToFileURL(sdkPath).href],
] as const;

for (const [entrypoint, createClient, moduleUrl] of entrypoints) {
  for (const readerKind of ['sdk', 'native'] as const) {
    test(`${entrypoint} warmed ${readerKind} SELECT failure releases its original statement for another process`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'artifacts-libsql-read-'));
      const file = join(directory, 'read.db');
      const holder = new Native(file);
      let client: Client | undefined;
      let native: InstanceType<typeof Native> | undefined;
      try {
        holder.exec('CREATE TABLE entries(value INTEGER); INSERT INTO entries VALUES(1)');
        if (readerKind === 'sdk') client = createClient({ url: `file:${file}`, concurrency: 1 });
        else native = new Native(file);
        const read = async () => client ? (await client.execute('SELECT value FROM entries')).rows.map((row) => row.value) : native!.prepare('SELECT value FROM entries').all().map((row) => field(row, 'value'));
        assert.deepEqual(await read(), [1]);
        const settings = client
          ? [(await client.execute('PRAGMA journal_mode')).rows[0]!.journal_mode, (await client.execute('PRAGMA busy_timeout')).rows[0]!.timeout]
          : [field(native!.prepare('PRAGMA journal_mode').get(), 'journal_mode'), field(native!.prepare('PRAGMA busy_timeout').get(), 'timeout')];
        assert.deepEqual(settings, ['delete', 0]);
        const failed = native?.prepare('SELECT value FROM entries');
        holder.exec('BEGIN EXCLUSIVE');
        if (failed) assert.throws(() => failed.all(), { code: 'SQLITE_BUSY', rawCode: 5 });
        else await assert.rejects(read(), { code: 'SQLITE_BUSY', extendedCode: 'SQLITE_BUSY', rawCode: 5 });
        holder.exec('COMMIT');
        holder.close();
        assert.deepEqual(await read(), [1]);
        const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';
const {createClient} = await import(process.argv[1]);
const client = createClient({url: process.argv[2], concurrency: 1});
try {
  const transaction = await client.transaction('write');
  await transaction.execute('INSERT INTO entries VALUES(2)');
  await transaction.commit();
  assert.deepEqual((await client.execute('SELECT value FROM entries ORDER BY value')).rows.map(row => row.value), [1,2]);
} finally { client.close(); }
`, moduleUrl, `file:${file}`], { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 10_000 });
        assert.equal(child.status, 0, child.stderr);
        assert.deepEqual(await read(), [1, 2]);
      } finally {
        client?.close();
        native?.close();
        holder.close();
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
}
