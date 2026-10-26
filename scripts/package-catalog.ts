import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'fflate';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const packageOutput = resolve(root, 'dist/packages');
export const nativePackageOutput = resolve(root, 'dist/packages-native-fixed');
export const packageDefinitions = [
  { directory: 'packages/config', public: false },
  { directory: 'packages/db', public: false },
  { directory: 'packages/contracts', public: true },
  { directory: 'packages/artifacts', public: false },
  { directory: 'packages/rest', public: false },
  { directory: 'packages/client', public: true },
  { directory: 'apps/cli', public: true },
] as const;
export interface PackageManifest {
  name: string;
  version?: string;
  private?: boolean;
  type?: string;
  license?: string;
  description?: string;
  repository?: unknown;
  homepage?: string;
  bugs?: unknown;
  engines?: Record<string, string>;
  exports?: unknown;
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  artifactsSkills?: string[];
  bundledDependencies?: string[];
  os?: string[];
  cpu?: string[];
  libc?: string[];
  artifactsNative?: { profile: 'native-fixed'; target: string; binarySha256: string };
  files?: string[];
  publishConfig?: { access: string; tag: string; provenance: boolean };
}
export interface PackedPackage {
  name: string;
  version: string;
  public: boolean;
  directory: string;
  tarball: string;
  integrity: string;
  shasum: string;
  files: string[];
  dependencies: Record<string, string>;
}
export interface NativeTarget {
  name: string;
  os: string;
  cpu: string;
  libc?: string;
  napi: number;
  glibc?: string;
  minimumOs?: string;
  rust: string;
  library: string;
}
export interface NativeProfile {
  kind: 'native-fixed';
  target: NativeTarget;
  binarySha256: string;
  provenanceSha256: string;
  files: Record<string, string>;
}
export interface PackageInventory { packages: PackedPackage[]; profile?: NativeProfile }
export interface TarMember { path: string; mode: number; bytes: Buffer }
export async function bundledSkillFiles(manifest: PackageManifest): Promise<Map<string, Buffer>> {
  const names = manifest.artifactsSkills ?? [];
  if (!Array.isArray(names) || names.some((name) => typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) || new Set(names).size !== names.length) throw new Error('Invalid bundled skills declaration');
  const files = new Map<string, Buffer>();
  async function visit(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await visit(resolve(directory, entry.name), path);
      else if (entry.isFile()) files.set(path, await readFile(resolve(directory, entry.name)));
      else throw new Error(`Bundled skill contains a non-regular file at ${path}`);
    }
  }
  for (const name of names) {
    await visit(resolve(root, 'skills', name), `skills/${name}`);
    if (!files.has(`skills/${name}/SKILL.md`)) throw new Error(`Bundled skill ${name} has no SKILL.md`);
  }
  return files;
}
export async function inspectTarball(path: string) {
  const bytes = await readFile(path);
  const tar = Buffer.from(gunzipSync(bytes));
  const files: TarMember[] = [];
  const text = (offset: number, length: number) => tar.subarray(offset, offset + length).toString('utf8').replace(/\0.*$/s, '');
  for (let offset = 0; offset + 512 <= tar.length; ) {
    if (tar.subarray(offset, offset + 512).every((byte) => byte === 0)) break;
    const name = text(offset, 100);
    const prefix = text(offset + 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(text(offset + 124, 12).trim(), 8) || 0;
    const mode = Number.parseInt(text(offset + 100, 8).trim(), 8) || 0;
    const kind = text(offset + 156, 1);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('Invalid tar member size');
    if (kind !== '0' && kind !== '') throw new Error(`Unexpected tar member type ${kind} at ${path}`);
    if (!path.startsWith('package/') || path.split('/').includes('..') || files.some((file) => file.path === path)) throw new Error(`Unsafe tar member ${path}`);
    files.push({ path: path.slice('package/'.length), mode, bytes: tar.subarray(offset + 512, offset + 512 + size) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  const manifestFile = files.find((file) => file.path === 'package.json');
  if (!manifestFile) throw new Error('Tarball has no package.json');
  const manifest = JSON.parse(manifestFile.bytes.toString('utf8')) as PackageManifest;
  return { manifest, files, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`, shasum: createHash('sha1').update(bytes).digest('hex') };
}
export async function readInventory(path = resolve(packageOutput, 'manifest.json')): Promise<PackageInventory> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageInventory;
}

export async function verifyNativeInventory(inventory: PackageInventory, output = nativePackageOutput): Promise<void> {
  const profile = inventory.profile;
  assert.equal(profile?.kind, 'native-fixed', 'A native-fixed inventory is required');
  assert.ok(profile);
  assert.deepEqual(inventory.packages.map((item) => item.directory).sort(), packageDefinitions.map((item) => item.directory).sort());
  assert.equal(new Set(inventory.packages.map((item) => item.name)).size, packageDefinitions.length);
  for (const item of inventory.packages) {
    const tarball = resolve(output, item.tarball);
    assert.ok(tarball.startsWith(`${resolve(output)}/tarballs/`), 'Private tarball must remain inside its output directory');
    const actual = await inspectTarball(tarball);
    assert.equal(actual.integrity, item.integrity);
    assert.equal(actual.shasum, item.shasum);
    assert.equal(actual.manifest.name, item.name);
    assert.equal(actual.manifest.version, item.version);
    assert.deepEqual(actual.manifest.dependencies, item.dependencies);
    assert.deepEqual(actual.files.map((file) => file.path).sort(), item.files);
    assert.equal(item.public, packageDefinitions.find((definition) => definition.directory === item.directory)?.public);
    assert.equal(actual.manifest.private, !item.public);
    if (item.name !== '@artifacts/db') {
      assert.equal(actual.files.some((file) => file.path.startsWith('node_modules/')), false, 'Only the private DB package bundles the server native graph');
      continue;
    }
    assert.ok(item.tarball.includes(`native-fixed-${profile.target.name}`), 'Native tarball must name its target');
    assert.deepEqual(actual.manifest.os, [profile.target.os]);
    assert.deepEqual(actual.manifest.cpu, [profile.target.cpu]);
    assert.deepEqual(actual.manifest.libc, profile.target.libc ? [profile.target.libc] : undefined);
    assert.deepEqual(actual.manifest.bundledDependencies, ['@libsql/client', 'drizzle-orm']);
    assert.deepEqual(actual.manifest.artifactsNative, { profile: 'native-fixed', target: profile.target.name, binarySha256: profile.binarySha256 });
    const bundled = Object.fromEntries(actual.files.filter((file) => file.path.startsWith('node_modules/')).map((file) => [file.path, createHash('sha256').update(file.bytes).digest('hex')]));
    assert.deepEqual(bundled, profile.files, 'Packed runtime graph differs from the staged native graph');
    const bytes = (path: string) => {
      const member = actual.files.find((file) => file.path === path);
      assert.ok(member, `Native bundle is missing ${path}`);
      return member.bytes;
    };
    const sdkFiles = JSON.parse(await readFile(resolve(root, 'native/libsql/sdk-files.json'), 'utf8')) as Record<string, string>;
    const actualSdk = Object.fromEntries(Object.entries(bundled).filter(([path]) => path.startsWith('node_modules/@libsql/client/')).map(([path, hash]) => [path.slice('node_modules/@libsql/client/'.length), hash]));
    assert.deepEqual(actualSdk, sdkFiles, 'Bundled SDK bytes differ from official 0.18.0');
    assert.equal(bundled['node_modules/libsql/index.node'], profile.binarySha256);
    assert.equal(bundled['node_modules/libsql/provenance.json'], profile.provenanceSha256);
    const provenance = JSON.parse(bytes('node_modules/libsql/provenance.json').toString('utf8')) as { inputs: unknown; target: NativeTarget; binarySha256: string; files: Record<string, string> };
    assert.deepEqual(provenance.inputs, JSON.parse(await readFile(resolve(root, 'native/libsql/inputs.json'), 'utf8')));
    assert.deepEqual(provenance.target, profile.target);
    assert.equal(provenance.binarySha256, profile.binarySha256);
    for (const [path, hash] of Object.entries(provenance.files)) assert.equal(bundled[`node_modules/libsql/${path}`], hash);
    for (const member of actual.files.filter((file) => file.path.startsWith('node_modules/') && file.path.endsWith('/package.json'))) {
      const manifest = JSON.parse(member.bytes.toString('utf8')) as PackageManifest;
      for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
        assert.doesNotMatch(version, /^(?:workspace:|file:|link:|https?:|git|\/|\.\.?\/)/, 'Native runtime dependencies must resolve within the bundle');
        const dependency = JSON.parse(bytes(`node_modules/${name}/package.json`).toString('utf8')) as PackageManifest;
        assert.equal(dependency.name, name);
      }
    }
  }
}
