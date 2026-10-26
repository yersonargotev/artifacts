import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { chmod, cp, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { bundledSkillFiles, inspectTarball, packageDefinitions, packageOutput as portableOutput, nativePackageOutput, root, verifyNativeInventory, type PackageInventory, type PackageManifest, type NativeProfile } from './package-catalog.ts';

const { values } = parseArgs({ options: { out: { type: 'string' }, 'native-fixed': { type: 'boolean' } } });
const defaultOutput = values['native-fixed'] ? nativePackageOutput : portableOutput;
if (values.out !== undefined && !isAbsolute(values.out)) throw new Error('--out requires an absolute new directory');
const packageOutput = values.out ?? defaultOutput;
if (values.out !== undefined) await mkdir(packageOutput, { mode: 0o700 });

const compiled = join(packageOutput, 'compiled');
const tarballs = join(packageOutput, 'tarballs');
async function run(command: string, args: string[], cwd = root): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], timeout: 180_000 });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve(stdout) : reject(new Error(`${command} exited with ${code}`)));
  });
}
const sources = await Promise.all(packageDefinitions.map(async (definition) => ({ ...definition, manifest: JSON.parse(await readFile(join(root, definition.directory, 'package.json'), 'utf8')) as PackageManifest })));
const byName = new Map(sources.map((source) => [source.manifest.name, source]));
if (values.out === undefined) await rm(packageOutput, { recursive: true, force: true });
await mkdir(tarballs, { recursive: true });
const config = join(packageOutput, 'tsconfig.json');
await writeFile(config, JSON.stringify({
  extends: join(root, 'tsconfig.json'),
  compilerOptions: { noEmit: false, declaration: true, rewriteRelativeImportExtensions: true, rootDir: root, outDir: compiled, typeRoots: [join(root, 'node_modules/@types')] },
  include: packageDefinitions.map((definition) => join(root, definition.directory, 'src/**/*.ts')),
  exclude: [],
}, null, 2));
process.stdout.write(await run('pnpm', ['exec', 'tsc', '--project', config]));
const inventory: PackageInventory = { packages: [] };
if (values['native-fixed']) process.stdout.write(await run(process.execPath, ['scripts/prepare-native.mjs', '--check']));
async function stageNative(directory: string): Promise<NativeProfile> {
  const modules = join(directory, 'node_modules');
  const versions = new Map<string, string>();
  async function locate(name: string, parent: string): Promise<string> {
    const paths = createRequire(join(parent, 'package.json')).resolve.paths(name);
    for (const path of paths ?? []) {
      try {
        const candidate = join(path, name);
        const manifest = JSON.parse(await readFile(join(candidate, 'package.json'), 'utf8')) as PackageManifest;
        if (manifest.name === name) return realpath(candidate);
      } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    }
    throw new Error(`Cannot resolve native dependency ${name} from ${parent}`);
  }
  async function stage(name: string, parent: string): Promise<void> {
    const source = await locate(name, parent);
    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as PackageManifest;
    assert.ok(manifest.version);
    if (versions.has(name)) {
      assert.equal(versions.get(name), manifest.version, `Native dependency has conflicting versions: ${name}`);
      return;
    }
    versions.set(name, manifest.version);
    await cp(source, join(modules, name), { recursive: true, dereference: true, filter: (path) => !relative(source, path).split('/').includes('node_modules') });
    for (const dependency of Object.keys(manifest.dependencies ?? {})) await stage(dependency, source);
  }
  await stage('@libsql/client', join(root, 'packages/db'));
  await stage('drizzle-orm', join(root, 'packages/db'));
  const hashes: Record<string, string> = {};
  async function hashFiles(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await hashFiles(file);
      else {
        assert.ok(entry.isFile(), `Native bundle contains a non-regular file: ${file}`);
        hashes[relative(directory, file)] = createHash('sha256').update(await readFile(file)).digest('hex');
      }
    }
  }
  await hashFiles(modules);
  const provenanceBytes = await readFile(join(modules, 'libsql/provenance.json'));
  const provenance = JSON.parse(provenanceBytes.toString('utf8')) as { target: NativeProfile['target']; binarySha256: string };
  assert.equal(hashes['node_modules/libsql/index.node'], provenance.binarySha256);
  assert.equal(versions.get('@libsql/client'), '0.18.0');
  return { kind: 'native-fixed', target: provenance.target, binarySha256: provenance.binarySha256, provenanceSha256: createHash('sha256').update(provenanceBytes).digest('hex'), files: hashes };
}
const rewrite = (value: unknown): unknown => typeof value === 'string' ? value.replace(/\.ts$/, '.js') : value === null ? null : Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, rewrite(child)]));
for (const source of sources) {
  const original = source.manifest;
  const directory = join(packageOutput, basename(source.directory));
  await mkdir(directory, { recursive: true });
  await cp(join(compiled, source.directory, 'src'), join(directory, 'src'), { recursive: true });
  for (const [path, bytes] of await bundledSkillFiles(original)) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), bytes);
  }
  const dependencies = Object.fromEntries(Object.entries(original.dependencies ?? {}).map(([name, version]) => {
    if (!version.startsWith('workspace:')) return [name, version];
    const target = byName.get(name);
    if (!target) throw new Error(`Unknown workspace dependency ${name}`);
    if (source.public && !target.public) throw new Error(`Public package ${original.name} depends on private ${name}`);
    return [name, target.manifest.version ?? '0.1.0'];
  }));
  const { name, description, license, repository, homepage, bugs, engines } = original;
  const manifest: PackageManifest & { files: string[] } = {
    name, version: original.version ?? '0.1.0', private: !source.public, type: 'module', description, license, repository, homepage, bugs,
    engines: engines ?? { node: '>=24' },
    ...(original.exports ? { exports: rewrite(original.exports) } : {}),
    ...(original.bin ? { bin: rewrite(original.bin) as Record<string, string> } : {}),
    files: ['src', 'README.md', 'LICENSE', ...(original.artifactsSkills ? ['skills'] : [])], dependencies,
    ...(original.artifactsSkills ? { artifactsSkills: original.artifactsSkills } : {}),
    ...(source.public ? { publishConfig: { access: 'public', tag: 'beta', provenance: false } } : {}),
  };
  if (values['native-fixed'] && name === '@artifacts/db') {
    inventory.profile = await stageNative(directory);
    const profile = inventory.profile;
    Object.assign(manifest, { bundledDependencies: ['@libsql/client', 'drizzle-orm'], os: [profile.target.os], cpu: [profile.target.cpu], ...(profile.target.libc ? { libc: [profile.target.libc] } : {}), artifactsNative: { profile: 'native-fixed', target: profile.target.name, binarySha256: profile.binarySha256 } });
  }
  await writeFile(join(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of ['README.md', 'LICENSE']) {
    try { await cp(join(root, source.directory, file), join(directory, file)); }
    catch (error) { if (source.public || !(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  }
  for (const bin of Object.values(manifest.bin ?? {})) await chmod(join(directory, bin), 0o755);
  const [packed] = JSON.parse(await run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', tarballs], directory)) as { filename: string }[];
  const target = values['native-fixed'] && !source.public
    ? JSON.parse(await readFile(join(root, '.native/libsql/provenance.json'), 'utf8')) as { target: NativeProfile['target'] }
    : undefined;
  const filename = target ? packed.filename.replace(/\.tgz$/, `-native-fixed-${target.target.name}.tgz`) : packed.filename;
  const tarball = join(tarballs, filename);
  if (filename !== packed.filename) await rename(join(tarballs, packed.filename), tarball);
  const inspected = await inspectTarball(tarball);
  inventory.packages.push({ name, version: manifest.version!, directory: source.directory, public: source.public, tarball: relative(packageOutput, tarball), integrity: inspected.integrity, shasum: inspected.shasum, files: inspected.files.map((file) => file.path).sort(), dependencies });
}
if (inventory.profile) await verifyNativeInventory(inventory, packageOutput);
await writeFile(join(packageOutput, 'manifest.json'), `${JSON.stringify(inventory, null, 2)}\n`);
console.log(`Compiled ${inventory.packages.length} packages. Inventory is ${join(packageOutput, 'manifest.json')}`);
