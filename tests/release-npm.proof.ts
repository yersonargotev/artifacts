import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectTarball, packageOutput, readInventory, type PackageInventory } from '../scripts/package-catalog.ts';
import { assertBetaNotLatest, bootstrapLatestAction, publishedBytes, verifyRelease, waitForBootstrapTags } from '../scripts/release-npm.ts';

const bootstrap = { name: '@yargote/artifacts-contracts', version: '0.1.0-beta.1', initialLatest: null, latest: '0.1.0-beta.1', recorded: false, placeholder: { name: '@yargote/artifacts-contracts', version: '0.0.0-stage', stub: true } };
assert.equal(bootstrapLatestAction(bootstrap), 'restore');
assert.equal(bootstrapLatestAction({ ...bootstrap, latest: '0.0.0-stage' }), 'record');
assert.equal(bootstrapLatestAction({ ...bootstrap, latest: '0.0.0-stage', recorded: true }), 'unchanged');
assert.equal(bootstrapLatestAction({ ...bootstrap, latest: null, placeholder: undefined }), 'unchanged');
assert.equal(bootstrapLatestAction({ ...bootstrap, initialLatest: '0.1.0', latest: '0.1.0', placeholder: undefined }), 'unchanged');
assert.throws(() => bootstrapLatestAction({ ...bootstrap, placeholder: undefined }), /placeholder is missing/);
assert.throws(() => bootstrapLatestAction({ ...bootstrap, placeholder: { ...bootstrap.placeholder, stub: false } }), /must be marked stub/);
assert.throws(() => bootstrapLatestAction({ ...bootstrap, placeholder: { ...bootstrap.placeholder, name: '@yargote/other' } }), /placeholder name differs/);
assert.throws(() => bootstrapLatestAction({ ...bootstrap, placeholder: { ...bootstrap.placeholder, version: '0.0.1' } }), /placeholder version differs/);
assert.throws(() => bootstrapLatestAction({ ...bootstrap, latest: '0.2.0' }), /latest changed since release snapshot/);
assert.throws(() => bootstrapLatestAction({ ...bootstrap, initialLatest: '0.1.0' }), /latest changed since release snapshot/);
assert.throws(() => bootstrapLatestAction({ ...bootstrap, initialLatest: '0.1.0', latest: '0.0.0-stage', recorded: true }), /latest changed since release snapshot/);
assert.throws(() => bootstrapLatestAction({ ...bootstrap, recorded: true }), /latest changed after bootstrap normalization/);
assert.throws(() => bootstrapLatestAction({ ...bootstrap, latest: null, recorded: true }), /latest changed after bootstrap normalization/);

const packageBytes = Buffer.from('inspected release tarball');
const integrity = `sha512-${createHash('sha512').update(packageBytes).digest('base64')}`;
const publishedMetadata = { versions: { '0.1.0-beta.1': { dist: { integrity, tarball: 'https://registry.npmjs.org/package.tgz' } } } };
const originalFetch = globalThis.fetch;
let requests = 0;
function registryResponses(responses: Response[]): void {
  requests = 0;
  globalThis.fetch = async () => {
    const response = responses[requests++];
    assert.ok(response, 'Unexpected registry retry');
    return response;
  };
}
try {
  const normalizedTags = { beta: '0.1.0-beta.1', latest: '0.0.0-stage' };
  registryResponses([
    new Response(null, { status: 404 }),
    Response.json({}),
    Response.json({ 'dist-tags': { beta: '0.1.0-beta.1', latest: '0.1.0-beta.1' } }),
    Response.json({ 'dist-tags': normalizedTags }),
  ]);
  assert.deepEqual(await waitForBootstrapTags(bootstrap.name, bootstrap.version, { timeoutMs: 1_000, intervalMs: 0 }), normalizedTags);
  assert.equal(requests, 4, 'Bootstrap tag visibility must settle without another mutation');
  registryResponses([Response.json({ 'dist-tags': { beta: bootstrap.version, latest: bootstrap.version } })]);
  await assert.rejects(waitForBootstrapTags(bootstrap.name, bootstrap.version, { timeoutMs: 0, intervalMs: 0 }), /Timed out waiting for npm bootstrap tags/);
  assert.equal(requests, 1, 'Stale bootstrap tags must stop at the deadline');
  registryResponses([Response.json({ 'dist-tags': { ...normalizedTags, latest: '0.2.0' } })]);
  await assert.rejects(waitForBootstrapTags(bootstrap.name, bootstrap.version), /latest changed during bootstrap normalization/);
  assert.equal(requests, 1, 'Unexpected latest must fail without retry');
  registryResponses([Response.json({ 'dist-tags': { ...normalizedTags, beta: '0.2.0-beta.1' } })]);
  await assert.rejects(waitForBootstrapTags(bootstrap.name, bootstrap.version), /beta does not identify/);
  assert.equal(requests, 1, 'Unexpected beta must fail without retry');
  registryResponses([new Response(null, { status: 503 })]);
  await assert.rejects(waitForBootstrapTags(bootstrap.name, bootstrap.version), /Registry metadata failed with HTTP 503/);
  assert.equal(requests, 1, 'Bootstrap polling must preserve non-404 registry errors');
  registryResponses([
    new Response(null, { status: 404 }),
    Response.json({ versions: {} }),
    Response.json(publishedMetadata),
    new Response(null, { status: 404 }),
    Response.json(publishedMetadata),
    new Response(packageBytes),
  ]);
  await publishedBytes('@yargote/artifacts-contracts', '0.1.0-beta.1', integrity, { timeoutMs: 1_000, intervalMs: 0 });
  assert.equal(requests, 6, 'Delayed metadata and tarball must eventually verify downloaded bytes');
  registryResponses([new Response(null, { status: 404 })]);
  await assert.rejects(publishedBytes('@yargote/artifacts-contracts', '0.1.0-beta.1', integrity, { timeoutMs: 0, intervalMs: 0 }), /Timed out waiting/);
  assert.equal(requests, 1, 'Unavailable packages must stop at the deadline');
  registryResponses([Response.json(publishedMetadata)]);
  await assert.rejects(publishedBytes('@yargote/artifacts-contracts', '0.1.0-beta.1', 'sha512-different', { intervalMs: 0 }), /differs from inspected tarball/);
  assert.equal(requests, 1, 'Integrity conflicts must fail without retry');
  registryResponses([Response.json(publishedMetadata), new Response('different bytes')]);
  await assert.rejects(publishedBytes('@yargote/artifacts-contracts', '0.1.0-beta.1', integrity, { intervalMs: 0 }), /Downloaded .* differs from inspected tarball/);
  assert.equal(requests, 2, 'Downloaded integrity conflicts must fail without retry');
  registryResponses([new Response(null, { status: 503 })]);
  await assert.rejects(publishedBytes('@yargote/artifacts-contracts', '0.1.0-beta.1', integrity, { intervalMs: 0 }), /Registry metadata failed with HTTP 503/);
  assert.equal(requests, 1, 'Unexpected registry errors must fail without retry');
  registryResponses([Response.json(publishedMetadata), new Response(null, { status: 503 })]);
  await assert.rejects(publishedBytes('@yargote/artifacts-contracts', '0.1.0-beta.1', integrity, { intervalMs: 0 }), /Cannot download .* HTTP 503/);
  assert.equal(requests, 2, 'Unexpected tarball errors must fail without retry');
} finally {
  globalThis.fetch = originalFetch;
}

