import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import auth from '../apps/auth/cloudflare.config.ts';
import mcp from '../apps/mcp/cloudflare.config.ts';
import panel from '../apps/dashboard/cloudflare.config.ts';
import view from '../apps/publication/cloudflare.config.ts';
import { projectRuntimeSecrets, releaseProduction, smokeProduction, verifyCloudflareAccount } from '../scripts/release-production.ts';
import { workerOrigins } from '../scripts/cloudflare.ts';
import { createPublicationApp } from '../apps/publication/src/http.ts';
import { createMcpApp } from '../apps/mcp/src/http.ts';
import { artifactErrorResponse, publicationReadSchema, publicationServiceAuthorized } from '../apps/dashboard/src/publication.ts';
import { createArtifactStore } from '../packages/artifacts/src/index.ts';
import { fixture } from './helpers.ts';

const services = { auth, mcp, panel, view };
const sha = 'a'.repeat(40);

function environment() {
  const secrets = Object.fromEntries(Object.values(services).flatMap(({ worker }) => Object.entries(worker.env).filter(([, binding]) => binding.type === 'secret').map(([name]) => [name, `${name}-${'x'.repeat(40)}`])));
  secrets.DATABASE_URL = 'libsql://database.example.test';
  secrets.OWNER_EMAIL = 'owner@example.test';
  secrets.EMAIL_FROM = 'invitations@example.test';
  return {
    CLOUDFLARE_API_TOKEN: 't'.repeat(40), CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), ARTIFACTS_RUNTIME_SECRETS: JSON.stringify(secrets),
    GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha, GITHUB_REPOSITORY: 'owner/artifacts', GITHUB_TOKEN: 'test-token',
  };
}

