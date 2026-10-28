import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { serve } from '@hono/node-server';
import { chromium, type Browser, type Page } from 'playwright';
import { createAuthApp } from '../apps/auth/src/http.ts';
import { createPublicationApp } from '../apps/publication/src/http.ts';
import { createArtifactHttpClient } from '../packages/client/src/index.ts';
import { fixture, grant, callWhoami } from './helpers.ts';

const execute = promisify(execFile);
const evidence = resolve(`.test-artifacts/owner-access/browser-${randomUUID()}`);
await mkdir(evidence, { recursive: true, mode: 0o700 });
const reserve = createServer().listen(0, '127.0.0.1');
await once(reserve, 'listening');
const address = reserve.address();
assert(address && typeof address === 'object');
await new Promise<void>((done) => reserve.close(() => done()));
const panelPort = address.port;
const dashboard = `http://localhost:${panelPort}`;
let publication = async (_request: Request) => new Response(null, { status: 503 });
const viewerServer = serve({ hostname: '::1', port: 0, fetch: (request) => publication(request) });
await once(viewerServer, 'listening');
const viewerAddress = viewerServer.address();
assert(viewerAddress && typeof viewerAddress === 'object');
const publishOrigin = `http://[::1]:${viewerAddress.port}`;
const app = await fixture({ transport: 'combined', emailCode: true, allowGuests: true, dashboard, publishOrigin });
const serviceSecret = randomBytes(32).toString('hex');
publication = createPublicationApp({ DASHBOARD_URL: dashboard, PUBLISH_URL: publishOrigin, PUBLICATION_SERVICE_SECRET: serviceSecret, PUBLICATION_COOKIE_SECRET: randomBytes(32).toString('hex') });
const client = await app.auth.api.adminCreateOAuthClient({ headers: new Headers({ cookie: app.cookie }), body: { client_name: 'Owner access proof panel', application_type: 'native', redirect_uris: [`${dashboard}/auth/callback`], token_endpoint_auth_method: 'client_secret_basic', grant_types: ['authorization_code'], response_types: ['code'], scope: 'openid profile', enable_end_session: true, skip_consent: true, require_pkce: true } });
assert(client.client_secret);
let panel: ChildProcess | undefined;
let browser: Browser | undefined;
const handlers: ReturnType<typeof createAuthApp>[] = [];
const checks: Array<{ check: string; result: string }> = [];
const browserErrors: string[] = [];
let status = 'failed';
async function stopPanel() {
  if (panel && panel.exitCode === null && panel.signalCode === null) { panel.kill('SIGTERM'); await once(panel, 'exit'); }
}
async function mode(allowGuests: boolean) {
  await stopPanel();
  const auth = createAuthApp(app.db, { ...app.config, access: { ...app.config.access, allowGuests } });
  handlers.push(auth);
  app.setAuthHandler(auth);
  panel = spawn(process.execPath, ['apps/dashboard/dist/server/entry.mjs'], { env: { PATH: process.env.PATH, DATABASE_URL: app.databaseUrl, DATABASE_AUTH_TOKEN: '', AUTH_URL: app.config.origin, MCP_URL: app.config.resource, DASHBOARD_URL: dashboard, PUBLISH_URL: publishOrigin, OWNER_EMAIL: 'owner@example.test', ALLOW_GUEST_ACCESS: String(allowGuests), PUBLICATION_SERVICE_SECRET: serviceSecret, PANEL_CLIENT_ID: client.client_id, PANEL_CLIENT_SECRET: client.client_secret!, PORT: String(panelPort), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  panel.stderr!.on('data', (chunk) => { errors += String(chunk); });
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(panel.exitCode, null, `panel startup ${errors.slice(0, 500)}`);
    if (await fetch(dashboard).then((response) => response.status === 200).catch(() => false)) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Panel did not start ${errors.slice(0, 500)}`);
}
async function capture(page: Page, name: string) {
  await page.screenshot({ path: join(evidence, `${name}.png`), fullPage: true });
  await writeFile(join(evidence, `${name}.aria.yml`), await page.locator('body').ariaSnapshot());
}
async function codeSignIn(page: Page, email: string) {
  await page.goto(dashboard);
  await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Recibir código', exact: true }).click();
  await page.getByLabel('Código de acceso', { exact: true }).waitFor();
  let otp: string | undefined;
  for (let attempt = 0; attempt < 100 && !otp; attempt++) {
    const messages = (await readFile(app.emailSink!, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { to: string; text: string });
    otp = messages.filter((message) => message.to === email).at(-1)?.text.match(/\b\d{6}\b/)?.[0];
    if (!otp) await new Promise((done) => setTimeout(done, 20));
  }
  assert(otp, 'private disposable mail sink contains the requested code');
  await page.getByLabel('Código de acceso', { exact: true }).fill(otp);
  await page.locator('#code-fields').getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
}
try {
  await mode(true);
  browser = await chromium.launch(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : { channel: 'chrome' });
  assert(Number(browser.version().split('.')[0]) >= 152, 'Interactive publication requires Chromium 152 or newer');
  const ownerContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const guest = await guestContext.newPage();
  for (const page of [owner, guest]) page.on('pageerror', (error) => browserErrors.push(error.message));
  const ownerTokens = await grant(app, 'openid profile offline_access artifacts:read artifacts:write artifacts:publish');
  const ownerClient = createArtifactHttpClient({ resource: app.config.resource, accessToken: ownerTokens.access_token });
  const artifact = await ownerClient.create({ requestId: randomUUID(), snapshot: { metadata: { title: 'Owner access proof', description: '' }, content: { kind: 'html', text: '<h1>Protected access proof</h1><button onclick="this.textContent=\'Interaction verified\'">Try interaction</button>' }, files: [{ path: 'proof.txt', mediaType: 'text/plain', encoding: 'utf8', data: 'Protected attachment.' }] } });
  await ownerClient.publish({ requestId: randomUUID(), artifactId: artifact.artifactId, revisionId: artifact.revision.id, expectedPublicationVersion: 0 });
  await ownerClient.share({ requestId: randomUUID(), artifactId: artifact.artifactId, email: 'guest@example.test' });
  await owner.goto(dashboard);
  await owner.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  await owner.getByLabel('Correo electrónico', { exact: true }).fill('owner@example.test');
  await owner.getByLabel('Contraseña', { exact: true }).fill(app.password);
  await owner.getByRole('button', { name: 'Iniciar sesión', exact: true }).first().click();
  await owner.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
  await capture(owner, 'open-owner-password');
  await codeSignIn(guest, 'guest@example.test');
  await capture(guest, 'open-guest-panel');
  const guestCookies = await guestContext.cookies(app.config.origin);
  const guestCookie = guestCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  const guestTokens = await grant({ ...app, cookie: guestCookie });
  const publicationUrl = `${publishOrigin}/a/${artifact.artifactId}`;
  await guest.goto(publicationUrl);
  await guest.frameLocator('iframe').getByRole('heading', { name: 'Protected access proof', exact: true }).waitFor();
  await guest.frameLocator('iframe').getByRole('button', { name: 'Try interaction' }).click();
  await guest.frameLocator('iframe').getByRole('button', { name: 'Interaction verified' }).waitFor();
  await capture(guest, 'open-guest-publication');
  const savedState = await guestContext.storageState();
  assert.equal((await callWhoami(app.config.resource, guestTokens.access_token)).status, 200);
  checks.push({ check: 'open', result: 'owner password, guest code, panel, interactive publication, HTTP MCP pass' });
  await mode(false);
  const oldViewerCookie = savedState.cookies.filter((cookie) => cookie.domain === '[::1]').map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  for (const path of ['content', 'files/proof.txt']) {
    const response = await fetch(`${publishOrigin}/a/${artifact.artifactId}/r/${artifact.revision.id}/${path}`, { headers: { cookie: oldViewerCookie }, redirect: 'manual' });
    assert.equal(response.status, 403, 'old guest viewer cookie cannot read content or attachments');
    assert(!await response.text().then((body) => body.includes('Protected attachment.')));
  }
  const denied = await guest.reload();
  assert.equal(denied?.status(), 403);
  assert.equal(await guest.locator('iframe').count(), 0);
  await capture(guest, 'closed-old-guest-publication');
  const attachment = await guestContext.request.get(`${publishOrigin}/a/${artifact.artifactId}/r/${artifact.revision.id}/files/proof.txt`);
  assert.equal(attachment.status(), 401);
  await guest.goto(dashboard);
  await guest.getByRole('link', { name: 'Iniciar sesión', exact: true }).waitFor();
  await capture(guest, 'closed-old-guest-panel');
  assert.equal((await callWhoami(app.config.resource, guestTokens.access_token)).status, 401);
  await owner.goto(dashboard);
  await owner.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
  await owner.goto(publicationUrl);
  await owner.frameLocator('iframe').getByRole('heading', { name: 'Protected access proof', exact: true }).waitFor();
  await capture(owner, 'closed-owner-publication');
  const cli = await execute(process.execPath, ['--import', 'tsx', 'apps/cli/src/index.ts', 'whoami', '--server', app.config.resource, '--state-dir', join(evidence, 'cli-state')], { env: { PATH: process.env.PATH, ARTIFACTS_ACCESS_TOKEN: ownerTokens.access_token } });
  assert.equal((JSON.parse(cli.stdout) as { userId: string }).userId, app.ownerId);
  assert.equal((await callWhoami(app.config.resource, ownerTokens.access_token)).status, 200);
  const ownerCodeContext = await browser.newContext();
  const ownerCode = await ownerCodeContext.newPage();
  await codeSignIn(ownerCode, 'owner@example.test');
  await capture(ownerCode, 'closed-owner-code');
  checks.push({ check: 'closed', result: 'old guest panel, publication, attachment and MCP denied; owner session, publication, code, CLI and MCP pass' });
  await mode(true);
  const restored = await browser.newContext({ storageState: savedState });
  const restoredPage = await restored.newPage();
  await restoredPage.goto(dashboard);
  await restoredPage.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
  await restoredPage.goto(publicationUrl);
  await restoredPage.frameLocator('iframe').getByRole('heading', { name: 'Protected access proof', exact: true }).waitFor();
  await capture(restoredPage, 'reopened-old-guest-cookies');
  assert.equal((await callWhoami(app.config.resource, guestTokens.access_token)).status, 200);
  assert.deepEqual(browserErrors, []);
  checks.push({ check: 'reopened', result: 'same guest panel cookie, publication cookie and bearer work without reissuing credentials' });
  status = 'passed';
} finally {
  const version = browser?.version();
  await browser?.close();
  await stopPanel();
  if ('closeAllConnections' in viewerServer) viewerServer.closeAllConnections();
  await new Promise<void>((done) => viewerServer.close(() => done()));
  for (const handler of handlers) await handler.drain();
  await app.close();
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ status, browser: version, checks, browserErrors, cleanup: 'stopped; disposable database and credentials removed' }, null, 2));
  console.log(JSON.stringify({ status, evidence, browser: version, checks }));
}
