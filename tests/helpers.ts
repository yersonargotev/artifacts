import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { openDatabase } from '../packages/db/src/index.ts';
import { migrateDatabase } from '../packages/db/src/migrate.ts';
import { createAuth } from '../apps/auth/src/auth.ts';
import { createAuthApp } from '../apps/auth/src/http.ts';
import { createMcpApp } from '../apps/mcp/src/http.ts';

export async function fixture(options: { dashboard?: string } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-identity-'));
  const url = `file:${join(directory, 'identity.db')}`;
  await migrateDatabase(url);
  const connection = await openDatabase({ url });
  let authHandler: (request: Request) => Promise<Response> = async () => new Response(null, { status: 503 });
  let mcpHandler = authHandler;
  const authServer = serve({ fetch: (request) => authHandler(request), hostname: '127.0.0.1', port: 0 });
  const mcpServer = serve({ fetch: (request) => mcpHandler(request), hostname: '127.0.0.1', port: 0 });
  await Promise.all([once(authServer, 'listening'), once(mcpServer, 'listening')]);
  const authAddress = authServer.address();
  const mcpAddress = mcpServer.address();
  assert(authAddress && typeof authAddress === 'object');
  assert(mcpAddress && typeof mcpAddress === 'object');
  const origin = `http://127.0.0.1:${authAddress.port}`;
  const config = { origin, issuer: `${origin}/api/auth`, secret: randomBytes(32).toString('base64url'), resource: `http://127.0.0.1:${mcpAddress.port}/mcp`, dashboard: options.dashboard ?? 'http://localhost:4321' };
  const auth = createAuth(connection.db, config, true);
  const password = randomBytes(24).toString('base64url');
  const owner = await auth.api.signUpEmail({ body: { name: 'Test owner', email: 'owner@example.test', password } });
  const signIn = await auth.api.signInEmail({ body: { email: 'owner@example.test', password }, returnHeaders: true });
  const cookie = signIn.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const headers = new Headers({ cookie });
  const resourceClient = await auth.api.adminCreateOAuthClient({ headers, body: { client_name: 'Resource introspection', application_type: 'native', redirect_uris: ['http://127.0.0.1/unused'], token_endpoint_auth_method: 'client_secret_basic', grant_types: ['authorization_code'], response_types: ['code'], scope: 'openid profile' } });
  assert(resourceClient.client_secret);
  const mcpOptions = { issuer: config.issuer, resource: config.resource, clientId: resourceClient.client_id, clientSecret: resourceClient.client_secret };
  authHandler = createAuthApp(connection.db, config);
  mcpHandler = createMcpApp(mcpOptions);
  return {
    ...connection, databaseUrl: url, auth, config, mcpOptions, ownerId: owner.user.id, cookie, password,
    setAuthHandler(handler: typeof authHandler) { authHandler = handler; },
    async close() {
      if ('closeAllConnections' in authServer) authServer.closeAllConnections();
      if ('closeAllConnections' in mcpServer) mcpServer.closeAllConnections();
      await Promise.all([new Promise<void>((resolve) => authServer.close(() => resolve())), new Promise<void>((resolve) => mcpServer.close(() => resolve()))]);
      connection.client.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export async function grant(app: Awaited<ReturnType<typeof fixture>>, scope = 'openid profile offline_access artifacts:read') {
  const registration = await fetch(`${app.config.issuer}/oauth2/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Identity integration', redirect_uris: ['http://127.0.0.1:49999/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  });
  assert.equal(registration.status, 201, `registration status ${registration.status}`);
  const registered = await registration.json() as { client_id: string; application_type: string };
  assert.equal(registered.application_type, 'native');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const redirectUri = 'http://127.0.0.1:49998/callback';
  const parameters = new URLSearchParams({ client_id: registered.client_id, redirect_uri: redirectUri, response_type: 'code', scope, state: randomBytes(16).toString('hex'), code_challenge: challenge, code_challenge_method: 'S256', resource: app.config.resource });
  const authorization = await fetch(`${app.config.issuer}/oauth2/authorize?${parameters}`, { headers: { cookie: app.cookie, accept: 'text/html', 'sec-fetch-mode': 'navigate' }, redirect: 'manual' });
  assert.equal(authorization.status, 200, `authorization status ${authorization.status}`);
  const authorizationResult = await authorization.json() as { url: string };
  const consent = new URL(authorizationResult.url, app.config.origin);
  assert.equal(consent.pathname, '/consent');
  const result = await fetch(`${app.config.issuer}/oauth2/consent`, { method: 'POST', headers: { cookie: app.cookie, origin: app.config.origin, 'content-type': 'application/json' }, body: JSON.stringify({ accept: true, oauth_query: consent.search.slice(1) }) });
  assert.equal(result.status, 200, `consent status ${result.status}`);
  const approved = await result.json() as { url?: string; redirect_uri?: string };
  const callback = new URL(approved.url ?? approved.redirect_uri!);
  const tokenBody = { grant_type: 'authorization_code', client_id: registered.client_id, redirect_uri: redirectUri, code: callback.searchParams.get('code')!, code_verifier: verifier, resource: app.config.resource };
  const response = await fetch(`${app.config.issuer}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(tokenBody) });
  assert.equal(response.status, 200, `token status ${response.status}`);
  const tokens = await response.json() as { access_token: string; refresh_token: string; id_token: string };
  return { ...tokens, clientId: registered.client_id, tokenBody };
}

export function callWhoami(resource: string, token?: string) {
  return fetch(resource, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whoami', arguments: {} } }) });
}
