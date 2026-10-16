import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readInventory, root } from './package-catalog.ts';
import { assertBetaNotLatest, publicNames } from './release-npm.ts';

const { values } = parseArgs({ options: { report: { type: 'string' }, keep: { type: 'boolean' } } });
const inventory = await readInventory();
const packages = publicNames.map((name) => {
  const packed = inventory.packages.find((item) => item.name === name && item.public);
  assert.ok(packed, `Missing release package ${name}`);
  return packed;
});
const cli = packages.find((item) => item.name === '@yargote/artifacts-cli')!;
const spec = `${cli.name}@${cli.version}`;
const temporary = await mkdtemp(join(tmpdir(), 'artifacts-npm-registry-'));
const evidence: { version: string; platform: string; node: string; npm?: string; pnpm?: string; status?: 'passed' | 'failed'; failure?: string; cases: { mode: string; version: string; help: boolean; command: string[] }[]; dependencies: { name: string; version: string; resolved: string; integrity: string }[]; registry: { name: string; version: string; beta: string; latest: string | null; integrity: string }[]; binary?: string; directory?: string } = { version: cli.version, platform: process.platform, node: process.version, cases: [], dependencies: [], registry: [] };
async function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolvePromise(stdout) : reject(new Error(`${command} ${args.join(' ')} failed (${code})\n${stdout}\n${stderr}`)));
  });
}
async function environment(name: string) {
  const directory = join(temporary, name);
  const home = join(directory, 'home');
  const prefix = join(directory, 'prefix');
  const pnpmHome = join(directory, 'pnpm-bin');
  await Promise.all([directory, home, prefix, pnpmHome].map((path) => mkdir(path, { recursive: true })));
  const config = join(directory, 'npmrc');
  const globalConfig = join(directory, 'global-npmrc');
  await Promise.all([config, globalConfig].map((path) => writeFile(path, '')));
  const path = (process.env.PATH ?? '').split(':').filter((entry) => entry && !entry.includes('node_modules') && !entry.startsWith(root));
  const env: NodeJS.ProcessEnv = {
    PATH: [join(prefix, 'bin'), join(pnpmHome, 'bin'), pnpmHome, dirname(process.execPath), ...path].join(':'), HOME: home,
    TMPDIR: directory, LANG: 'en_US.UTF-8', CI: 'true',
    XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local/share'),
    PNPM_HOME: pnpmHome, npm_config_registry: 'https://registry.npmjs.org/', npm_config_userconfig: config,
    npm_config_globalconfig: globalConfig, npm_config_cache: join(directory, 'npm-cache'), npm_config_prefix: prefix,
    npm_config_store_dir: join(directory, 'pnpm-store'), npm_config_update_notifier: 'false',
  };
  return { directory, prefix, pnpmHome, env };
}
async function probe(mode: string, command: string, args: string[], context: Awaited<ReturnType<typeof environment>>) {
  const version = (await run(command, [...args, '--version'], context.directory, context.env)).trim();
  assert.equal(version, cli.version, `${mode} must run the exact registry release`);
  const help = await run(command, [...args, '--help'], context.directory, context.env);
  assert.ok(help.startsWith('Usage: artifacts COMMAND [OPTIONS]'), `${mode} must show the CLI reference`);
  evidence.cases.push({ mode, version, help: true, command: [command, ...args] });
}
let passed = false;
try {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Registry verification requires Node 24 or newer');
  for (const packed of packages) {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packed.name)}`, { signal: AbortSignal.timeout(30_000) });
    assert.ok(response.ok, `Registry metadata is unavailable for ${packed.name}`);
    const metadata = await response.json() as { 'dist-tags': Record<string, string>; versions: Record<string, { dist: { integrity: string } }> };
    assert.equal(metadata['dist-tags'].beta, packed.version, 'The beta dist-tag must identify the inspected release');
    assertBetaNotLatest(packed.version, metadata['dist-tags'].latest ?? null);
    assert.equal(metadata.versions[packed.version]?.dist.integrity, packed.integrity, 'Registry bytes must match the inspected release');
    evidence.registry.push({ name: packed.name, version: packed.version, beta: metadata['dist-tags'].beta, latest: metadata['dist-tags'].latest ?? null, integrity: packed.integrity });
  }
  const npmGlobal = await environment('npm-global');
  evidence.npm = (await run('npm', ['--version'], npmGlobal.directory, npmGlobal.env)).trim();
  await run('npm', ['install', '--global', '--ignore-scripts', '--no-audit', '--no-fund', spec], npmGlobal.directory, npmGlobal.env);
  const binary = join(npmGlobal.prefix, 'bin/artifacts');
  await probe('npm global', binary, [], npmGlobal);
  evidence.binary = binary;
  const pnpmGlobal = await environment('pnpm-global');
  evidence.pnpm = (await run('pnpm', ['--version'], pnpmGlobal.directory, pnpmGlobal.env)).trim();
  await run('pnpm', ['add', '--global', '--ignore-scripts', '--store-dir', join(pnpmGlobal.directory, 'pnpm-store'), spec], pnpmGlobal.directory, pnpmGlobal.env);
  const pnpmBin = (await run('pnpm', ['bin', '--global'], pnpmGlobal.directory, pnpmGlobal.env)).trim();
  await probe('pnpm global', join(pnpmBin, 'artifacts'), [], pnpmGlobal);
  const npx = await environment('npx');
  await probe('npx', 'npx', ['--yes', spec], npx);
  const dlx = await environment('pnpm-dlx');
  await probe('pnpm dlx', 'pnpm', ['--store-dir', join(dlx.directory, 'pnpm-store'), 'dlx', spec], dlx);
  const consumer = await environment('consumer');
  await writeFile(join(consumer.directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', spec], consumer.directory, consumer.env);
  const lock = JSON.parse(await readFile(join(consumer.directory, 'package-lock.json'), 'utf8')) as { packages: Record<string, { name?: string; version: string; resolved?: string; integrity?: string; link?: boolean }> };
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    assert.equal(entry.link, undefined, `Registry consumer contains a link at ${path}`);
    assert.ok(entry.resolved?.startsWith('https://registry.npmjs.org/'), `Dependency at ${path} did not resolve from npm`);
    assert.ok(entry.integrity?.startsWith('sha512-'), `Dependency at ${path} has no registry integrity`);
  }
  for (const packed of packages) {
    const entry = lock.packages[`node_modules/${packed.name}`];
    assert.ok(entry, `Registry did not resolve ${packed.name}`);
    assert.equal(entry.version, packed.version);
    assert.equal(entry.integrity, packed.integrity);
    evidence.dependencies.push({ name: packed.name, version: entry.version, resolved: entry.resolved!, integrity: entry.integrity! });
  }
  await writeFile(join(consumer.directory, 'consumer.mjs'), `import assert from 'node:assert/strict';
