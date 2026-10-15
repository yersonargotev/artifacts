import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createPublicationApp } from '../apps/publication/src/http.ts';
import { fixture } from './helpers.ts';

export async function restCliFixture() {
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  assert(address && typeof address === 'object');
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const dashboard = `http://localhost:${address.port}`;
  let publication = async (_request: Request) => new Response(null, { status: 503 });
  const publicationServer = serve({ fetch: (request) => publication(request), hostname: '::1', port: 0 });
  await once(publicationServer, 'listening');
  const publicationAddress = publicationServer.address();
  assert(publicationAddress && typeof publicationAddress === 'object');
  const publishOrigin = `http://[::1]:${publicationAddress.port}`;
  const app = await fixture({ transport: 'combined', dashboard, publishOrigin });
  const serviceSecret = randomBytes(32).toString('hex');
  publication = createPublicationApp({ DASHBOARD_URL: dashboard, PUBLISH_URL: publishOrigin, PUBLICATION_SERVICE_SECRET: serviceSecret, PUBLICATION_COOKIE_SECRET: randomBytes(32).toString('hex') });
  const client = await app.auth.api.adminCreateOAuthClient({ headers: new Headers({ cookie: app.cookie }), body: { client_name: 'REST CLI proof panel', application_type: 'native', redirect_uris: [`${dashboard}/auth/callback`], token_endpoint_auth_method: 'client_secret_basic', grant_types: ['authorization_code'], response_types: ['code'], scope: 'openid profile', enable_end_session: true, skip_consent: true, require_pkce: true } });
  assert(client.client_secret);
  await mkdir('.test-artifacts', { recursive: true });
  const panelDirectory = await mkdtemp('.test-artifacts/rest-cli-panel-');
  await cp('apps/dashboard/dist', panelDirectory, { recursive: true });
  await symlink(resolve('apps/dashboard/node_modules'), join(panelDirectory, 'node_modules'));
  const panel = spawn(process.execPath, [join(panelDirectory, 'server/entry.mjs')], { env: { PATH: process.env.PATH, DATABASE_URL: app.databaseUrl, DATABASE_AUTH_TOKEN: '', AUTH_URL: app.config.origin, MCP_URL: app.config.resource, DASHBOARD_URL: dashboard, PUBLISH_URL: publishOrigin, PUBLICATION_SERVICE_SECRET: serviceSecret, PANEL_CLIENT_ID: client.client_id, PANEL_CLIENT_SECRET: client.client_secret, PORT: String(address.port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let startup = '';
  panel.stderr.on('data', (value: Buffer) => { startup += value.toString(); });
  const close = async () => {
    if (panel.exitCode === null) { panel.kill('SIGTERM'); await once(panel, 'exit'); }
    if ('closeAllConnections' in publicationServer) publicationServer.closeAllConnections();
    await new Promise<void>((resolve) => publicationServer.close(() => resolve()));
    await app.close();
    await rm(panelDirectory, { recursive: true, force: true });
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (panel.exitCode !== null) throw new Error(`Panel startup failed: ${startup.slice(0, 500)}`);
      ready = await fetch(dashboard, { signal: AbortSignal.timeout(500) }).then((response) => response.ok).catch(() => false);
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(ready, `Built Node panel starts: ${startup.slice(0, 500)}`);
    return { ...app, dashboard, publishOrigin, close };
  } catch (error) { await close(); throw error; }
}
