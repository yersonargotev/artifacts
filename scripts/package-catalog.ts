import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'fflate';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const packageOutput = resolve(root, 'dist/packages');
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
export interface PackageInventory { packages: PackedPackage[] }
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
