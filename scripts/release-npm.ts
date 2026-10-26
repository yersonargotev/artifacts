import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledSkillFiles, inspectTarball, packageDefinitions, packageOutput, readInventory, root, type PackageInventory, type PackageManifest } from './package-catalog.ts';

export const publicNames = ['@yargote/artifacts-contracts', '@yargote/artifacts-client', '@yargote/artifacts-cli'] as const;
const registry = 'https://registry.npmjs.org';
const betaVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.(0|[1-9]\d*)$/;
export function assertBetaNotLatest(version: string, latest: string | null): void {
  assert.notEqual(latest, version, 'The beta release must not be tagged latest');
}
const bootstrapVersion = '0.0.0-stage';
export function bootstrapLatestAction(input: { name: string; version: string; initialLatest: string | null; latest: string | null; recorded: boolean; placeholder: unknown }): 'unchanged' | 'restore' | 'record' {
  const { name, version, initialLatest, latest, recorded, placeholder } = input;
  if (!recorded && latest === initialLatest) {
    assertBetaNotLatest(version, latest);
    return 'unchanged';
  }
  assert.equal(initialLatest, null, 'latest changed since release snapshot');
  assert.ok(placeholder && typeof placeholder === 'object', 'Registry bootstrap placeholder is missing');
  const stub = placeholder as Record<string, unknown>;
  assert.equal(stub.name, name, 'Registry bootstrap placeholder name differs');
  assert.equal(stub.version, bootstrapVersion, 'Registry bootstrap placeholder version differs');
  assert.equal(stub.stub, true, 'Registry bootstrap placeholder must be marked stub');
  if (recorded) {
    assert.equal(latest, bootstrapVersion, 'latest changed after bootstrap normalization');
    return 'unchanged';
  }
  if (latest === bootstrapVersion) return 'record';
  assert.equal(latest, version, 'latest changed since release snapshot');
  return 'restore';
}
function targets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value === null) return [];
  assert.ok(value && typeof value === 'object', 'Exports must contain paths or conditions');
  return Object.values(value).flatMap(targets);
}
export async function verifyRelease(inventory: PackageInventory, output = packageOutput): Promise<void> {
  assert.equal(inventory.profile, undefined, 'Native-fixed inventories are private and cannot be published');
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
    assert.deepEqual(actual.manifest.artifactsSkills, source.artifactsSkills, 'Published skills selection must preserve the source declaration');
    assert.deepEqual(actual.manifest.files, ['src', 'README.md', 'LICENSE', ...(source.artifactsSkills ? ['skills'] : [])], 'Published files must preserve the approved package contents');
    for (const key of ['description', 'license', 'repository', 'homepage', 'bugs'] as const) assert.deepEqual(actual.manifest[key], source[key], `Published ${key} differs from source`);
    const expectedDependencies = Object.fromEntries(Object.entries(source.dependencies ?? {}).map(([name, version]) => [name, version.startsWith('workspace:') ? byName.get(name)?.version : version]));
    assert.deepEqual(packed.dependencies, expectedDependencies, 'Published dependencies must preserve source dependency edges');
    assert.deepEqual(actual.manifest.publishConfig, { access: 'public', tag: 'beta', provenance: false });
    const paths = new Set(actual.files.map((file) => file.path));
    for (const required of ['README.md', 'LICENSE', 'package.json']) assert.ok(paths.has(required), `${packed.name} must include ${required}`);
    const license = actual.files.find((file) => file.path === 'LICENSE')!.bytes;
    assert.deepEqual(license, await readFile(resolve(root, packed.directory, 'LICENSE')), 'Published LICENSE differs from the approved package license');
    assert.match(license.toString('utf8'), /MIT License/);
    const skillFiles = await bundledSkillFiles(source);
    for (const [path, bytes] of skillFiles) {
      const file = actual.files.find((entry) => entry.path === path);
      assert.ok(file, `Missing bundled skill file ${path}`);
      assert.deepEqual(file.bytes, bytes, `Bundled skill file differs from source at ${path}`);
    }
    for (const file of actual.files) {
      if (skillFiles.has(file.path)) continue;
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
async function metadata(name: string, timeoutMs = 30_000): Promise<{ 'dist-tags'?: Record<string, string>; versions?: Record<string, { name?: string; version?: string; stub?: boolean; dist: { integrity: string; tarball: string } }> } | undefined> {
  const response = await fetch(`${registry}/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Registry metadata failed with HTTP ${response.status}`);
  return response.json();
}
export async function waitForBootstrapTags(name: string, version: string, options: { timeoutMs?: number; intervalMs?: number } = {}): Promise<Record<string, string>> {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  do {
    const tags = (await metadata(name, Math.max(1, Math.min(10_000, deadline - Date.now()))))?.['dist-tags'];
    if (tags?.beta !== undefined) assert.equal(tags.beta, version, `beta does not identify ${name}@${version}`);
    if (tags?.latest !== undefined) assert.ok(tags.latest === version || tags.latest === bootstrapVersion, 'latest changed during bootstrap normalization');
    if (tags?.beta === version && tags.latest === bootstrapVersion) return tags;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(options.intervalMs ?? 1_000, remaining)));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for npm bootstrap tags of ${name}@${version}`);
}
export async function publishedBytes(name: string, version: string, integrity: string, options: { timeoutMs?: number; intervalMs?: number } = {}): Promise<void> {
  const started = Date.now();
  const deadline = started + (options.timeoutMs ?? 20 * 60_000);
  const requestTimeout = () => Math.max(1, Math.min(10_000, deadline - Date.now()));
  do {
    const value = await metadata(name, requestTimeout());
    const dist = value?.versions?.[version]?.dist;
    if (dist) {
      assert.equal(dist.integrity, integrity, `Existing ${name}@${version} differs from inspected tarball`);
      assert.equal(new URL(dist.tarball).origin, registry, 'Tarball must come from the npm registry');
      const response = await fetch(dist.tarball, { signal: AbortSignal.timeout(requestTimeout()) });
      if (response.status !== 404) {
        assert.ok(response.ok, `Cannot download ${name}@${version}, HTTP ${response.status}`);
        const { createHash } = await import('node:crypto');
        const downloaded = `sha512-${createHash('sha512').update(Buffer.from(await response.arrayBuffer())).digest('base64')}`;
        assert.equal(downloaded, integrity, `Downloaded ${name}@${version} differs from inspected tarball`);
        return;
      }
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    console.log(`Waiting for npm availability of ${name}@${version} (${Math.floor((Date.now() - started) / 1_000)}s elapsed)`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(options.intervalMs ?? 10_000, remaining)));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for npm availability of ${name}@${version}`);
}
async function runNpm(args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('npm', args, { stdio: 'inherit', timeout: 180_000 });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`npm ${args[0]} failed (${code})`)));
  });
}
export async function publishRelease(inventory: PackageInventory, output = packageOutput): Promise<void> {
  await verifyRelease(inventory, output);
  const statePath = resolve(output, 'publication-state.json');
  const entries = publicNames.map((name) => inventory.packages.find((item) => item.name === name)!);
  let state: { versions: Record<string, string>; latest: Record<string, string | null>; submitted?: string[]; bootstrapLatest?: string[] };
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
  const submitted = state.submitted ??= [];
  const bootstrapLatest = state.bootstrapLatest ??= [];
  for (const name of submitted) assert.ok(entries.some((item) => item.name === name), 'Submitted package is outside the release');
  for (const name of bootstrapLatest) {
    assert.ok(entries.some((item) => item.name === name), 'Bootstrap package is outside the release');
    assert.equal(state.latest[name], null, 'Bootstrap normalization requires an initially absent latest');
  }
  for (const item of entries) assertBetaNotLatest(item.version, state.latest[item.name]);
  for (const item of entries) {
    const before = await metadata(item.name);
    const existing = before?.versions?.[item.version];
    if (!existing && !submitted.includes(item.name)) {
      assertBetaNotLatest(item.version, before?.['dist-tags']?.latest ?? null);
      assert.equal(before?.['dist-tags']?.latest ?? null, state.latest[item.name], 'latest changed since release snapshot');
      await runNpm(['publish', resolve(output, item.tarball), '--registry', registry, '--access', 'public', '--tag', 'beta', '--provenance=false', '--ignore-scripts']);
      submitted.push(item.name);
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    }
    await publishedBytes(item.name, item.version, item.integrity);
    const published = await metadata(item.name);
    let tags = published?.['dist-tags'];
    assert.equal(tags?.beta, item.version, `beta does not identify ${item.name}@${item.version}`);
    const action = bootstrapLatestAction({ name: item.name, version: item.version, initialLatest: state.latest[item.name], latest: tags?.latest ?? null, recorded: bootstrapLatest.includes(item.name), placeholder: published?.versions?.[bootstrapVersion] });
    if (action === 'restore') {
      await runNpm(['dist-tag', 'add', `${item.name}@${bootstrapVersion}`, 'latest', '--registry', registry]);
      tags = await waitForBootstrapTags(item.name, item.version);
    }
    const expectedLatest = bootstrapLatest.includes(item.name) || action !== 'unchanged' ? bootstrapVersion : state.latest[item.name];
    assert.equal(tags?.beta, item.version, `beta does not identify ${item.name}@${item.version}`);
    assertBetaNotLatest(item.version, tags?.latest ?? null);
    assert.equal(tags?.latest ?? null, expectedLatest, 'Publication changed latest');
    if (action !== 'unchanged') {
      bootstrapLatest.push(item.name);
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    }
    console.log(JSON.stringify({ name: item.name, version: item.version, integrity: item.integrity, beta: tags?.beta, latest: tags?.latest ?? null, downloaded: true }));
  }
  for (const item of entries) {
    const latest = (await metadata(item.name))?.['dist-tags']?.latest ?? null;
    assertBetaNotLatest(item.version, latest);
    assert.equal(latest, bootstrapLatest.includes(item.name) ? bootstrapVersion : state.latest[item.name], 'Publication changed latest');
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
