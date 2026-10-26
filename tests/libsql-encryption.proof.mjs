import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const key = 'disposable-native-compatibility-key';
if (process.argv[2] === 'child') {
  const [manifest, operation, file, entrypoint] = process.argv.slice(3);
  const require = createRequire(manifest);
  const createClient = entrypoint === 'ESM' ? (await import(pathToFileURL(join(dirname(manifest), 'lib-esm/node.js')))).createClient : require('./lib-cjs/node.js').createClient;
  const client = createClient({ url: `file:${file}`, intMode: 'bigint', ...(operation === 'deny' ? {} : { encryptionKey: key }) });
  try {
    if (operation === 'write') {
      await client.execute('CREATE TABLE compatibility(id INTEGER PRIMARY KEY, text TEXT, bytes BLOB)');
      await client.execute('INSERT INTO compatibility VALUES(?,?,?)', [9007199254740993n, 'persisted fixture', Uint8Array.from([0, 127, 128, 255]).buffer]);
    } else if (operation === 'deny') {
      await assert.rejects(client.execute('SELECT * FROM compatibility'), { code: 'SQLITE_NOTADB', extendedCode: 'SQLITE_NOTADB', rawCode: 26 });
    } else {
      const row = (await client.execute('SELECT * FROM compatibility')).rows[0];
      assert.equal(row.id, 9007199254740993n);
      assert.equal(row.text, 'persisted fixture');
      assert.deepEqual([...new Uint8Array(row.bytes)], [0, 127, 128, 255]);
    }
  } finally { client.close(); }
} else {
  const [fixed, original] = process.argv.slice(2);
  assert.ok(fixed && original, 'Provide the fixed and original SDK package.json paths');
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-native-encryption-'));
  try {
    for (const [writer, reader, label] of [[fixed, original, 'fixed-to-original'], [original, fixed, 'original-to-fixed']]) {
      const file = join(directory, `${label}.db`);
      const run = (manifest, operation, entrypoint) => execFileSync(process.execPath, [import.meta.filename, 'child', manifest, operation, file, entrypoint], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
      run(writer, 'write', 'ESM');
      assert.notEqual((await readFile(file)).subarray(0, 16).toString(), 'SQLite format 3\0');
      run(reader, 'read', 'CJS');
      run(reader, 'deny', 'ESM');
      console.log(JSON.stringify({ direction: label, encrypted: true, id: '9007199254740993', bytes: [0, 127, 128, 255], noKey: 'SQLITE_NOTADB', separateProcesses: true }));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