async function releaseFixture() {
  const root = await mkdtemp(join(tmpdir(), 'artifacts-release-test-'));
  const temporaryRoot = join(root, 'temporary');
  await mkdir(temporaryRoot);
  for (const [service, source] of Object.entries(services)) {
    const directory = join(root, 'dist/workers', service);
    const output = join(directory, '.cloudflare/output/v0/workers/default');
    await mkdir(join(output, 'bundle'), { recursive: true });
    const { entrypoint: _entrypoint, ...worker } = source.worker;
    await writeFile(join(directory, 'cloudflare.config.ts'), `export default ${JSON.stringify(source)};\n`);
    await writeFile(join(directory, '.cloudflare/output/v0/config.json'), '{"buildContext":{"isPreview":false}}');
    await writeFile(join(output, 'worker.config.json'), JSON.stringify({
      ...worker,
      ...(service === 'panel' ? { env: { ...worker.env, ASSETS: { type: 'assets' } }, assets: { runWorkerFirst: true } } : {}),
      manifest: { type: 'complete', mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm' } } },
    }));
    await writeFile(join(output, 'bundle/worker.mjs'), 'export default { fetch() { return new Response("fixture"); } };');
    if (service === 'panel') {
      await mkdir(join(output, 'assets'));
      await writeFile(join(output, 'assets/style.css'), 'body { color: black; }');
    }
  }
  return { root, temporaryRoot, verifyAccount: async () => {}, close: () => rm(root, { recursive: true, force: true }) };
}

test('runtime secret projection follows the service declarations and keeps the viewer free of database and authoring credentials', () => {
  const config = environment();
  const secrets = JSON.parse(config.ARTIFACTS_RUNTIME_SECRETS);
  const projected = projectRuntimeSecrets(config);
  assert.deepEqual(projected.view, { PUBLICATION_SERVICE_SECRET: secrets.PUBLICATION_SERVICE_SECRET, PUBLICATION_COOKIE_SECRET: secrets.PUBLICATION_COOKIE_SECRET });
  assert.deepEqual(Object.keys(projected.auth).sort(), ['BETTER_AUTH_SECRET', 'DATABASE_AUTH_TOKEN', 'DATABASE_URL', 'EMAIL_FROM', 'OWNER_EMAIL', 'RESEND_API_KEY']);
  assert.deepEqual(Object.keys(projected.mcp).sort(), ['DATABASE_AUTH_TOKEN', 'DATABASE_URL', 'EMAIL_FROM', 'MCP_INTROSPECTION_CLIENT_ID', 'MCP_INTROSPECTION_CLIENT_SECRET', 'RESEND_API_KEY']);
  assert.deepEqual(Object.keys(projected.panel).sort(), ['DATABASE_AUTH_TOKEN', 'DATABASE_URL', 'EMAIL_FROM', 'PANEL_CLIENT_ID', 'PANEL_CLIENT_SECRET', 'PUBLICATION_SERVICE_SECRET', 'RESEND_API_KEY']);
});

test('missing and malformed deployment inputs fail before temporary secret files or Worker commands', async () => {
  const app = await releaseFixture();
  let commands = 0;
  try {
    const valid = environment();
    const secrets = JSON.parse(valid.ARTIFACTS_RUNTIME_SECRETS);
    const invalid = [
      { ...valid, CLOUDFLARE_API_TOKEN: '' }, { ...valid, CLOUDFLARE_API_TOKEN: 'bad token' },
      { ...valid, CLOUDFLARE_ACCOUNT_ID: 'not-an-account' },
      ...['', '{', 'null', '[]', '{"UNDECLARED":"secret"}'].map((value) => ({ ...valid, ARTIFACTS_RUNTIME_SECRETS: value })),
      ...Object.keys(secrets).map((name) => ({ ...valid, ARTIFACTS_RUNTIME_SECRETS: JSON.stringify({ ...secrets, [name]: undefined }) })),
      ...[null, 42, '', '\n'].map((value) => ({ ...valid, ARTIFACTS_RUNTIME_SECRETS: JSON.stringify({ ...secrets, PANEL_CLIENT_SECRET: value }) })),
      { ...valid, ARTIFACTS_RUNTIME_SECRETS: JSON.stringify({ ...secrets, PUBLICATION_COOKIE_SECRET: 'short' }) },
      { ...valid, ARTIFACTS_RUNTIME_SECRETS: JSON.stringify({ ...secrets, BETTER_AUTH_SECRET: 'short' }) },
      { ...valid, ARTIFACTS_RUNTIME_SECRETS: JSON.stringify({ ...secrets, DATABASE_URL: 'file:production.db' }) },
      { ...valid, GITHUB_EVENT_NAME: 'workflow_dispatch' }, { ...valid, GITHUB_REF: 'refs/heads/feature' },
      { ...valid, GITHUB_SHA: 'bad-sha' }, { ...valid, GITHUB_TOKEN: '' },
    ];
    for (const config of invalid) {
      await assert.rejects(releaseProduction({ ...app, environment: config, deployWorker: async () => { commands++; } }));
      assert.deepEqual(await readdir(app.temporaryRoot), []);
    }
    assert.equal(commands, 0);
  } finally { await app.close(); }
});

test('production email is mandatory and effective text bindings validate sender fields before deployment', async () => {
  const app = await releaseFixture();
  let commands = 0;
  try {
    const valid = environment();
    const secrets = JSON.parse(valid.ARTIFACTS_RUNTIME_SECRETS);
    const omitted = { ...secrets };
    for (const name of ['OWNER_EMAIL', 'EMAIL_FROM', 'RESEND_API_KEY']) delete omitted[name];
    const invalid = [
      omitted,
      ...['OWNER_EMAIL', 'EMAIL_FROM'].map((name) => ({ ...secrets, [name]: 'malformed' })),
      ...['', ' ', 'invalid key', 'invalid\nkey'].map((value) => ({ ...secrets, RESEND_API_KEY: value })),
    ];
    const options = { ...app, verifyAccount: async () => { commands++; }, deployWorker: async () => { commands++; } };
    for (const input of invalid) await assert.rejects(releaseProduction({ ...options, environment: { ...valid, ARTIFACTS_RUNTIME_SECRETS: JSON.stringify(input) } }));
    await assert.rejects(releaseProduction({ ...options, environment: { ...valid, ARTIFACTS_RUNTIME_SECRETS: JSON.stringify({ ...secrets, RESEND_API_KEY: undefined }) } }), /RESEND_API_KEY must be a nonempty string/);
    for (const name of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_EMAIL_API_TOKEN']) {
      await assert.rejects(releaseProduction({ ...options, environment: { ...valid, ARTIFACTS_RUNTIME_SECRETS: JSON.stringify({ ...secrets, [name]: 'stale-email-binding' }) } }), /contains undeclared bindings/);
    }
    assert.equal(commands, 0);
    const projected = projectRuntimeSecrets(valid);
    assert.equal(projected.auth.OWNER_EMAIL, 'owner@example.test');
    for (const service of ['mcp', 'panel'] as const) {
      assert.equal(projected[service].EMAIL_FROM, 'invitations@example.test');
      assert.equal(projected[service].OWNER_EMAIL, undefined);
    }
    for (const service of ['auth', 'mcp', 'panel'] as const) {
      assert.equal(projected[service].RESEND_API_KEY, secrets.RESEND_API_KEY);
      assert.equal(projected[service].CLOUDFLARE_ACCOUNT_ID, undefined);
      assert.equal(projected[service].CLOUDFLARE_EMAIL_API_TOKEN, undefined);
    }
    for (const name of ['EMAIL_TRANSPORT', 'EMAIL_FROM', 'OWNER_EMAIL', 'RESEND_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_EMAIL_API_TOKEN']) {
      assert.equal(projected.view[name], undefined);
      assert.equal(name in services.view.worker.env, false);
    }
    assert.deepEqual(await readdir(app.temporaryRoot), []);
  } finally { await app.close(); }
});

test('every bundle and every dry run must pass before the first deployment, and secret files have mode 0600 with failure cleanup', async () => {
  const app = await releaseFixture();
  const commands: string[] = [];
  try {
    const bundle = join(app.root, 'dist/workers/view/.cloudflare/output/v0/workers/default/bundle/worker.mjs');
    await rm(bundle);
    const deployWorker = async (service: string, file: string, dryRun: boolean) => {
      commands.push(`${service}:${dryRun ? 'dry' : 'deploy'}`);
      assert.equal((await stat(file)).mode & 0o777, 0o600);
      assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), projectRuntimeSecrets(environment())[service as keyof typeof services]);
      if (service === 'view') throw new Error('Dry run failed');
    };
    await assert.rejects(releaseProduction({ ...app, environment: environment(), deployWorker }), /ENOENT/);
    assert.deepEqual(commands, []);
    await writeFile(bundle, 'export default {};');
    await assert.rejects(releaseProduction({ ...app, environment: environment(), deployWorker }), /Dry run failed/);
    assert.deepEqual(commands, ['auth:dry', 'mcp:dry', 'view:dry']);
    assert.deepEqual(await readdir(app.temporaryRoot), []);
  } finally { await app.close(); }
});

