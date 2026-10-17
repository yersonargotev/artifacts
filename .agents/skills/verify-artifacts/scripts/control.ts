#!/usr/bin/env -S node --import tsx
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:net';
import { mkdir, readFile, writeFile, appendFile, open, rm, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { serve } from '@hono/node-server';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { unzipSync, strFromU8 } from 'fflate';
import { driveProjects } from './projects.ts';
import { fixture, grant } from '../../../../tests/helpers.ts';
import { createPublicationApp } from '../../../../apps/publication/src/http.ts';
import { artifactReadSchema, publishResultSchema } from '../../../../packages/artifacts/src/contracts.ts';

const root = resolve(import.meta.dirname, '../../../..');
const entry = join(root, 'apps/dashboard/dist/server/entry.mjs');
const script = resolve(import.meta.filename);
const features = ['identity', 'authoring', 'cli', 'projects', 'screens', 'preview', 'publication', 'export'] as const;
type Feature = typeof features[number];
type Instance = { id: string; pid: number; panelPid: number; build: string; ownerId: string; auth: string; mcp: string; panel: string; view: string; control: string; expiresAt: string };
type Credentials = { controlToken: string; accessToken: string; password: string };
type ToolResult = { isError?: boolean; structuredContent: Record<string, any> };
let args: string[];
let run: string;
let runtime: string;
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const json = async (path: string, value: unknown) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
async function load<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')) as T; }
async function listen(server: Server) { if (!server.listening) await once(server, 'listening'); const address = server.address(); assert(address && typeof address === 'object'); return address.port; }
async function close(server: Server) { if ('closeAllConnections' in server) (server as Server & { closeAllConnections(): void }).closeAllConnections(); if (server.listening) await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); }
async function freePanelPort() { const reservation = createServer().listen(0, '127.0.0.1'); const port = await listen(reservation); await close(reservation); return port; }
async function stopChild(child: ChildProcess) { if (child.exitCode !== null || child.signalCode !== null) return; child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), delay(3000)]); if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); } }

async function tool(instance: Instance, credentials: Credentials, name: string, input: unknown = {}): Promise<{ status: number; result?: ToolResult }> {
  const response = await fetch(instance.mcp, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${credentials.accessToken}`, 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } }), signal: AbortSignal.timeout(8000) });
  if (response.status !== 200) return { status: response.status };
  const body = await response.text();
  const payload = body.startsWith('event:') ? body.split('\n').find((line) => line.startsWith('data:'))?.slice(5) : body;
  assert(payload, 'MCP response has JSON payload');
  const parsed = JSON.parse(payload) as { error?: unknown; result?: ToolResult };
  assert(!parsed.error && parsed.result, 'MCP transport returned a tool result');
  return { status: response.status, result: parsed.result };
}

async function ownedInstance(): Promise<{ instance: Instance; credentials: Credentials }> {
  const instance = await load<Instance>(join(run, 'instance.json'));
  const credentials = await load<Credentials>(join(runtime, 'credentials.json'));
  const response = await fetch(instance.control, { headers: { authorization: `Bearer ${credentials.controlToken}` }, signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200, 'Owned supervisor answers');
  const current = await response.json() as { id: string; pid: number; panelPid: number };
  assert.equal(current.id, instance.id, 'Supervisor instance identity matches');
  assert.equal(current.pid, instance.pid, 'Supervisor PID matches');
  assert.equal(current.panelPid, instance.panelPid, 'Owned panel PID matches');
  return { instance, credentials };
}

async function doctor() {
  const { instance, credentials } = await ownedInstance();
  assert.equal(hash(await readFile(entry)), instance.build, 'Panel build has not changed during the run');
  for (const url of [`${instance.auth}/health`, `${new URL(instance.mcp).origin}/health`, instance.panel]) {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200, `Service responds at ${url}`);
  }
  const denied = await fetch(`${instance.view}/a/doctor-nonexistent`, { redirect: 'manual', signal: AbortSignal.timeout(3000) });
  assert.equal(denied.status, 303, 'Viewer starts protected admission without a cookie');
  const identity = await tool(instance, credentials, 'whoami');
  assert.equal(identity.status, 200, 'MCP token remains active');
  assert.equal(identity.result?.structuredContent.userId, instance.ownerId, 'MCP identity matches disposable owner');
  assert(!identity.result?.isError, 'MCP identity tool succeeds');
  const proof = { status: 'passed', checkedAt: new Date().toISOString(), instance: instance.id, pid: instance.pid, panelPid: instance.panelPid, build: instance.build, ownerId: instance.ownerId, surfaces: ['auth', 'mcp', 'panel', 'view'], liveMcpSession: true };
  await json(join(run, 'doctor.json'), proof);
  return { instance, credentials, proof };
}

async function supervisor() {
  process.chdir(root);
  let app: Awaited<ReturnType<typeof fixture>> | undefined;
  let panel: ChildProcess | undefined;
  const servers: Server[] = [];
  let shuttingDown = false;
  let resolveStop!: () => void;
  const stopped = new Promise<void>((done) => { resolveStop = done; });
  const requestStop = () => { shuttingDown = true; resolveStop(); };
  process.on('SIGTERM', requestStop);
  process.on('SIGINT', requestStop);
  const expiry = setTimeout(requestStop, 15 * 60_000);
  try {
    const panelOrigin = `http://localhost:${await freePanelPort()}`;
    let viewHandler: (request: Request) => Promise<Response> = async () => new Response('Starting', { status: 503 });
    const view = serve({ fetch: (request) => viewHandler(request), hostname: '::1', port: 0 });
    servers.push(view);
    const viewOrigin = `http://[::1]:${await listen(view)}`;
    app = await fixture({ transport: 'combined', dashboard: panelOrigin, publishOrigin: viewOrigin });
    const serviceSecret = randomBytes(32).toString('hex');
    const cookieSecret = randomBytes(32).toString('hex');
    viewHandler = createPublicationApp({ DASHBOARD_URL: panelOrigin, PUBLISH_URL: viewOrigin, PUBLICATION_SERVICE_SECRET: serviceSecret, PUBLICATION_COOKIE_SECRET: cookieSecret });
    const client = await app.auth.api.adminCreateOAuthClient({ headers: new Headers({ cookie: app.cookie }), body: { client_name: 'Verification panel', application_type: 'native', redirect_uris: [`${panelOrigin}/auth/callback`], token_endpoint_auth_method: 'client_secret_basic', grant_types: ['authorization_code'], response_types: ['code'], scope: 'openid profile', enable_end_session: true, skip_consent: true, require_pkce: true } });
    assert(client.client_secret);
    const log = await open(join(run, 'panel.log'), 'a', 0o600);
    panel = spawn(process.execPath, [entry], { cwd: root, env: { PATH: process.env.PATH, DATABASE_URL: app.databaseUrl, DATABASE_AUTH_TOKEN: '', AUTH_URL: app.config.origin, MCP_URL: app.config.resource, DASHBOARD_URL: panelOrigin, PUBLISH_URL: viewOrigin, PUBLICATION_SERVICE_SECRET: serviceSecret, PUBLICATION_COOKIE_SECRET: cookieSecret, PANEL_CLIENT_ID: client.client_id, PANEL_CLIENT_SECRET: client.client_secret, PORT: new URL(panelOrigin).port, HOST: '127.0.0.1' }, stdio: ['ignore', log.fd, log.fd] });
    await log.close();
    panel.once('error', requestStop);
    panel.once('exit', () => { if (!shuttingDown) requestStop(); });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      assert(!shuttingDown && panel.exitCode === null, 'Panel stayed alive during startup; inspect panel.log');
      ready = await fetch(panelOrigin, { signal: AbortSignal.timeout(1500) }).then((response) => response.status === 200).catch(() => false);
      if (ready) break;
      await delay(100);
    }
    assert(ready, 'Built panel is ready');
    const tokens = await grant(app, 'openid profile offline_access artifacts:read artifacts:write artifacts:publish');
    const controlToken = randomBytes(32).toString('hex');
    const id = randomUUID();
    const control = serve({ hostname: '127.0.0.1', port: 0, fetch: async (request) => {
      if (request.method !== 'GET' || new URL(request.url).pathname !== '/doctor' || request.headers.get('authorization') !== `Bearer ${controlToken}`) return new Response('Denied', { status: 403 });
      return Response.json({ id, pid: process.pid, panelPid: panel?.pid }, { headers: { 'cache-control': 'no-store' } });
    } });
    servers.push(control);
    const instance: Instance = { id, pid: process.pid, panelPid: panel.pid!, build: hash(await readFile(entry)), ownerId: app.ownerId, auth: app.config.origin, mcp: app.config.resource, panel: panelOrigin, view: viewOrigin, control: `http://127.0.0.1:${await listen(control)}/doctor`, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
    await json(join(runtime, 'credentials.json'), { controlToken, accessToken: tokens.access_token, password: app.password } satisfies Credentials);
    await json(join(run, 'instance.json'), instance);
    console.log(JSON.stringify({ ready: true, run, auth: instance.auth, mcp: instance.mcp, panel: instance.panel, view: instance.view }));
    await stopped;
  } finally {
    clearTimeout(expiry);
    if (panel) await stopChild(panel);
    for (const server of servers.reverse()) await close(server);
    await app?.close();
    await rm(runtime, { recursive: true, force: true });
    await json(join(run, 'cleanup.json'), { status: 'stopped', cleanedAt: new Date().toISOString(), pid: process.pid, runtimeRemoved: true, disposableDatabaseRemoved: true });
  }
}

