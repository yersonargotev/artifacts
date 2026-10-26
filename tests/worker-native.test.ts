import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { test } from 'node:test';
import { assertWorkerDependencies } from '../scripts/build-workers.ts';

for (const [name, source] of [
  ['native', "import Native from './.native/libsql/index.js'; globalThis.database = new Native(':memory:');"],
  ['file-email', "if (globalThis.localFile) import('./packages/config/src/email-node.ts').then(module => globalThis.sender = module.fileEmailSender('/tmp/fixture-mail'));"],
] as const) {
  test(`the final Worker guard rejects a valid ${name} bundle`, async () => {
    const result = await build({ stdin: { contents: source, resolveDir: process.cwd() }, outfile: '/tmp/artifacts-worker-negative/worker.mjs', bundle: true, write: false, format: 'esm', platform: 'browser', conditions: ['workerd', 'browser'], external: ['node:*'], loader: { '.node': 'file' }, metafile: true });
    const inputs = Object.keys(result.metafile.inputs);
    const imports = Object.values(result.metafile.outputs).flatMap((output) => output.imports);
    assert.throws(() => assertWorkerDependencies(name, inputs, imports), /Node-only network, database, or file dependency/);
    assert.ok(name === 'native' ? inputs.some((path) => path.endsWith('/libsql/index.node')) : imports.some((item) => item.path === 'node:fs/promises'));
  });
}