const inventory = await readInventory();
assert.throws(() => assertBetaNotLatest('0.1.0-beta.1', '0.1.0-beta.1'), /The beta release must not be tagged latest/);
assert.doesNotThrow(() => assertBetaNotLatest('0.1.0-beta.1', null));
assert.doesNotThrow(() => assertBetaNotLatest('0.2.0-beta.1', '0.1.0'));
await verifyRelease(inventory);
const stable = structuredClone(inventory);
for (const item of stable.packages.filter((item) => item.public)) item.version = '0.1.0';
await assert.rejects(verifyRelease(stable), /Only numbered beta prereleases/);
const privatePackage = structuredClone(inventory);
privatePackage.packages.find((item) => item.directory === 'packages/db')!.public = true;
await assert.rejects(verifyRelease(privatePackage), /Only the three approved packages/);
const directory = await mkdtemp(join(tmpdir(), 'artifacts-release-gates-'));
async function pack(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', join(directory, 'tarballs')], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve((JSON.parse(stdout) as { filename: string }[])[0].filename) : reject(new Error(stderr)));
  });
}
async function changedTarball(): Promise<PackageInventory> {
  const changed = structuredClone(inventory);
  const item = changed.packages.find((entry) => entry.name === '@yargote/artifacts-cli')!;
  item.tarball = `tarballs/${await pack(join(directory, 'cli'))}`;
  const actual = await inspectTarball(join(directory, item.tarball));
  item.integrity = actual.integrity;
  item.shasum = actual.shasum;
  item.files = actual.files.map((file) => file.path).sort();
  item.dependencies = actual.manifest.dependencies ?? {};
  return changed;
}
try {
  await cp(join(packageOutput, 'tarballs'), join(directory, 'tarballs'), { recursive: true });
  await cp(join(packageOutput, 'cli'), join(directory, 'cli'), { recursive: true });
  const tarball = join(directory, inventory.packages[0].tarball);
  const bytes = await readFile(tarball);
  await writeFile(tarball, Buffer.concat([bytes, Buffer.from('changed')]));
  await assert.rejects(verifyRelease(inventory, directory), /integrity differs/);
  await writeFile(tarball, bytes);
  await writeFile(join(directory, 'cli/src/secret.ts'), 'export const secret = "not-for-publication";\n');
  await assert.rejects(verifyRelease(await changedTarball(), directory), /Unexpected published file src\/secret.ts/);
  await rm(join(directory, 'cli/src/secret.ts'));
  const manifestPath = join(directory, 'cli/package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.dependencies['@artifacts/db'] = '0.1.0';
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(verifyRelease(await changedTarball(), directory), /Published dependencies must preserve source dependency edges/);
  console.log('Release gate rejects beta tagged latest, stable versions, private packages, altered bytes, TypeScript leaks, and private dependency edges.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