import { createArtifactHttpClient } from '@yargote/artifacts-client';
import { createSchema } from '@yargote/artifacts-contracts';
import { canonicalResource } from '@yargote/artifacts-contracts/http';
import { prepareArtifactEdit } from '@yargote/artifacts-contracts/workflow';
assert.equal(typeof createArtifactHttpClient, 'function');
assert.equal(typeof createSchema.parse, 'function');
assert.equal(typeof prepareArtifactEdit, 'function');
assert.equal(canonicalResource('https://example.test/mcp'), 'https://example.test/mcp');
`);
  await run(process.execPath, ['consumer.mjs'], consumer.directory, consumer.env);
  await writeFile(join(consumer.directory, 'consumer.ts'), `import { createArtifactHttpClient, type ArtifactRead } from '@yargote/artifacts-client';
import { createSchema } from '@yargote/artifacts-contracts';
const client = createArtifactHttpClient({resource: 'https://example.test/mcp', accessToken: 'unused'});
const read: ArtifactRead = await client.read({artifactId: 'example'});
console.log(read.revision.snapshot.content.text, createSchema);
`);
  await run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2024', 'consumer.ts'], consumer.directory, consumer.env);
  if (values.keep) evidence.directory = temporary;
  else delete evidence.binary;
  evidence.status = 'passed';
  if (values.report) {
    await mkdir(dirname(resolve(values.report)), { recursive: true });
    await writeFile(resolve(values.report), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  console.log(JSON.stringify(evidence, null, 2));
  passed = true;
} catch (error) {
  evidence.status = 'failed';
  evidence.failure = error instanceof Error ? error.message : 'Registry verification failed';
  if (values.keep) evidence.directory = temporary;
  else delete evidence.binary;
  if (values.report) {
    await mkdir(dirname(resolve(values.report)), { recursive: true });
    await writeFile(resolve(values.report), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  throw error;
} finally {
  if (!values.keep) await rm(temporary, { recursive: true, force: true });
  else if (!passed) console.error(`Verification workspace retained at ${temporary}`);
}
