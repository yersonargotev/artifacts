import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectTarball, packageDefinitions, packageOutput, readInventory, root, type PackageInventory, type PackageManifest } from './package-catalog.ts';

export const publicNames = ['@yargote/artifacts-contracts', '@yargote/artifacts-client', '@yargote/artifacts-cli'] as const;
const registry = 'https://registry.npmjs.org';
const betaVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.(0|[1-9]\d*)$/;
export function assertBetaNotLatest(version: string, latest: string | null): void {
  assert.notEqual(latest, version, 'The beta release must not be tagged latest');
}
function targets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value === null) return [];
  assert.ok(value && typeof value === 'object', 'Exports must contain paths or conditions');
  return Object.values(value).flatMap(targets);
}
export async function verifyRelease(inventory: PackageInventory, output = packageOutput): Promise<void> {
  assert.equal(inventory.packages.length, packageDefinitions.length, 'Inventory must contain the complete package catalog');
  assert.deepEqual(inventory.packages.map((item) => item.directory).sort(), packageDefinitions.map((item) => item.directory).sort());
  const published = inventory.packages.filter((item) => item.public);
  assert.deepEqual(published.map((item) => item.name).sort(), [...publicNames].sort(), 'Only the three approved packages can be published');
  assert.equal(new Set(published.map((item) => item.version)).size, 1, 'Public package versions must match');
  assert.match(published[0].version, betaVersion, 'Only numbered beta prereleases can be released');
  const byName = new Map(inventory.packages.map((item) => [item.name, item]));
  assert.equal(byName.size, inventory.packages.length, 'Package identities must be unique');
  const rootManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as PackageManifest;
  assert.equal(rootManifest.private, true, 'The monorepo must remain private');
  for (const packed of inventory.packages) {
    const definition = packageDefinitions.find((item) => item.directory === packed.directory)!;
    assert.equal(packed.public, definition.public, 'Publication eligibility must match the package catalog');
    const source = JSON.parse(await readFile(resolve(root, packed.directory, 'package.json'), 'utf8')) as PackageManifest;
    assert.equal(source.private, true, 'All source workspace packages must remain private');
    assert.equal(packed.name, source.name);
    assert.equal(packed.version, source.version ?? '0.1.0');
    const tarball = resolve(output, packed.tarball);
    assert.ok(tarball.startsWith(`${resolve(output)}/tarballs/`), 'Tarball must be inside the release tarballs directory');
    const actual = await inspectTarball(tarball);
    assert.equal(actual.integrity, packed.integrity, 'Tarball integrity differs from inventory');
    assert.equal(actual.shasum, packed.shasum);
    assert.deepEqual(actual.files.map((file) => file.path).sort(), packed.files);
    assert.equal(actual.manifest.name, packed.name);
    assert.equal(actual.manifest.version, packed.version);
    assert.deepEqual(actual.manifest.dependencies ?? {}, packed.dependencies);
    assert.equal(actual.manifest.private, !packed.public);
    if (!packed.public) continue;
    assert.equal(actual.manifest.license, 'MIT');
    assert.deepEqual(actual.manifest.engines, { node: '>=24' });
    const rewrite = (value: unknown): unknown => typeof value === 'string' ? value.replace(/\.ts$/, '.js') : value === null || value === undefined ? value : Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, rewrite(child)]));
    assert.deepEqual(actual.manifest.exports, rewrite(source.exports), 'Published exports must preserve source exports');
    assert.deepEqual(actual.manifest.bin, rewrite(source.bin), 'Published bin must preserve the source command');
    for (const key of ['description', 'license', 'repository', 'homepage', 'bugs'] as const) assert.deepEqual(actual.manifest[key], source[key], `Published ${key} differs from source`);
    const expectedDependencies = Object.fromEntries(Object.entries(source.dependencies ?? {}).map(([name, version]) => [name, version.startsWith('workspace:') ? byName.get(name)?.version : version]));
    assert.deepEqual(packed.dependencies, expectedDependencies, 'Published dependencies must preserve source dependency edges');
    assert.deepEqual(actual.manifest.publishConfig, { access: 'public', tag: 'beta', provenance: false });
    const paths = new Set(actual.files.map((file) => file.path));
    for (const required of ['README.md', 'LICENSE', 'package.json']) assert.ok(paths.has(required), `${packed.name} must include ${required}`);
    const license = actual.files.find((file) => file.path === 'LICENSE')!.bytes;
    assert.deepEqual(license, await readFile(resolve(root, packed.directory, 'LICENSE')), 'Published LICENSE differs from the approved package license');
    assert.match(license.toString('utf8'), /MIT License/);
    for (const file of actual.files) {
      assert.match(file.path, /^(?:package\.json|README\.md|LICENSE|src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.js|\.d\.ts))$/, `Unexpected published file ${file.path}`);
      if (/\.(?:js|ts)$/.test(file.path)) assert.doesNotMatch(file.bytes.toString('utf8'), /@artifacts\/(?:cli|client|contracts)(?:['"/]|$)/, 'Compiled imports still contain private package identities');
    }
    for (const target of [...targets(actual.manifest.exports ?? null), ...Object.values(actual.manifest.bin ?? {})]) {
      assert.ok(target.startsWith('./') && !target.includes('..') && paths.has(target.slice(2)), `Missing export or bin ${target}`);
      if (target.endsWith('.js') && !Object.values(actual.manifest.bin ?? {}).includes(target)) assert.ok(paths.has(target.slice(2).replace(/\.js$/, '.d.ts')), `Missing declaration for ${target}`);
    }
    for (const [name, version] of Object.entries(packed.dependencies)) {
      assert.doesNotMatch(version, /^(?:workspace:|file:|link:|https?:|git|\/|\.\.?\/)/, `Non-registry dependency ${name}`);
      if (byName.has(name)) {
        assert.equal(byName.get(name)!.public, true, `Public package depends on private ${name}`);
        assert.equal(version, byName.get(name)!.version, 'Public dependencies must use the exact coordinated version');
      }
    }
    if (packed.name === '@yargote/artifacts-cli') {
      assert.deepEqual(actual.manifest.bin, { artifacts: './src/index.js' });
      const bin = actual.files.find((file) => file.path === 'src/index.js')!;
      assert.ok(bin.bytes.toString('utf8').startsWith('#!/usr/bin/env node\n'), 'CLI must have a Node shebang');
      assert.equal(bin.mode & 0o111, 0o111, 'CLI must be executable');
    }
  }
}
async function metadata(name: string): Promise<{ 'dist-tags'?: Record<string, string>; versions?: Record<string, { dist: { integrity: string; tarball: string } }> } | undefined> {
  const response = await fetch(`${registry}/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Registry metadata failed with HTTP ${response.status}`);
  return response.json();
}
async function publishedBytes(name: string, version: string, integrity: string): Promise<void> {
  const value = await metadata(name);
  const dist = value?.versions?.[version]?.dist;
  assert.ok(dist, `Registry version ${name}@${version} is missing`);
  assert.equal(dist.integrity, integrity, `Existing ${name}@${version} differs from inspected tarball`);
  assert.equal(new URL(dist.tarball).origin, registry, 'Tarball must come from the npm registry');
  const response = await fetch(dist.tarball, { signal: AbortSignal.timeout(30_000) });
  assert.ok(response.ok, `Cannot download ${name}@${version}`);
  const { createHash } = await import('node:crypto');
  const downloaded = `sha512-${createHash('sha512').update(Buffer.from(await response.arrayBuffer())).digest('base64')}`;
  assert.equal(downloaded, integrity, `Downloaded ${name}@${version} differs from inspected tarball`);
}
export async function publishRelease(inventory: PackageInventory, output = packageOutput): Promise<void> {
  await verifyRelease(inventory, output);
  const statePath = resolve(output, 'publication-state.json');
  const entries = publicNames.map((name) => inventory.packages.find((item) => item.name === name)!);
  let state: { versions: Record<string, string>; latest: Record<string, string | null> };
  try { state = JSON.parse(await readFile(statePath, 'utf8')) as typeof state; }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    state = { versions: Object.fromEntries(entries.map((item) => [item.name, item.version])), latest: {} };
    for (const item of entries) {
      state.latest[item.name] = (await metadata(item.name))?.['dist-tags']?.latest ?? null;
      assertBetaNotLatest(item.version, state.latest[item.name]);
    }
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }
  assert.deepEqual(state.versions, Object.fromEntries(entries.map((item) => [item.name, item.version])), 'Publication state belongs to a different release');
  for (const item of entries) assertBetaNotLatest(item.version, state.latest[item.name]);
  for (const item of entries) {
    const before = await metadata(item.name);
    assertBetaNotLatest(item.version, before?.['dist-tags']?.latest ?? null);
    assert.equal(before?.['dist-tags']?.latest ?? null, state.latest[item.name], 'latest changed since release snapshot');
    const existing = before?.versions?.[item.version];
    if (!existing) await new Promise<void>((resolvePromise, reject) => {
      const child = spawn('npm', ['publish', resolve(output, item.tarball), '--registry', registry, '--access', 'public', '--tag', 'beta', '--provenance=false', '--ignore-scripts'], { stdio: 'inherit', timeout: 180_000 });
      child.once('error', reject);
      child.once('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`npm publish failed (${code}) for ${item.name}`)));
    });
    await publishedBytes(item.name, item.version, item.integrity);
    const tags = (await metadata(item.name))?.['dist-tags'];
    assert.equal(tags?.beta, item.version, `beta does not identify ${item.name}@${item.version}`);
    assertBetaNotLatest(item.version, tags?.latest ?? null);
    assert.equal(tags?.latest ?? null, state.latest[item.name], 'Publication changed latest');
    console.log(JSON.stringify({ name: item.name, version: item.version, integrity: item.integrity, beta: tags?.beta, latest: tags?.latest ?? null, downloaded: true }));
  }
  for (const item of entries) {
    const latest = (await metadata(item.name))?.['dist-tags']?.latest ?? null;
    assertBetaNotLatest(item.version, latest);
    assert.equal(latest, state.latest[item.name], 'Publication changed latest');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  assert.equal(args.length, 0, 'Release commands accept no version or dist-tag override');
  const inventory = await readInventory();
  if (command === 'check') {
    await verifyRelease(inventory);
    console.log(JSON.stringify({ verified: true, tag: 'beta', packages: inventory.packages.filter((item) => item.public) }, null, 2));
  } else if (command === 'publish') await publishRelease(inventory);
  else throw new Error('Usage: release-npm.ts check|publish');
}