test('a generated config with a changed binding fails preflight without commands', async () => {
  const app = await releaseFixture();
  let commands = 0;
  try {
    const file = join(app.root, 'dist/workers/view/.cloudflare/output/v0/workers/default/worker.config.json');
    const config = JSON.parse(await readFile(file, 'utf8'));
    config.env.DATABASE_URL = { type: 'secret' };
    await writeFile(file, JSON.stringify(config));
    await assert.rejects(releaseProduction({ ...app, environment: environment(), deployWorker: async () => { commands++; } }), /configuration does not match/);
    assert.equal(commands, 0);
    assert.deepEqual(await readdir(app.temporaryRoot), []);
  } finally { await app.close(); }
});

test('dry-run mode needs no Cloudflare token and superseded releases skip after four dry runs', async () => {
  const app = await releaseFixture();
  const commands: string[] = [];
  try {
    const deployWorker = async (service: string, _file: string, dryRun: boolean) => { commands.push(`${service}:${dryRun ? 'dry' : 'deploy'}`); };
    const currentMain = async () => { commands.push('main'); return 'b'.repeat(40); };
    const smoke = async () => { commands.push('smoke'); };
    await releaseProduction({ ...app, environment: { ...environment(), CLOUDFLARE_API_TOKEN: '' }, dryRun: true, deployWorker, currentMain, smoke });
    assert.deepEqual(commands, ['auth:dry', 'mcp:dry', 'view:dry', 'panel:dry']);
    commands.length = 0;
    await releaseProduction({ ...app, environment: environment(), deployWorker, currentMain, smoke });
    assert.deepEqual(commands, ['auth:dry', 'mcp:dry', 'view:dry', 'panel:dry', 'main']);
    commands.length = 0;
    await assert.rejects(releaseProduction({ ...app, environment: environment(), deployWorker, currentMain: async () => '', smoke }), /Could not verify current main/);
    assert.deepEqual(commands, ['auth:dry', 'mcp:dry', 'view:dry', 'panel:dry']);
    assert.deepEqual(await readdir(app.temporaryRoot), []);
  } finally { await app.close(); }
});

