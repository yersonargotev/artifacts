import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import auth from '../apps/auth/cloudflare.config.ts';
import mcp from '../apps/mcp/cloudflare.config.ts';
import panel from '../apps/dashboard/cloudflare.config.ts';
import view from '../apps/publication/cloudflare.config.ts';

const services = { auth, mcp, panel, view };
type Service = keyof typeof services;
const root = fileURLToPath(new URL('..', import.meta.url));
const directories: Record<Service, string> = { auth: 'apps/auth', mcp: 'apps/mcp', panel: 'apps/dashboard', view: 'apps/publication' };
const selected = process.argv.slice(2);
if (selected.some((name) => !(name in services))) throw new Error('Select auth, mcp, panel, or view');
const names = selected.length ? selected : Object.keys(services);

export function assertWorkerDependencies(name: string, inputs: string[], imports: { path: string }[]) {
  if (inputs.some((path) => /(?:^|\/)(?:libsql@|(?:\.native|node_modules)\/libsql\/)|(?:^|\/)@libsql\/(?:darwin|linux|win32)|\.(?:node|dylib|so|dll)$|(?:^|\/)email-(?:sender-)?node[._-]/.test(path)) || imports.some((item) => /^node:(dns|https|fs)(\/|$)/.test(item.path))) {
    throw new Error(`${name} included a Node-only network, database, or file dependency`);
  }
}

if (import.meta.main) for (const name of names) {
  if (!(name === 'auth' || name === 'mcp' || name === 'panel' || name === 'view')) throw new Error('Unknown Worker');
  const { worker } = services[name];
  const directory = resolve(root, directories[name]);
  const output = resolve(root, 'dist/workers', name);
  const workerOutput = join(output, '.cloudflare/output/v0/workers/default');
  const bundle = join(workerOutput, 'bundle');
  await rm(output, { recursive: true, force: true });
  await mkdir(bundle, { recursive: true });
  let entrypoint = resolve(directory, worker.entrypoint);
  if (name === 'panel') {
    const configPath = join(directory, '.worker/wrangler.json');
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      name: worker.name,
      main: '@astrojs/cloudflare/entrypoints/server',
      compatibility_date: worker.compatibilityDate,
      compatibility_flags: worker.compatibilityFlags,
      vars: Object.fromEntries(Object.entries(worker.env).flatMap(([key, binding]) => binding.type === 'text' ? [[key, binding.value]] : [])),
      assets: { binding: 'ASSETS', directory: '../dist/client' },
    }, null, 2));
    await new Promise<void>((accept, reject) => {
      const child = spawn('pnpm', ['--filter', '@artifacts/dashboard', 'build'], { cwd: root, env: { ...process.env, ARTIFACTS_BUILD_TARGET: 'worker' }, stdio: 'inherit' });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? accept() : reject(new Error(`Panel Worker build exited with ${code}`)));
    });
    const deployment: unknown = JSON.parse(await readFile(join(directory, '.wrangler/deploy/config.json'), 'utf8'));
    if (!deployment || typeof deployment !== 'object' || !('configPath' in deployment) || typeof deployment.configPath !== 'string') throw new Error('Astro did not write the Worker deployment config');
    const runtimeConfigPath = resolve(directory, '.wrangler/deploy', deployment.configPath);
    const runtimeConfig: unknown = JSON.parse(await readFile(runtimeConfigPath, 'utf8'));
    if (!runtimeConfig || typeof runtimeConfig !== 'object' || !('main' in runtimeConfig) || typeof runtimeConfig.main !== 'string' || !('assets' in runtimeConfig) || !runtimeConfig.assets || typeof runtimeConfig.assets !== 'object' || !('directory' in runtimeConfig.assets) || typeof runtimeConfig.assets.directory !== 'string') throw new Error('Astro Worker output is incomplete');
    entrypoint = resolve(dirname(runtimeConfigPath), runtimeConfig.main);
    await cp(resolve(dirname(runtimeConfigPath), runtimeConfig.assets.directory), join(workerOutput, 'assets'), { recursive: true, dereference: true });
  }
  const result = await build({
    entryPoints: [entrypoint],
    outfile: join(bundle, 'worker.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    conditions: ['workerd', 'browser'],
    target: 'es2024',
    external: ['node:*', 'cloudflare:*'],
    metafile: true,
  });
  if (!result.metafile) throw new Error('Worker bundle evidence is missing');
  const inputs = Object.keys(result.metafile.inputs);
  const imports = Object.values(result.metafile.outputs).flatMap((file) => file.imports);
  assertWorkerDependencies(name, inputs, imports);
  const { entrypoint: _entrypoint, ...configuration } = worker;
  await writeFile(join(workerOutput, 'worker.config.json'), JSON.stringify({
    ...configuration,
    ...(name === 'panel' ? { env: { ...configuration.env, ASSETS: { type: 'assets' } }, assets: { runWorkerFirst: true } } : {}),
    manifest: { type: 'complete', mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm' } } },
  }, null, 2));
  await writeFile(join(output, '.cloudflare/output/v0/config.json'), JSON.stringify({ buildContext: { isPreview: false } }, null, 2));
  await writeFile(join(output, 'cloudflare.config.ts'), `export default ${JSON.stringify({ worker }, null, 2)};\n`);
  await writeFile(join(output, 'bundle-evidence.json'), JSON.stringify({ inputs, imports, bytes: Object.values(result.metafile.outputs).reduce((total, file) => total + file.bytes, 0) }, null, 2));
  console.log(`Built ${worker.name} in ${output}`);
}
