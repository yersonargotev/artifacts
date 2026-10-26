import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { transform } from 'esbuild';
import { inspectTarball, packageOutput, readInventory, root } from '../scripts/package-catalog.ts';

const { values } = parseArgs({ options: { parent: { type: 'string' } } });
assert.ok(values.parent, 'Provide --parent with the exact S9 portable inventory path');
const directory = await mkdtemp(join(tmpdir(), 'artifacts-portable-native-'));
async function run(args: string[], cwd: string, command = process.execPath) {
  return new Promise<{ status: number | null; output: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (bytes: Buffer) => { output += bytes; });
    child.stderr.on('data', (bytes: Buffer) => { output += bytes; });
    child.once('error', reject);
    child.once('exit', (status) => resolve({ status, output }));
  });
}
try {
  const results = [];
  for (const [name, path] of [['parent', resolve(values.parent)], ['head', join(packageOutput, 'manifest.json')]] as const) {
    const inventory = await readInventory(path);
    assert.equal(inventory.profile, undefined);
    assert.equal(inventory.packages.length, 7);
    const consumer = await mkdtemp(join(directory, `${name}-`));
    for (const item of inventory.packages) assert.equal((await inspectTarball(resolve(dirname(path), item.tarball))).integrity, item.integrity);
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: Object.fromEntries(inventory.packages.map((item) => [item.name, `file:${resolve(dirname(path), item.tarball)}`])) }));
    const installed = await run(['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer, 'npm');
    assert.equal(installed.status, 0, installed.output);
    const databaseRequire = createRequire(createRequire(join(consumer, 'package.json')).resolve('@artifacts/db'));
    const sdk = databaseRequire.resolve('@libsql/client');
    const sdkRoot = dirname(dirname(sdk));
    const wrapper = createRequire(sdk).resolve('libsql');
    const target = `${process.platform}-${process.arch}${process.platform === 'linux' ? '-gnu' : ''}`;
    const native = createRequire(wrapper).resolve(`@libsql/${target}`);
    const sdkHashes = JSON.parse(await readFile(join(root, 'native/libsql/sdk-files.json'), 'utf8')) as Record<string, string>;
    for (const [file, hash] of Object.entries(sdkHashes)) assert.equal(createHash('sha256').update(await readFile(join(sdkRoot, file))).digest('hex'), hash);
    const controls = [];
    for (const test of ['libsql-control', 'libsql-read']) {
      const esm = pathToFileURL(join(sdkRoot, 'lib-esm/node.js')).href;
      const source = (await readFile(join(root, `tests/${test}.test.ts`), 'utf8'))
        .replace('createRequire(import.meta.url)', `createRequire(${JSON.stringify(join(sdkRoot, 'package.json'))})`)
        .replace("await import('@libsql/client')", `await import(${JSON.stringify(esm)})`)
        .replace("import.meta.resolve('@libsql/client')", JSON.stringify(esm));
      const file = `${test}.test.mjs`;
      await writeFile(join(consumer, file), (await transform(source, { loader: 'ts', format: 'esm', target: 'es2024' })).code);
      controls.push(file);
    }
    const observed = await run(['--test', '--test-reporter=spec', ...controls], consumer);
    const outcomes = [...observed.output.split('\nℹ tests ')[0]!.matchAll(/^([✔✖]) (.+) \([\d.]+ms\)$/gm)].map((match) => ({ name: match[2]!, passed: match[1] === '✔' }));
    assert.equal(outcomes.length, 16, observed.output);
    const binarySha256 = createHash('sha256').update(await readFile(native)).digest('hex');
    const result = { name, sdk, wrapper, native, binarySha256, status: observed.status, outcomes };
    results.push(result);
    console.log(JSON.stringify(result));
    console.log(observed.output);
  }
  const [parent, head] = results;
  assert.equal(head!.binarySha256, parent!.binarySha256, 'The portable head must keep its upstream native bytes');
  for (const previous of parent!.outcomes) if (previous.passed) assert.equal(head!.outcomes.find((item) => item.name === previous.name)?.passed, true, `Head introduced a portable native regression: ${previous.name}`);
  const inherited = head!.outcomes.filter((item) => !item.passed && parent!.outcomes.some((previous) => previous.name === item.name && !previous.passed)).map((item) => item.name);
  const newFailures = head!.outcomes.filter((item) => !item.passed && !parent!.outcomes.some((previous) => previous.name === item.name && !previous.passed));
  assert.deepEqual(newFailures, []);
  console.log(JSON.stringify({ portableNative: inherited.length ? 'ISSUES' : 'PASS', inheritedFailures: inherited, newFailures, repairedClaim: false }));
} finally { await rm(directory, { recursive: true, force: true }); }