test('Cloudflare account verification requires a successful matching account and redacts provider errors before any commands', async () => {
  const app = await releaseFixture();
  const config = environment();
  let commands = 0;
  try {
    await verifyCloudflareAccount(config, async (input, init) => {
      assert.equal(String(input), `https://api.cloudflare.com/client/v4/accounts/${config.CLOUDFLARE_ACCOUNT_ID}`);
      assert.equal(init?.method ?? 'GET', 'GET');
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${config.CLOUDFLARE_API_TOKEN}`);
      assert(init?.signal);
      return Response.json({ success: true, result: { id: config.CLOUDFLARE_ACCOUNT_ID } });
    });
    for (const response of [Response.json({ success: false, errors: [{ message: config.CLOUDFLARE_API_TOKEN }] }, { status: 403 }), Response.json({ success: true, result: { id: 'b'.repeat(32) } }), new Response('invalid JSON')]) {
      await assert.rejects(releaseProduction({ ...app, environment: config, deployWorker: async () => { commands++; }, verifyAccount: () => verifyCloudflareAccount(config, async () => response) }), { message: 'Cloudflare token could not read the configured account' });
      assert.deepEqual(await readdir(app.temporaryRoot), []);
    }
    assert.equal(commands, 0);
  } finally { await app.close(); }
});

test('a current release finishes its serial quartet before smoke and a partial release stops without rollback', async () => {
  const app = await releaseFixture();
  const commands: string[] = [];
  try {
    const deployWorker = async (service: string, _file: string, dryRun: boolean) => { commands.push(`${service}:${dryRun ? 'dry' : 'deploy'}`); };
    const currentMain = async () => { commands.push('main'); return sha; };
    const smoke = async (secret: string) => { assert.equal(secret, projectRuntimeSecrets(environment()).view.PUBLICATION_SERVICE_SECRET); commands.push('smoke'); };
    await releaseProduction({ ...app, environment: environment(), deployWorker, currentMain, smoke });
    assert.deepEqual(commands, ['auth:dry', 'mcp:dry', 'view:dry', 'panel:dry', 'main', 'auth:deploy', 'mcp:deploy', 'view:deploy', 'panel:deploy', 'smoke']);
    commands.length = 0;
    await assert.rejects(releaseProduction({ ...app, environment: environment(), currentMain, smoke, deployWorker: async (service, file, dryRun) => {
      await deployWorker(service, file, dryRun);
      if (service === 'mcp' && !dryRun) throw new Error('Cloudflare unavailable');
    } }), /Cloudflare unavailable/);
    assert.deepEqual(commands, ['auth:dry', 'mcp:dry', 'view:dry', 'panel:dry', 'main', 'auth:deploy', 'mcp:deploy']);
    commands.length = 0;
    await assert.rejects(releaseProduction({ ...app, environment: environment(), currentMain, smoke, deployWorker: async (service, file, dryRun) => {
      await deployWorker(service, file, dryRun);
      if (service === 'view' && !dryRun) throw new Error('Viewer deployment failed');
    } }), /Viewer deployment failed/);
    assert.deepEqual(commands, ['auth:dry', 'mcp:dry', 'view:dry', 'panel:dry', 'main', 'auth:deploy', 'mcp:deploy', 'view:deploy']);
    assert.deepEqual(await readdir(app.temporaryRoot), []);
  } finally { await app.close(); }
});

test('production smoke performs only read operations and requires database-backed absent-session denial', async () => {
  const app = await fixture();
  const secret = 's'.repeat(40);
  const store = createArtifactStore(app.db, { publishOrigin: workerOrigins.PUBLISH_URL });
  let backendReads = 0;
  let forbiddenDatabaseReads = 0;
  const publication = createPublicationApp({ ...workerOrigins, PUBLICATION_SERVICE_SECRET: secret, PUBLICATION_COOKIE_SECRET: 'c'.repeat(40) }, async () => { backendReads++; throw new Error('Anonymous requests must not call the backend'); });
  const resource = createMcpApp({ issuer: `${workerOrigins.AUTH_URL}/api/auth`, resource: workerOrigins.MCP_URL, clientId: 'fixture', clientSecret: 'fixture' });
  const operations: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    operations.push(`${req.method} ${url.pathname}`);
    assert.equal(init?.redirect, 'manual');
    assert(init?.signal);
    assert(!req.headers.has('cookie'));
    if (url.origin === workerOrigins.PUBLISH_URL) return publication(req);
    if (url.origin === new URL(workerOrigins.MCP_URL).origin) return resource(req);
    if (url.pathname === '/health') return Response.json({ status: 'ok' });
    if (url.pathname === '/api/auth/.well-known/openid-configuration') return Response.json({ issuer: `${workerOrigins.AUTH_URL}/api/auth`, authorization_endpoint: `${workerOrigins.AUTH_URL}/api/auth/oauth2/authorize`, token_endpoint: `${workerOrigins.AUTH_URL}/api/auth/oauth2/token`, jwks_uri: `${workerOrigins.AUTH_URL}/api/auth/jwks` });
    if (url.origin === workerOrigins.DASHBOARD_URL && url.pathname === '/') return new Response('<a href="/auth/login">Iniciar sesión</a><style>body { color: black; }</style>', { headers: { 'cache-control': 'no-store' } });
    if (url.pathname === '/_astro/panel.css') return new Response('body { color: black; }', { headers: { 'content-type': 'text/css' } });
    assert.equal(url.pathname, '/internal/publication/read');
    if (!publicationServiceAuthorized(req, secret)) return new Response('Access denied', { status: 403 });
    const { viewer, ...parameters } = publicationReadSchema.parse(await req.json());
    assert.equal(viewer.artifactId, parameters.artifactId);
    assert(viewer.expiresAt > Date.now());
    try { return Response.json(await store.readPublished(viewer, parameters)); }
    catch (error) { forbiddenDatabaseReads++; return artifactErrorResponse(error); }
  };
  try {
    const before = await app.client.execute('SELECT COUNT(*) AS count FROM session');
    await smokeProduction(secret, { request, attempts: 1 });
    const after = await app.client.execute('SELECT COUNT(*) AS count FROM session');
    assert.deepEqual(after.rows, before.rows);
    assert.equal(forbiddenDatabaseReads, 1);
    assert.equal(backendReads, 0);
    assert.deepEqual(operations.filter((operation) => !operation.startsWith('GET ')), ['POST /internal/publication/read', 'POST /internal/publication/read']);
    const linkedStylesheet: typeof fetch = async (input, init) => {
      const url = new URL(new Request(input, init).url);
      if (url.origin === workerOrigins.DASHBOARD_URL && url.pathname === '/') return new Response('<a href="/auth/login">Iniciar sesión</a><link href="/_astro/panel.css" rel="stylesheet">', { headers: { 'cache-control': 'no-store' } });
      return request(input, init);
    };
    await smokeProduction(secret, { request: linkedStylesheet, attempts: 1 });
    assert(operations.includes('GET /_astro/panel.css'));
    for (const failure of ['admission', 'schema', 'outage', 'redirect', 'asset', 'inline-style', 'issuer', 'attachment']) {
      let attempts = 0;
      const broken: typeof fetch = async (input, init) => {
        const req = new Request(input, init);
        const url = new URL(req.url);
        if (url.pathname === '/internal/publication/read' && req.headers.has('authorization') && ['admission', 'schema', 'outage', 'redirect'].includes(failure)) {
          attempts++;
          return new Response(failure === 'admission' ? 'Access denied' : 'No se puede abrir este artefacto.', { status: failure === 'schema' ? 400 : failure === 'outage' ? 503 : failure === 'redirect' ? 302 : 403 });
        }
        if (failure === 'asset' && url.origin === workerOrigins.DASHBOARD_URL && url.pathname === '/') return linkedStylesheet(input, init);
        if (failure === 'asset' && url.pathname === '/_astro/panel.css') return new Response('Not found', { status: 404 });
        if (failure === 'inline-style' && url.origin === workerOrigins.DASHBOARD_URL && url.pathname === '/') return new Response('<a href="/auth/login">Iniciar sesión</a><style></style>', { headers: { 'cache-control': 'no-store' } });
        if (failure === 'issuer' && url.pathname.includes('openid-configuration')) return Response.json({ issuer: 'https://wrong.example.test' });
        if (failure === 'attachment' && url.pathname.includes('/files/')) return new Response('Bytes exposed');
        return request(input, init);
      };
      await assert.rejects(smokeProduction(secret, { request: broken, attempts: 2, delayMs: 0 }), /Production smoke failed/);
      if (['admission', 'schema', 'outage', 'redirect'].includes(failure)) assert.equal(attempts, 2);
    }
  } finally { await app.close(); }
});