async function launch() {
  await stat(entry).catch(() => { throw new Error('Build the panel first: pnpm build'); });
  await mkdir(resolve(run, '..'), { recursive: true, mode: 0o700 });
  await mkdir(run, { mode: 0o700 });
  await mkdir(runtime, { mode: 0o700 });
  const log = await open(join(run, 'supervisor.log'), 'a', 0o600);
  const child = spawn(process.execPath, ['--import', 'tsx', script, 'serve', '--run', run], { cwd: root, detached: true, stdio: ['ignore', log.fd, log.fd], env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR } });
  await log.close();
  child.unref();
  try {
    for (let attempt = 0; attempt < 200; attempt++) {
      assert(child.exitCode === null, 'Supervisor exited; inspect supervisor.log');
      const instance = await load<Instance>(join(run, 'instance.json')).catch(() => undefined);
      if (instance) { await doctor(); console.log(JSON.stringify({ ready: true, run, panel: instance.panel, mcp: instance.mcp, auth: instance.auth, view: instance.view })); return; }
      await delay(100);
    }
    throw new Error('Supervisor readiness timed out; inspect supervisor.log');
  } catch (error) {
    await stopChild(child);
    await rm(runtime, { recursive: true, force: true });
    throw error;
  }
}

async function cleanup() {
  const prior = await load<{ status: string }>(join(run, 'cleanup.json')).catch(() => undefined);
  if (prior?.status === 'stopped') { console.log(JSON.stringify({ ...prior, run, alreadyStopped: true })); return; }
  const { instance } = await ownedInstance();
  process.kill(instance.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 100; attempt++) {
    const proof = await load<{ status: string }>(join(run, 'cleanup.json')).catch(() => undefined);
    if (proof?.status === 'stopped') { console.log(JSON.stringify({ ...proof, run })); return; }
    await delay(100);
  }
  throw new Error('Owned supervisor did not confirm cleanup; inspect logs and owned PIDs in instance.json');
}

