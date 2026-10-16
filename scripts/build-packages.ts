import { spawn } from 'node:child_process';
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { inspectTarball, packageDefinitions, packageOutput, root, type PackageInventory, type PackageManifest } from './package-catalog.ts';

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
await rm(packageOutput, { recursive: true, force: true });
await mkdir(tarballs, { recursive: true });
const config = join(packageOutput, 'tsconfig.json');
await writeFile(config, JSON.stringify({
  extends: join(root, 'tsconfig.json'),
  compilerOptions: { noEmit: false, declaration: true, rewriteRelativeImportExtensions: true, rootDir: root, outDir: compiled },
  include: packageDefinitions.map((definition) => join(root, definition.directory, 'src/**/*.ts')),
  exclude: [],
}, null, 2));
process.stdout.write(await run('pnpm', ['exec', 'tsc', '--project', config]));
const inventory: PackageInventory = { packages: [] };
const rewrite = (value: unknown): unknown => typeof value === 'string' ? value.replace(/\.ts$/, '.js') : value === null ? null : Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, rewrite(child)]));
for (const source of sources) {
  const original = source.manifest;
  const directory = join(packageOutput, basename(source.directory));
  await mkdir(directory, { recursive: true });
  await cp(join(compiled, source.directory, 'src'), join(directory, 'src'), { recursive: true });
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
    files: ['src', 'README.md', 'LICENSE'], dependencies,
    ...(source.public ? { publishConfig: { access: 'public', tag: 'beta', provenance: false } } : {}),
  };
  await writeFile(join(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of ['README.md', 'LICENSE']) {
    try { await cp(join(root, source.directory, file), join(directory, file)); }
    catch (error) { if (source.public || !(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  }
  for (const bin of Object.values(manifest.bin ?? {})) await chmod(join(directory, bin), 0o755);
  const [packed] = JSON.parse(await run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', tarballs], directory)) as { filename: string }[];
  const tarball = join(tarballs, packed.filename);
  const inspected = await inspectTarball(tarball);
  inventory.packages.push({ name, version: manifest.version!, directory: source.directory, public: source.public, tarball: relative(packageOutput, tarball), integrity: inspected.integrity, shasum: inspected.shasum, files: inspected.files.map((file) => file.path).sort(), dependencies });
}
await writeFile(join(packageOutput, 'manifest.json'), `${JSON.stringify(inventory, null, 2)}\n`);
console.log(`Compiled ${inventory.packages.length} packages. Inventory is ${join(packageOutput, 'manifest.json')}`);
