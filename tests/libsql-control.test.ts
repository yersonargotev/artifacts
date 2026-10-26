import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Client } from '@libsql/client';

const require = createRequire(import.meta.url);
const entrypoints = [
  ['ESM', (await import('@libsql/client')).createClient],
  ['CJS', require('@libsql/client').createClient as typeof import('@libsql/client').createClient],
] as const;

for (const [entrypoint, createClient] of entrypoints) {
  async function fixture(work: (writer: Client, reader: Client, fresh: () => Client) => Promise<void>) {
    const directory = await mkdtemp(join(tmpdir(), 'artifacts-libsql-control-'));
    const clients: Client[] = [];
    const fresh = () => {
      const client = createClient({ url: `file:${join(directory, 'control.db')}`, concurrency: 1 });
      clients.push(client);
      return client;
    };
    try {
      const writer = fresh();
      await writer.execute('CREATE TABLE entries(value INTEGER)');
      await writer.execute('PRAGMA foreign_keys=ON');
      await work(writer, fresh(), fresh);
    } finally {
      for (const client of clients) client.close();
      await rm(directory, { recursive: true, force: true });
    }
  }

  test(`${entrypoint} failed BEGIN permits an empty COMMIT and subsequent writes`, async () => {
    await fixture(async (writer, contender, fresh) => {
      const held = await writer.transaction('write');
      try {
        await assert.rejects(contender.transaction('write'), { code: 'SQLITE_BUSY', extendedCode: 'SQLITE_BUSY', rawCode: 5 });
      } finally {
        await held.commit();
      }
      const retry = await contender.transaction('write');
      await retry.commit();
      await contender.execute('INSERT INTO entries VALUES (2)');
      const rows = await fresh().execute('SELECT value FROM entries');
      assert.deepEqual(rows.rows.map((row) => row.value), [2]);
    });
  });

  for (const operation of ['transaction', 'batch', 'migrate'] as const) {
    test(`${entrypoint} failed ${operation} COMMIT releases locks and preserves foreign keys`, async () => {
      await fixture(async (writer, reader, fresh) => {
        const read = await reader.transaction('read');
        await read.execute('SELECT count(*) FROM entries');
        try {
          if (operation === 'transaction') {
            const transaction = await writer.transaction('deferred');
            await transaction.execute('INSERT INTO entries VALUES (1)');
            await assert.rejects(transaction.commit(), { code: 'SQLITE_BUSY', extendedCode: 'SQLITE_BUSY', rawCode: 5 });
            await transaction.rollback();
          } else {
            const commit = operation === 'batch'
              ? writer.batch(['INSERT INTO entries VALUES (1)'], 'deferred')
              : writer.migrate([{ sql: 'INSERT INTO entries VALUES (1)', args: [] }]);
            await assert.rejects(commit, { code: 'SQLITE_BUSY', extendedCode: 'SQLITE_BUSY', rawCode: 5 });
          }
        } finally {
          await read.rollback();
        }
        assert.equal((await writer.execute('PRAGMA foreign_keys')).rows[0]?.foreign_keys, 1);
        await writer.execute('INSERT INTO entries VALUES (2)');
        const other = fresh();
        await other.execute('INSERT INTO entries VALUES (3)');
        assert.deepEqual((await other.execute('SELECT value FROM entries ORDER BY value')).rows.map((row) => row.value), [2, 3]);
      });
    });
  }

  for (const operation of ['rollback', 'close'] as const) {
    test(`${entrypoint} transaction ${operation} releases uncommitted changes`, async () => {
      await fixture(async (writer, _reader, fresh) => {
        const transaction = await writer.transaction('write');
        await transaction.execute('INSERT INTO entries VALUES (1)');
        if (operation === 'rollback') await transaction.rollback();
        else transaction.close();
        await writer.execute('INSERT INTO entries VALUES (2)');
        const other = fresh();
        await other.execute('INSERT INTO entries VALUES (3)');
        assert.deepEqual((await other.execute('SELECT value FROM entries ORDER BY value')).rows.map((row) => row.value), [2, 3]);
      });
    });
  }
}