const firstSnapshot = { metadata: { title: 'Verification artifact', description: 'Disposable user-path proof.' }, content: { kind: 'html' as const, text: '<!doctype html><html lang="en"><meta charset="utf-8"><title>Verification artifact</title><h1>Verification revision 1</h1><button onclick="this.textContent=\'Interaction verified\'">Try interaction</button></html>' }, files: [{ path: 'notes.txt', mediaType: 'text/plain', encoding: 'utf8' as const, data: 'Revision 1 attachment.\n' }] };
const secondSnapshot = { ...firstSnapshot, content: { ...firstSnapshot.content, text: firstSnapshot.content.text.replace('Verification revision 1', 'Verification revision 2') } };
type ScreenArtifact = { title: string; project: string | null; kind: 'html' | 'markdown' | 'text'; publication: 'draft' | 'current' | 'pending' };
const screenArtifacts: readonly ScreenArtifact[] = [
  { title: 'Alpha overview', project: 'Alpha', kind: 'html', publication: 'pending' },
  { title: 'Alpha delivery', project: 'Alpha', kind: 'markdown', publication: 'current' },
  { title: 'Alpha notes', project: 'Alpha', kind: 'text', publication: 'draft' },
  { title: 'Beta overview', project: 'Beta', kind: 'markdown', publication: 'current' },
  { title: 'Beta delivery', project: 'Beta', kind: 'text', publication: 'draft' },
  { title: 'Beta notes', project: 'Beta', kind: 'markdown', publication: 'draft' },
  { title: 'Gamma overview', project: 'Gamma', kind: 'text', publication: 'draft' },
  { title: 'Gamma notes', project: 'Gamma', kind: 'markdown', publication: 'draft' },
  { title: 'Delta overview', project: 'Delta', kind: 'text', publication: 'draft' },
  { title: 'Delta notes', project: 'Delta', kind: 'markdown', publication: 'draft' },
  { title: 'Unfiled overview', project: null, kind: 'text', publication: 'draft' },
  { title: 'Unfiled notes', project: null, kind: 'markdown', publication: 'draft' },
];
const screenViewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }] as const;

export async function checkScreen(page: Page, label: string) {
  const errors = [...(await page.consoleMessages()).filter((message) => message.type() === 'error').map((message) => message.text()), ...(await page.pageErrors()).map((error) => error.message)];
  assert.equal(errors.length, 0, `${label}: console or page error: ${errors.join('; ')}`);
  const bounds = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth }));
  assert(bounds.scrollWidth <= bounds.innerWidth, `${label}: horizontal overflow (${bounds.scrollWidth}px > ${bounds.innerWidth}px)`);
  const primaries = await page.locator('[data-variant="primary"]').filter({ visible: true }).evaluateAll((buttons) => buttons.filter((button) => !button.closest('dialog[open], [role="dialog"][aria-modal="true"]')).length);
  assert(primaries <= 1, `${label}: ${primaries} visible primary actions outside an open dialog, expected at most 1`);
}

