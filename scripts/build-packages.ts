import { spawn } from 'node:child_process';
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'dist/packages');
const compiled = join(output, 'compiled');
const tarballs = join(output, 'tarballs');
const names = ['config', 'db', 'contracts', 'artifacts', 'rest', 'client', 'cli'];
const source = (name: string) => join(root, name === 'cli' ? 'apps' : 'packages', name);
async function run(command: string, args: string[], cwd = root) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}
await rm(output, { recursive: true, force: true });
await mkdir(tarballs, { recursive: true });
const config = join(output, 'tsconfig.json');
await writeFile(config, JSON.stringify({
  extends: join(root, 'tsconfig.json'),
  compilerOptions: { noEmit: false, declaration: true, rewriteRelativeImportExtensions: true, rootDir: root, outDir: compiled },
  include: names.flatMap((name) => name === 'cli' ? [join(source(name), 'src/index.ts')] : [join(source(name), 'src/index.ts'), ...(name === 'contracts' ? ['workflow', 'serialization', 'http'].map((file) => join(source(name), `src/${file}.ts`)) : name === 'artifacts' ? [join(source(name), 'src/workflow.ts')] : [])]),
  exclude: [],
}, null, 2));
await run('pnpm', ['exec', 'tsc', '--project', config]);
for (const name of names) {
  const directory = join(output, name);
  await mkdir(directory, { recursive: true });
  await cp(join(compiled, name === 'cli' ? 'apps' : 'packages', name, 'src'), join(directory, 'src'), { recursive: true });
  const original = JSON.parse(await readFile(join(source(name), 'package.json'), 'utf8'));
  const dependencies = Object.fromEntries(Object.entries(original.dependencies ?? {}).map(([key, value]) => [key, typeof value === 'string' && value.startsWith('workspace:') ? '0.1.0' : value]));
  const rewrite = (value: unknown): unknown => typeof value === 'string' ? value.replace(/\.ts$/, '.js') : Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, rewrite(child)]));
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: original.name, version: '0.1.0', type: 'module', engines: { node: '>=24' }, ...(original.exports ? { exports: rewrite(original.exports) } : {}), ...(original.bin ? { bin: rewrite(original.bin) } : {}), files: ['src', 'README.md'], dependencies }, null, 2) + '\n');
  try { await cp(join(source(name), 'README.md'), join(directory, 'README.md')); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  if (name === 'cli') await chmod(join(directory, 'src/index.js'), 0o755);
  await run('pnpm', ['pack', '--pack-destination', tarballs], directory);
}
console.log(`Compiled packages and tarballs are in ${output}`);
