import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { packageOutput, readInventory, root } from '../scripts/package-catalog.ts';
import { restCliFixture } from './rest-cli-fixture.ts';

const packages = (await readInventory()).packages.filter((item) => item.public);
assert.equal(packages.length, 3, 'The public release contains exactly three packages');
const cli = packages.find((item) => item.directory === 'apps/cli');
assert(cli, 'The public release contains the CLI');
const browser = process.env.ARTIFACTS_CHROME_EXECUTABLE;
assert(!browser || isAbsolute(browser), 'ARTIFACTS_CHROME_EXECUTABLE is an absolute executable path');
const directory = await mkdtemp(join(tmpdir(), 'artifacts-first-use-consumer-'));
const environment = { PATH: process.env.PATH, HOME: directory, TMPDIR: tmpdir(), npm_config_cache: join(directory, 'npm-cache') };
let app: Awaited<ReturnType<typeof restCliFixture>> | undefined;

async function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = environment): Promise<string> {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), 11 * 60_000);
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', () => { clearTimeout(timeout); reject(new Error('First-use proof subprocess could not start')); });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) done(stdout);
      else reject(new Error(`First-use proof subprocess failed (${code}). ${command === process.execPath ? stderr : 'Check npm installation.'}`));
    });
  });
}

try {
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'artifacts-first-use-consumer', private: true, type: 'module' }));
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...packages.map((item) => resolve(packageOutput, item.tarball))], directory);
  const binary = join(directory, 'node_modules/.bin/artifacts');
  assert.equal((await run(binary, ['--version'], directory)).trim(), cli.version);
  for (const scenario of ['split', 'shared'] as const) {
    app = await restCliFixture({ apiResource: scenario === 'split' });
    const source = app.config.resource;
    const target = app.config.apiResource ?? source;
    const metadataPath = `/.well-known/oauth-protected-resource${new URL(source).pathname}`;
    const targetMetadataPath = `/.well-known/oauth-protected-resource${new URL(target).pathname === '/' ? '' : new URL(target).pathname}`;
    const report = resolve(root, `.test-artifacts/npm-beta/first-use-fixture-${scenario}.json`);
    let sourceReads = 0;
    let anonymousIdentity = 0;
    let authenticatedIdentity = 0;
    const grantResources: (string | null)[] = [];
    const issuer = app.config.issuer;
    const resourceHandler = app.resourceHandler;
    const authHandler = app.authHandler;
    app.setAuthHandler(async (request) => {
      if (new URL(request.url).pathname.endsWith('/oauth2/token')) {
        const body = new URLSearchParams(await request.clone().text());
        if (body.get('grant_type') === 'authorization_code') grantResources.push(body.get('resource'));
      }
      return authHandler(request);
    });
    app.setResourceHandler(async (request) => {
      const path = new URL(request.url).pathname;
      if (path === metadataPath || path === targetMetadataPath) {
        assert.equal(request.headers.get('authorization'), null);
        assert.equal(request.headers.get('cookie'), null);
        if (path === metadataPath) sourceReads++;
        if (scenario === 'shared') {
          return Response.json({ resource: target, authorization_servers: [issuer], artifacts_rest_resource: target });
        }
      }
      if (path === `${new URL(target).pathname.replace(/\/$/, '')}/v1/identity`) {
        assert.equal(request.headers.get('cookie'), null);
        if (request.headers.has('authorization')) authenticatedIdentity++;
        else anonymousIdentity++;
      }
      return resourceHandler(request);
    });
    await rm(report, { force: true });
    const output = await run(process.execPath, [
      '--import', 'tsx', resolve(root, 'scripts/verify-cli-first-use.ts'),
      '--binary', binary, '--server', target, '--login-server', source,
      '--expected-version', cli.version, '--report', report, '--panel', app.dashboard,
      ...(browser ? ['--browser-executable', browser] : []),
    ], root, { ...environment, OWNER_EMAIL: 'owner@example.test', OWNER_PASSWORD: app.password });
    const evidence = JSON.parse(await readFile(report, 'utf8')) as { status: string; version: string; checks: string[] };
    assert.equal(evidence.status, 'passed');
    assert.equal(evidence.version, cli.version);
    assert.equal(sourceReads, scenario === 'shared' ? 2 : 1, 'The expected source metadata requests were made');
    assert.equal(grantResources[0], target);
    assert.equal(anonymousIdentity, 2);
    assert(authenticatedIdentity >= 2, 'Login and fresh whoami verified identity');
    for (const check of [
      'native-browser-consent-and-persisted-whoami',
      'bare-whoami-uses-saved-rest-resource',
      ...(scenario === 'split' ? ['mcp-started-rest-identity'] : []),
      'create-list-read',
      'update-edit-and-three-revision-history',
      'historical-publication-and-exact-retained-replays',
      'identical-historical-zip-and-sha256',
      'protected-publication-renders-original-revision',
      'create-with-project-filter-list-and-move',
      'panel-sidebar-groups-moved-artifact',
      'remove-from-project-leaves-no-verification-project',
      'own-credential-logout-and-denied-whoami',
    ]) assert(evidence.checks.includes(check), `First-use harness proves ${check}`);
    process.stdout.write(output);
    process.stdout.write(`Installed public tarballs passed the ${scenario} first-use scenario.\n`);
    await app.close();
    app = undefined;
  }
} finally {
  try { await app?.close(); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