async function drive(feature: Feature) {
  const { instance, credentials } = await doctor();
  await open(join(run, 'drive.lock'), 'wx', 0o600).then((file) => file.close());
  const directory = join(run, feature);
  await mkdir(directory, { mode: 0o700 });
  const checks: string[] = [];
  const record = (action: string, result: unknown) => appendFile(join(directory, 'actions.jsonl'), `${JSON.stringify({ time: new Date().toISOString(), action, result })}\n`, { mode: 0o600 });
  async function call(name: string, input: unknown = {}, allowError = false) {
    const response = await tool(instance, credentials, name, input);
    await record(`MCP ${name}`, { input, ...response });
    assert.equal(response.status, 200, `${name} HTTP result`);
    assert(response.result, `${name} tool response`);
    if (!allowError) assert(!response.result.isError, `${name} tool succeeded`);
    return response.result.structuredContent;
  }
  const cliState = join(runtime, 'cli-state');
  async function cli(...cliArgs: string[]) {
    await mkdir(cliState, { recursive: true, mode: 0o700 });
    const env = { PATH: process.env.PATH, HOME: cliState, ARTIFACTS_SERVER: instance.mcp, ARTIFACTS_STATE_DIR: cliState, ARTIFACTS_ACCESS_TOKEN: credentials.accessToken };
    const child = spawn(process.execPath, ['--import', 'tsx', join(root, 'apps/cli/src/index.ts'), ...cliArgs], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    const [code] = await once(child, 'close') as [number | null];
    await record(`CLI artifacts ${cliArgs.join(' ')}`, { code, stdout, stderr });
    return { code, stdout, stderr };
  }
  async function ok(...cliArgs: string[]) { const result = await cli(...cliArgs); assert.equal(result.code, 0, `artifacts ${cliArgs[0]} exits 0`); return JSON.parse(result.stdout); }
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  async function capture(page: Page, label: string) {
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))); });
    await page.screenshot({ path: join(directory, `${label}.png`), fullPage: true });
    await writeFile(join(directory, `${label}.aria.yml`), await page.locator('body').ariaSnapshot(), { mode: 0o600 });
    await record(`Capture ${label}`, { url: page.url(), screenshot: `${label}.png`, aria: `${label}.aria.yml` });
  }
  async function login(page: Page, fromPanel = true) {
    if (fromPanel) {
      await record('Open panel and choose Iniciar sesión', { url: instance.panel });
      await page.goto(instance.panel);
      await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
    }
    await page.getByLabel('Correo electrónico').fill('owner@example.test');
    await page.getByLabel('Contraseña').fill(credentials.password);
    await record('Submit Iniciar sesión', { email: 'owner@example.test', password: 'omitted' });
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  }
  let status = 'failed';
  try {
    if (feature === 'authoring') {
      const input = { requestId: randomUUID(), snapshot: firstSnapshot };
      const created = artifactReadSchema.parse(await call('artifacts_create', input));
      assert.deepEqual(artifactReadSchema.parse(await call('artifacts_create', input)), created);
      const retained = artifactReadSchema.parse(await call('artifacts_read', { artifactId: created.artifactId, revisionId: created.revision.id }));
      assert.deepEqual(retained.revision.snapshot, firstSnapshot);
      const updated = artifactReadSchema.parse(await call('artifacts_update', { requestId: randomUUID(), artifactId: created.artifactId, expectedRevisionId: created.revision.id, snapshot: secondSnapshot }));
      assert.equal(updated.revision.parentRevisionId, created.revision.id);
      assert.equal(updated.publication, null);
      const stale = await call('artifacts_update', { requestId: randomUUID(), artifactId: created.artifactId, expectedRevisionId: created.revision.id, snapshot: firstSnapshot }, true);
      assert.equal(stale.error, 'conflict');
      const historical = artifactReadSchema.parse(await call('artifacts_read', { artifactId: created.artifactId, revisionId: created.revision.id }));
      assert.deepEqual(historical.revision.snapshot, firstSnapshot);
      const history = await call('artifacts_history', { artifactId: created.artifactId });
      assert.deepEqual(history.items.map((item: { id: string }) => item.id), [updated.revision.id, created.revision.id]);
      const listed = await call('artifacts_list');
      assert(listed.items.some((item: { artifactId: string }) => item.artifactId === created.artifactId));
      const published = publishResultSchema.parse(await call('artifacts_publish', { requestId: randomUUID(), artifactId: created.artifactId, revisionId: updated.revision.id, expectedPublicationVersion: 0 }));
      const read = artifactReadSchema.parse(await call('artifacts_read', { artifactId: created.artifactId }));
      assert.equal(published.revisionId, updated.revision.id);
      assert.equal(read.headRevisionId, updated.revision.id);
      assert.equal(read.revision.id, updated.revision.id);
      assert.deepEqual(read.revision.snapshot, secondSnapshot);
      assert.equal(read.publication?.revisionId, published.revisionId);
      checks.push('Real HTTP-MCP create/replay/read/update/history/list/publish', 'Immutable historical snapshot', 'Stale update rejected', 'Publication independently read back');
    } else if (feature === 'cli') {
      const identity = await ok('whoami');
      assert.equal(identity.userId, instance.ownerId, 'CLI identity matches disposable owner');
      await json(join(directory, 'snapshot-1.json'), firstSnapshot);
      const created = artifactReadSchema.parse(await ok('create', '--snapshot', join(directory, 'snapshot-1.json')));
      await json(join(directory, 'changes.json'), { content: { text: secondSnapshot.content.text } });
      const edited = artifactReadSchema.parse(await ok('edit', created.artifactId, '--changes', join(directory, 'changes.json')));
      assert.equal(edited.revision.parentRevisionId, created.revision.id);
      assert.deepEqual(edited.revision.snapshot, secondSnapshot, 'Edit preserves metadata and attachment');
      const stale = await cli('update', created.artifactId, '--snapshot', join(directory, 'snapshot-1.json'), '--expected-revision', created.revision.id);
      assert.equal(stale.code, 1, 'Stale CLI update exits 1');
      assert.match(stale.stderr, /"code":"conflict".*"status":409/, 'Stale CLI update reports the REST conflict');
      const history = await ok('history', created.artifactId, '--summary');
      assert.deepEqual(history.items.map((item: { id: string }) => item.id), [edited.revision.id, created.revision.id]);
      const published = publishResultSchema.parse(await ok('publish', created.artifactId, '--revision', edited.revision.id, '--expected-version', '0'));
      const exported = await ok('export', created.artifactId, '--revision', created.revision.id, '--out', join(directory, 'cli-revision-1.zip'));
      const bytes = await readFile(join(directory, 'cli-revision-1.zip'));
      assert.equal(hash(bytes), exported.sha256, 'CLI export reports its file digest');
      const archive = await call('artifacts_export', { artifactId: created.artifactId, revisionId: created.revision.id });
      assert.deepEqual(bytes, Buffer.from(archive.base64, 'base64'), 'CLI ZIP equals MCP export');
      assert.equal(strFromU8(unzipSync(bytes)['content.html']!), firstSnapshot.content.text);
      const read = artifactReadSchema.parse(await call('artifacts_read', { artifactId: created.artifactId }));
      assert.equal(read.headRevisionId, edited.revision.id);
      assert.equal(read.publication?.revisionId, published.revisionId);
      checks.push('Source CLI whoami/create/edit/history/publish/export over local REST', 'Stale CLI update rejected with exit 1', 'Edit preserves omitted metadata and attachment', 'CLI ZIP equals MCP export bytes', 'Head and publication independently read through MCP');
    } else {
      browser = await chromium.launch({ channel: 'chrome', headless: !args.includes('--headed') });
      context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(feature === 'screens' && args.includes('--headed') ? { recordVideo: { dir: join(directory, 'video'), size: { width: 1440, height: 900 } } } : {}) });
      await context.tracing.start({ screenshots: true, snapshots: true });
      const page = await context.newPage();
      const browserVersion = browser.version();
      assert(Number(browserVersion.split('.')[0]) >= 152, 'Chrome 152+ is required for interactive HTML proof');
      await record('Start isolated Chrome context', { version: browserVersion, viewport: { width: 1440, height: 900 } });
      if (feature === 'screens') {
        page.setDefaultTimeout(10_000);
        const seeded = [];
        for (const fixture of screenArtifacts) {
          const snapshot = { metadata: { title: fixture.title, description: `Screen verification for ${fixture.title}.` }, content: fixture.kind === 'html' ? firstSnapshot.content : { kind: fixture.kind, text: fixture.kind === 'markdown' ? `# ${fixture.title}\n\nScreen verification document.` : `${fixture.title}\n\nScreen verification document.` }, files: [] };
          let artifact = artifactReadSchema.parse(await call('artifacts_create', { requestId: randomUUID(), snapshot, ...(fixture.project ? { project: fixture.project } : {}) }));
          if (fixture.publication !== 'draft') await call('artifacts_publish', { requestId: randomUUID(), artifactId: artifact.artifactId, revisionId: artifact.revision.id, expectedPublicationVersion: 0 });
          if (fixture.publication === 'pending') artifact = artifactReadSchema.parse(await call('artifacts_update', { requestId: randomUUID(), artifactId: artifact.artifactId, expectedRevisionId: artifact.revision.id, snapshot: { ...snapshot, content: secondSnapshot.content } }));
          seeded.push(artifactReadSchema.parse(await call('artifacts_read', { artifactId: artifact.artifactId })));
        }
        assert.equal(seeded.length, 12, 'Screens seed has 12 artifacts');
        assert.equal(seeded.filter((artifact) => artifact.project === null).length, 2, 'Screens seed has two unfiled artifacts');
        assert.equal(seeded.filter((artifact) => artifact.publication).length, 3, 'Screens seed has three published artifacts');
        assert.equal(seeded.filter((artifact) => artifact.publication && artifact.publication.revisionId !== artifact.headRevisionId).length, 1, 'Screens seed has one pending publication');
        assert.deepEqual(await call('projects_list'), { items: [{ name: 'Alpha', artifactCount: 3 }, { name: 'Beta', artifactCount: 3 }, { name: 'Delta', artifactCount: 2 }, { name: 'Gamma', artifactCount: 2 }] });
        const detail = seeded[0]!;
        assert.equal(detail.revision.sequence, 2, 'HTML detail has two revisions');
        await json(join(directory, 'seed.json'), seeded.map((artifact) => ({ artifactId: artifact.artifactId, title: artifact.revision.snapshot.metadata.title, project: artifact.project, headRevisionId: artifact.headRevisionId, publication: artifact.publication })));
        for (const viewport of screenViewports) {
          await page.setViewportSize(viewport);
          await page.goto(instance.panel);
          await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).waitFor();
          const label = `screens-welcome-${viewport.width}`;
          await capture(page, label);
          await checkScreen(page, label);
          checks.push(label);
        }
        await login(page);
        await page.getByRole('heading', { level: 1, name: 'Biblioteca', exact: true }).waitFor();
        const screens = [
          { name: 'library', path: '/', heading: 'Biblioteca' },
          { name: 'projects', path: '/projects', heading: 'Proyectos' },
          { name: 'project', path: '/?project=Alpha', heading: 'Alpha' },
          { name: 'detail', path: `/artifacts/${detail.artifactId}`, heading: detail.revision.snapshot.metadata.title },
          { name: 'move', path: `/move?artifactId=${detail.artifactId}`, heading: 'Mover a proyecto' },
          { name: 'delete', path: `/artifacts/${detail.artifactId}/delete`, heading: 'Eliminar artefacto' },
        ];
        for (const screen of screens) for (const viewport of screenViewports) {
          const label = `screens-${screen.name}-${viewport.width}`;
          await page.setViewportSize(viewport);
          await record(`Open ${label}`, { path: screen.path, viewport });
          const response = await page.goto(`${instance.panel}${screen.path}`);
          assert.equal(response?.status(), 200, `${label} responds successfully`);
          await page.getByRole('heading', { level: 1, name: screen.heading, exact: true }).waitFor();
          if (screen.name === 'detail') await page.frameLocator('.preview').getByRole('heading', { name: 'Verification revision 2', exact: true }).waitFor();
          await capture(page, label);
          await checkScreen(page, label);
          checks.push(label);
        }
      } else if (feature === 'identity') {
        await login(page);
        await page.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
        await record('Open Mi cuenta', {});
        await page.locator('summary[aria-label="Mi cuenta"]').click();
        await page.getByTestId('user-id').waitFor();
        assert.equal(await page.getByTestId('user-id').textContent(), instance.ownerId);
        await capture(page, 'signed-in');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(instance.panel);
        await page.locator('.library-navigation > summary').click();
        await page.locator('summary[aria-label="Mi cuenta"]').click();
        await page.getByTestId('user-id').waitFor();
        assert.equal(await page.getByTestId('user-id').textContent(), instance.ownerId);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await capture(page, 'signed-in-mobile');
        await page.setViewportSize({ width: 1440, height: 900 });
        await record('Choose Cerrar sesión del panel', {});
        const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === '/auth/logout' && response.request().method() === 'POST');
        await page.getByRole('button', { name: 'Cerrar sesión del panel', exact: true }).click();
        const response = await responsePromise;
        assert.equal(response.status(), 303);
        assert.equal(await response.request().headerValue('origin'), instance.panel);
        await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).waitFor();
        await call('whoami');
        await capture(page, 'panel-logged-out');
        await record('Reenter panel through central SSO', {});
        await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
        await page.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
        await record('Open Mi cuenta', {});
        await page.locator('summary[aria-label="Mi cuenta"]').click();
        await page.getByTestId('user-id').waitFor();
        await record('Choose Cerrar todas las sesiones and confirm', {});
        await page.getByRole('link', { name: 'Cerrar todas las sesiones', exact: true }).click();
        await page.getByRole('button', { name: 'Cerrar todas las sesiones', exact: true }).click();
        await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).waitFor();
        const denied = await tool(instance, credentials, 'whoami');
        assert.equal(denied.status, 401);
        await record('Read MCP identity after global revoke', denied);
        const cookies = await context.cookies();
        assert(!cookies.some((cookie) => ['artifacts-panel', 'artifacts-auth.session_token'].includes(cookie.name)));
        await capture(page, 'globally-revoked');
        checks.push('Browser login owner matches MCP owner', 'Mobile native navigation and account disclosure without overflow', 'Native panel logout preserves MCP access', 'SSO reentry', 'Global revoke denies MCP and clears browser session cookies');
      } else if (feature === 'projects') {
        await driveProjects({ page, browser, context, instance, directory, root, cliEnv: { PATH: process.env.PATH, HOME: cliState, ARTIFACTS_SERVER: instance.mcp, ARTIFACTS_STATE_DIR: cliState, ARTIFACTS_ACCESS_TOKEN: credentials.accessToken }, firstSnapshot, secondSnapshot, recordVideo: args.includes('--record-video'), checks, call, ok, login, capture, checkScreen, record, json });
      } else {
        const created = artifactReadSchema.parse(await call('artifacts_create', { requestId: randomUUID(), snapshot: firstSnapshot }));
        let libraryDemo: { artifact: ReturnType<typeof artifactReadSchema.parse>; publication: ReturnType<typeof publishResultSchema.parse> } | undefined;
        if (feature === 'preview') {
          const demoSnapshot = {
            metadata: { title: 'Guía de revisión de entregas', description: 'Criterios y notas guardados para revisar una entrega.' },
            content: { kind: 'html' as const, text: '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#fbfaf7;color:#252b31;font:17px/1.6 system-ui}main{max-width:800px;margin:0 auto;padding:48px 28px}h1{font:42px/1.15 Georgia,serif;letter-spacing:-1px;margin:0 0 24px}h2{font-size:21px;margin-top:36px}p{max-width:65ch}li{margin:8px 0}button{font:inherit;border:1px solid #c6c6bf;background:white;color:#252b31;border-radius:8px;padding:10px 16px;margin-top:18px}@media(max-width:600px){main{padding:32px 24px}h1{font-size:34px}}</style><main><h1>Revisar una entrega</h1><p>Comprueba el contenido guardado y sus archivos antes de publicar una revisión.</p><h2>Qué revisar</h2><ul><li>El documento contiene las decisiones acordadas.</li><li>Los archivos conservan sus bytes originales.</li><li>La revisión seleccionada es la que quieres publicar.</li></ul><button onclick="this.textContent=\'Revisión comprobada\'">Comprobar revisión</button></main></html>' },
            files: [{ path: 'notas.txt', mediaType: 'text/plain', encoding: 'utf8' as const, data: 'Notas originales de la entrega.\n' }],
          };
          const demo = artifactReadSchema.parse(await call('artifacts_create', { requestId: randomUUID(), snapshot: demoSnapshot }));
          const publication = publishResultSchema.parse(await call('artifacts_publish', { requestId: randomUUID(), artifactId: demo.artifactId, revisionId: demo.revision.id, expectedPublicationVersion: 0 }));
          const pending = artifactReadSchema.parse(await call('artifacts_update', { requestId: randomUUID(), artifactId: demo.artifactId, expectedRevisionId: demo.revision.id, snapshot: { ...demoSnapshot, metadata: { ...demoSnapshot.metadata, description: 'Criterios actualizados, pendientes de publicación.' } } }));
          libraryDemo = { artifact: pending, publication };
          await call('artifacts_create', { requestId: randomUUID(), snapshot: { ...demoSnapshot, metadata: { title: 'Notas para publicar una entrega', description: 'Un borrador para la próxima entrega.' } } });
          const complete = artifactReadSchema.parse(await call('artifacts_create', { requestId: randomUUID(), snapshot: { ...demoSnapshot, metadata: { title: 'Resumen de decisiones del proyecto y referencias para el equipo', description: 'Decisiones retenidas y listas para consultar.' } } }));
          await call('artifacts_publish', { requestId: randomUUID(), artifactId: complete.artifactId, revisionId: complete.revision.id, expectedPublicationVersion: 0 });
        }
        const firstPublication = feature === 'publication' ? publishResultSchema.parse(await call('artifacts_publish', { requestId: randomUUID(), artifactId: created.artifactId, revisionId: created.revision.id, expectedPublicationVersion: 0 })) : undefined;
        if (firstPublication) {
          await record('Open protected publication before login', { url: firstPublication.url });
          await page.goto(firstPublication.url);
          await capture(page, 'publication-login');
          await login(page, false);
          await page.waitForURL(firstPublication.url);
          await page.frameLocator('iframe').getByRole('heading', { name: 'Verification revision 1', exact: true }).waitFor();
          await capture(page, 'published-r1');
        }
        const updated = artifactReadSchema.parse(await call('artifacts_update', { requestId: randomUUID(), artifactId: created.artifactId, expectedRevisionId: created.revision.id, snapshot: secondSnapshot }));
        assert.deepEqual(artifactReadSchema.parse(await call('artifacts_read', { artifactId: created.artifactId, revisionId: updated.revision.id })).revision.snapshot, secondSnapshot);
        if (feature === 'publication') {
          assert(firstPublication);
          const secondPublication = publishResultSchema.parse(await call('artifacts_publish', { requestId: randomUUID(), artifactId: created.artifactId, revisionId: updated.revision.id, expectedPublicationVersion: 1 }));
          assert.equal(secondPublication.url, firstPublication.url);
          await record('Reload unchanged publication URL', { url: secondPublication.url });
          await page.goto(secondPublication.url);
          await page.frameLocator('iframe').getByRole('heading', { name: 'Verification revision 2', exact: true }).waitFor();
          await record('Interact inside published sandbox', { button: 'Try interaction' });
          await page.frameLocator('iframe').getByRole('button', { name: 'Try interaction', exact: true }).click();
          await page.frameLocator('iframe').getByRole('button', { name: 'Interaction verified', exact: true }).waitFor();
          assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
          await capture(page, 'published-r2');
          await record('Open Archivos', {});
          await page.locator('.title-menu > summary').click();
          await page.locator('summary').filter({ hasText: /^Archivos \(/ }).click();
          const attachment = new URL((await page.getByRole('link', { name: 'notes.txt', exact: true }).getAttribute('href'))!, instance.view).href;
          await record('Download publication attachment', { name: 'notes.txt', url: attachment });
          const downloadPromise = page.waitForEvent('download');
          await page.getByRole('link', { name: 'notes.txt', exact: true }).click();
          await (await downloadPromise).saveAs(join(directory, 'notes.txt'));
          assert.equal(await readFile(join(directory, 'notes.txt'), 'utf8'), firstSnapshot.files[0]!.data);
          const anonymous = await browser.newContext({ viewport: { width: 1440, height: 900 } });
          try {
            const anonymousPage = await anonymous.newPage();
            await record('Open publication in anonymous context', { url: secondPublication.url });
            await anonymousPage.goto(secondPublication.url);
            await anonymousPage.getByLabel('Correo electrónico').waitFor();
            assert.equal(await anonymousPage.locator('iframe').count(), 0);
            const denied = await anonymous.request.get(attachment, { maxRedirects: 0 });
            assert.equal(denied.status(), 401);
            await record('Anonymous attachment request', { status: denied.status() });
            await capture(anonymousPage, 'anonymous-denied');
          } finally { await anonymous.close(); }
          checks.push('Real MCP publication versions retain stable URL', 'Browser login and viewer admission', 'Published iframe interaction', 'Exact attachment bytes', 'Anonymous document login and attachment 401');
        } else {
          await login(page);
          await page.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
          await capture(page, 'artifact-grid');
          if (libraryDemo) {
            assert.equal(await page.locator('.artifact-card').count(), 4);
            assert.equal(await page.locator('.artifact-card .artifact-status[data-state=pending]').count(), 1);
            for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const) {
              await page.setViewportSize(viewport);
              await page.goto(instance.panel);
              await page.getByRole('searchbox', { name: 'Buscar artefactos', exact: true }).fill('entrega');
              await page.getByRole('button', { name: 'Buscar', exact: true }).click();
              await page.waitForURL((url) => url.searchParams.get('q') === 'entrega');
              assert.equal(await page.locator('.artifact-card').count(), 2);
              await record('Search library by title', { viewport: name, query: 'entrega', results: 2 });
              const filters = page.getByRole('navigation', { name: 'Filtrar por publicación', exact: true });
              for (const label of ['Todos (2)', 'Publicados (0)', 'Sin publicar (1)', 'Cambios pendientes (1)']) assert.equal(await filters.getByRole('link', { name: label, exact: true }).count(), 1);
              await filters.getByRole('link', { name: /^Publicados \(/ }).click();
              await page.waitForURL((url) => url.searchParams.get('status') === 'published');
              assert.equal(new URL(page.url()).searchParams.get('q'), 'entrega');
              assert.equal(await page.locator('.artifact-card').count(), 0);
              await page.getByRole('heading', { name: 'No hay resultados', exact: true }).waitFor();
              await record('Current-publication filter excludes pending revisions', { viewport: name, all: 2, published: 0, pending: 1, unpublished: 1 });
              await filters.getByRole('link', { name: /^Cambios pendientes \(/ }).click();
              await page.waitForURL((url) => url.searchParams.get('status') === 'pending');
              assert.equal(await page.locator('.artifact-card .artifact-status[data-state=pending]').count(), 1);
              await page.getByRole('link', { name: 'Guía de revisión de entregas', exact: true }).waitFor();
              await filters.getByRole('link', { name: /^Sin publicar \(/ }).click();
              await page.waitForURL((url) => url.searchParams.get('status') === 'unpublished');
              assert.equal(await page.locator('.artifact-card').count(), 1);
              await page.getByRole('link', { name: 'Notas para publicar una entrega', exact: true }).waitFor();
              await page.getByRole('searchbox', { name: 'Buscar artefactos', exact: true }).fill('no-match-library-proof');
              await page.getByRole('button', { name: 'Buscar', exact: true }).click();
              await page.getByRole('heading', { name: 'No hay resultados', exact: true }).waitFor();
              assert.equal(await page.locator('.artifact-card').count(), 0);
              assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
              await capture(page, `library-no-results-${name}`);
              await page.goBack();
              await page.getByRole('link', { name: 'Notas para publicar una entrega', exact: true }).waitFor();
              assert.equal(new URL(page.url()).searchParams.get('q'), 'entrega');
              await page.getByRole('link', { name: 'Limpiar filtros', exact: true }).click();
              await page.waitForURL(`${instance.panel}/`);
              assert.equal(await page.locator('.artifact-card').count(), 4);
              await record('Filter, recover empty results and restore library', { viewport: name, statuses: ['published', 'pending', 'unpublished'], restoredResults: 4 });
            }
            await page.setViewportSize({ width: 1440, height: 900 });
            checks.push('Library search combines with publication filters at desktop and mobile', 'No-match state, browser Back and clear filters recover the library');
            const cardTrigger = page.getByRole('button', { name: 'Menú de Guía de revisión de entregas', exact: true });
            await cardTrigger.focus();
            await cardTrigger.press('Space');
            await page.waitForFunction(() => document.activeElement?.textContent === 'Ver artefacto');
            await page.keyboard.press('ArrowDown');
            assert.equal(await page.getByRole('menuitem', { name: 'Descargar revisión más reciente', exact: true }).evaluate((item) => item === document.activeElement), true);
            assert.equal(new URL((await page.getByRole('menuitem', { name: 'Descargar revisión más reciente', exact: true }).getAttribute('href'))!, instance.panel).searchParams.get('revisionId'), libraryDemo.artifact.revision.id);
            assert.equal(await page.getByRole('menuitem', { name: 'Abrir publicación', exact: true }).getAttribute('href'), libraryDemo.publication.url);
            await capture(page, 'artifact-grid-menu');
            await page.keyboard.press('Escape');
            await page.getByRole('menu').waitFor({ state: 'hidden' });
            await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Menú de Guía de revisión de entregas');
            assert.equal(await cardTrigger.evaluate((trigger) => trigger === document.activeElement), true);
            await page.setViewportSize({ width: 390, height: 844 });
            await page.goto(instance.panel);
            await page.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await capture(page, 'artifact-grid-mobile');
            await page.getByRole('button', { name: 'Menú de Guía de revisión de entregas', exact: true }).click();
            const menuBounds = await page.getByRole('menu').boundingBox();
            assert(menuBounds && menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= 390);
            await capture(page, 'artifact-grid-mobile-menu');
            await page.keyboard.press('Escape');
            await page.setViewportSize({ width: 1440, height: 900 });
            await page.goto(instance.panel);
          }
          await record('Choose Verification artifact from list', {});
          await page.getByRole('link', { name: 'Verification artifact', exact: true }).click();
          await page.getByRole('heading', { name: 'Historial', exact: true }).waitFor();
          assert.equal(await page.locator('.revision-list li').count(), 2);
          await page.frameLocator('.preview').getByRole('heading', { name: 'Verification revision 2', exact: true }).waitFor();
          if (feature === 'preview') {
            await record('Click Try interaction inside actual panel preview', {});
            const interaction = page.frameLocator('.preview').getByRole('button', { name: 'Try interaction', exact: true });
            await interaction.scrollIntoViewIfNeeded();
            await interaction.click();
            await page.frameLocator('.preview').getByRole('button', { name: 'Interaction verified', exact: true }).waitFor();
            assert.equal(await page.locator('.preview').getAttribute('sandbox'), 'allow-scripts');
            await capture(page, 'preview-r2-desktop');
          }
          await record('Choose Ver revisión 1 from history', {});
          await Promise.all([page.waitForURL((url) => url.searchParams.get('revisionId') === created.revision.id), page.getByRole('link', { name: 'Ver revisión 1', exact: true }).press('Enter')]);
          await page.frameLocator('.preview').getByRole('heading', { name: 'Verification revision 1', exact: true }).waitFor();
          if (feature === 'export') {
            await page.getByRole('button', { name: 'Menú de Verification artifact', exact: true }).click();
            await record('Download selected historical revision 1', {});
            const downloadPromise = page.waitForEvent('download');
            await page.getByRole('menuitem', { name: 'Descargar revisión 1', exact: true }).click();
            await (await downloadPromise).saveAs(join(directory, 'browser-revision-1.zip'));
            const archive = await call('artifacts_export', { artifactId: created.artifactId, revisionId: created.revision.id });
            const bytes = Buffer.from(archive.base64, 'base64');
            assert.equal(hash(bytes), archive.sha256);
            await writeFile(join(directory, 'mcp-revision-1.zip'), bytes, { mode: 0o600 });
            assert.deepEqual(await readFile(join(directory, 'browser-revision-1.zip')), bytes);
            const members = unzipSync(bytes);
            assert.equal(strFromU8(members['content.html']!), firstSnapshot.content.text);
            assert.equal(strFromU8(members['files/notes.txt']!), firstSnapshot.files[0]!.data);
            const manifest = JSON.parse(strFromU8(members['artifact.json']!));
            assert.equal(manifest.artifactId, created.artifactId);
            assert.equal(manifest.revision.id, created.revision.id);
            await capture(page, 'historical-export');
            checks.push('Browser selected-revision download', 'MCP historical export matches browser ZIP exactly', 'ZIP hash, manifest, original content and attachment bytes');
          } else {
            await capture(page, 'preview-r1-desktop');
            await record('Choose Ver revisión 2 and use 390px viewport', {});
            await Promise.all([page.waitForURL((url) => url.searchParams.get('revisionId') === updated.revision.id), page.getByRole('link', { name: 'Ver revisión 2', exact: true }).press('Enter')]);
            await page.setViewportSize({ width: 390, height: 844 });
            await page.frameLocator('.preview').getByRole('heading', { name: 'Verification revision 2', exact: true }).waitFor();
            await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))); });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await capture(page, 'preview-r2-mobile');
            if (libraryDemo) {
              const demoUrl = `${instance.panel}/artifacts/${libraryDemo.artifact.artifactId}?${new URLSearchParams({ revisionId: libraryDemo.artifact.revision.id })}`;
              for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const) {
                await page.setViewportSize(viewport);
                await page.goto(demoUrl);
                await page.frameLocator('.preview').getByRole('heading', { name: 'Revisar una entrega', exact: true }).waitFor();
                await capture(page, `demo-detail-${name}`);
                await page.getByRole('button', { name: 'Menú de Guía de revisión de entregas', exact: true }).click();
                await capture(page, `demo-detail-menu-${name}`);
                await page.keyboard.press('Escape');
                await page.goto(libraryDemo.publication.url);
                await page.frameLocator('main > iframe').getByRole('heading', { name: 'Revisar una entrega', exact: true }).waitFor();
                await capture(page, `demo-publication-${name}`);
                const home = page.getByRole('link', { name: 'Volver a la biblioteca', exact: true });
                assert.equal(await home.getAttribute('href'), `${instance.panel}/`);
                const homeBounds = await home.boundingBox();
                assert(homeBounds && homeBounds.width >= 44 && homeBounds.height >= 44);
                await record('Return from publication to library', { viewport: name, destination: instance.panel });
                await home.click();
                await page.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
                assert.equal(new URL(page.url()).origin, instance.panel);
                assert.equal(await page.locator('.artifact-card').count(), 4);
              }
              checks.push('Real MCP library drafts, publication and pending state', 'Card menu keyboard, exact-head download and stable publication links', 'Library desktop and 390px cards and menu without overflow', 'Publication home returns to authenticated library at both viewports');
            }
            checks.push('Real MCP creates two retained revisions', 'Panel list and history select each revision', 'Interaction inside actual sandbox iframe', 'Desktop and 390px mobile without page overflow');
          }
        }
      }
    }
    status = 'passed';
  } catch (error) {
    await record('Failure', { message: error instanceof Error ? error.message : String(error) });
    if (context) for (const page of context.pages()) await capture(page, 'failure').catch(() => undefined);
    throw error;
  } finally {
    await context?.tracing.stop({ path: join(directory, 'trace.zip') });
    await browser?.close();
    const result = { status, feature, instance: instance.id, checks, finishedAt: new Date().toISOString(), evidence: directory, scope: 'Isolated local Node services, real HTTP MCP and built Astro panel; not deployed Worker or actual Claude/Codex client acceptance.' };
    await json(join(directory, 'result.json'), result);
    console.log(JSON.stringify(result));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === script) try {
  args = process.argv.slice(2);
  const command = args[0];
  const runIndex = args.indexOf('--run');
  run = resolve(root, runIndex >= 0 ? args[runIndex + 1] ?? '' : `.test-artifacts/verify-artifacts/${Date.now()}-${randomUUID().slice(0, 8)}`);
  assert(run.startsWith(join(root, '.test-artifacts/verify-artifacts/')), 'Run directories must be below .test-artifacts/verify-artifacts/');
  runtime = join(run, 'runtime');
  if (command === 'launch') await launch();
  else if (command === 'serve') await supervisor();
  else if (command === 'doctor') { const { proof } = await doctor(); console.log(JSON.stringify(proof)); }
  else if (command === 'cleanup') await cleanup();
  else if (command === 'drive') { const feature = args[1]; assert(features.includes(feature as Feature), `Choose drive ${features.join('|')}`); await drive(feature as Feature); }
  else throw new Error('Usage: control.ts launch [--run PATH] | doctor --run PATH | drive FEATURE [--headed] --run PATH | cleanup --run PATH');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
