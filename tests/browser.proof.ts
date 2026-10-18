import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';
import { callWhoami, fixture, grant } from './helpers.ts';

const reservation = createServer().listen(0, '127.0.0.1');
await once(reservation, 'listening');
const address = reservation.address();
assert(address && typeof address === 'object');
await new Promise<void>((resolve) => reservation.close(() => resolve()));
const dashboard = `http://localhost:${address.port}`;
const app = await fixture({ dashboard });
const client = await app.auth.api.adminCreateOAuthClient({ headers: new Headers({ cookie: app.cookie }), body: { client_name: 'Browser proof dashboard', application_type: 'native', redirect_uris: [`${dashboard}/auth/callback`], token_endpoint_auth_method: 'client_secret_basic', grant_types: ['authorization_code'], response_types: ['code'], scope: 'openid profile', enable_end_session: true, skip_consent: true, require_pkce: true } });
assert(client.client_secret);
const child = spawn(process.execPath, ['apps/dashboard/dist/server/entry.mjs'], {
  env: { ...process.env, DATABASE_URL: app.databaseUrl, DATABASE_AUTH_TOKEN: '', AUTH_URL: app.config.origin, MCP_URL: app.config.resource, DASHBOARD_URL: dashboard, PUBLISH_URL: 'http://[::1]:4102', PUBLICATION_SERVICE_SECRET: randomBytes(32).toString('hex'), PUBLICATION_COOKIE_SECRET: randomBytes(32).toString('hex'), PANEL_CLIENT_ID: client.client_id, PANEL_CLIENT_SECRET: client.client_secret, PORT: String(address.port), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let startupError = '';
child.stderr.on('data', (data: Buffer) => { startupError += data.toString(); });
let browser: Browser | undefined;
try {
  browser = await chromium.launch({ channel: 'chrome' });
  let ready = false;
  let lastStatus = '';
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) throw new Error(`Dashboard exited before startup: ${startupError.slice(0, 300)}`);
    ready = await fetch(dashboard).then(async (response) => { lastStatus = `${response.status} ${(await response.text()).slice(0, 120)}`; return response.ok; }).catch((error: Error) => { lastStatus = error.message; return false; });
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, `Built dashboard starts independently: ${lastStatus}; ${startupError.slice(0, 200)}`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(dashboard);
  await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByLabel('Correo electrónico').fill('owner@example.test');
  await page.getByLabel('Contraseña').fill(app.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
  await mkdir('.test-artifacts', { recursive: true });
  await page.screenshot({ path: '.test-artifacts/library-desktop.png' });
  await page.locator('summary[aria-label="Mi cuenta"]').click();
  await page.getByTestId('user-id').waitFor();
  assert.equal(await page.getByTestId('user-id').textContent(), app.ownerId);
  const token = await grant(app);
  const logoutResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/auth/logout' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Cerrar sesión del panel', exact: true }).click();
  const logout = await logoutResponse;
  assert.equal(logout.status(), 303);
  assert.equal(await logout.request().headerValue('origin'), dashboard);
  await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).waitFor();
  assert.equal((await callWhoami(app.config.resource, token.access_token)).status, 200);
  await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
  await page.locator('summary[aria-label="Mi cuenta"]').click();
  await page.getByTestId('user-id').waitFor();
  await mkdir('.test-artifacts', { recursive: true });
  await page.screenshot({ path: '.test-artifacts/dashboard-desktop.png', fullPage: true });
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(dashboard);
  await mobile.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
  await mobile.screenshot({ path: '.test-artifacts/library-mobile.png' });
  await mobile.locator('.library-navigation > summary').click();
  await mobile.locator('summary[aria-label="Mi cuenta"]').click();
  await mobile.getByTestId('user-id').waitFor();
  await mobile.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  assert.equal(await mobile.locator('header.workspace-toolbar').count(), 1);
  assert.equal(await mobile.locator('main > header.library-header').count(), 1);
  assert.equal(await mobile.locator('h1').count(), 1);
  assert.equal(await mobile.locator('.identity').count(), 1);
  assert.equal(await mobile.locator('footer').count(), 1);
  assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.screenshot({ path: '.test-artifacts/dashboard-mobile.png', fullPage: true });
  await mobile.close();
  await page.getByRole('link', { name: 'Cerrar todas las sesiones', exact: true }).click();
  const revokeResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/revoke-all' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Cerrar todas las sesiones', exact: true }).click();
  const revoked = await revokeResponse;
  assert.equal(revoked.status(), 303);
  assert.equal(await revoked.request().headerValue('origin'), app.config.origin);
  await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).waitFor();
  assert.equal((await callWhoami(app.config.resource, token.access_token)).status, 401);
  const cookies = await page.context().cookies();
  assert(!cookies.some((cookie) => cookie.name === 'artifacts-panel' || cookie.name === 'artifacts-auth.session_token'));
  console.log('Browser proof passed: signed OIDC identity, native panel logout, central SSO, global revocation, cookies, desktop and mobile.');
} finally {
  await browser?.close();
  child.kill('SIGTERM');
  if (child.exitCode === null) await once(child, 'exit');
  await app.close();
}
