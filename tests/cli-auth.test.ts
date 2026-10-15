import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createAuthApp } from '../apps/auth/src/http.ts';
import { fixture } from './helpers.ts';

type App = Awaited<ReturnType<typeof fixture>>;
const cliPath = fileURLToPath(new URL('../apps/cli/src/index.ts', import.meta.url));

async function setup(t: TestContext) {
  const app = await fixture({ transport: 'rest' });
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-cli-auth-'));
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { app, directory };
}

function command(t: TestContext, app: App, directory: string, args: string[], extraEnvironment: NodeJS.ProcessEnv = {}) {
  const environment = { ...process.env, ARTIFACTS_ACCESS_TOKEN: undefined, NODE_NO_WARNINGS: '1', ...extraEnvironment };
  const child = spawn(process.execPath, ['--import', 'tsx', cliPath, ...args, '--server', app.config.resource, '--state-dir', directory], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (text: string) => { stdout += text; });
  child.stderr.setEncoding('utf8').on('data', (text: string) => { stderr += text; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 25_000);
  const result = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
  t.after(() => { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  return {
    child, result,
    async authorizationUrl() {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const url = stderr.split('\n').find((line) => line.startsWith('http://') || line.startsWith('https://'));
        if (url) return new URL(url);
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Login exited before authorization: ${stderr}`);
        await delay(10);
      }
      throw new Error(`No authorization URL: ${stderr}`);
    },
  };
}

async function request(url: string | URL, options: RequestInit = {}) {
  return fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
}

async function approve(app: App, authorization: URL) {
  const response = await request(authorization, { headers: { cookie: app.cookie, accept: 'text/html', 'sec-fetch-mode': 'navigate' } });
  let callback: URL;
  if (response.status === 302 || response.status === 303) callback = new URL(response.headers.get('location')!);
  else {
    assert.equal(response.status, 200);
    const authorized = await response.json() as { url: string };
    const next = new URL(authorized.url, app.config.origin);
    if (next.pathname === '/consent') {
      const consent = await request(`${app.config.issuer}/oauth2/consent`, { method: 'POST', headers: { cookie: app.cookie, origin: app.config.origin, 'content-type': 'application/json' }, body: JSON.stringify({ accept: true, oauth_query: next.search.slice(1) }) });
      assert.equal(consent.status, 200);
      const approved = await consent.json() as { url?: string; redirect_uri?: string };
      callback = new URL(approved.url ?? approved.redirect_uri!);
    } else callback = next;
  }
  const result = await request(callback);
  assert.equal(result.status, 200);
  assert.equal(await result.text(), 'Authorization received. Return to the terminal to check the result.');
  return callback;
}

async function signIn(t: TestContext, app: App, directory: string) {
  const login = command(t, app, directory, ['login', '--no-browser']);
  const url = await login.authorizationUrl();
  await approve(app, url);
  const result = await login.result;
  assert.equal(result.code, 0, result.stderr);
  const identity = JSON.parse(result.stdout) as { userId: string; sessionId: string; clientId: string; scopes: string[] };
  assert.equal(identity.userId, app.ownerId);
  assert.deepEqual(identity.scopes, ['openid', 'profile', 'offline_access', 'artifacts:read', 'artifacts:write', 'artifacts:publish']);
  assert.equal(identity.clientId, url.searchParams.get('client_id'));
  return { identity, url };
}

function storedProfile(directory: string, resource: string) {
  const db = new DatabaseSync(join(directory, 'credentials.sqlite'));
  try {
    const row = db.prepare('SELECT profile FROM profiles WHERE resource = ?').get(resource)!;
    return JSON.parse(String(row.profile)) as { epoch: number; registration: { issuer: string; clientId: string }; tokens: { accessToken: string; refreshToken: string }; refreshAttempt: string | null };
  } finally { db.close(); }
}

function interceptTokens(app: App, inspect: (body: URLSearchParams, response: Response) => Promise<Response>) {
  const handler = createAuthApp(app.db, app.config);
  app.setAuthHandler(async (incoming) => {
    const body = new URL(incoming.url).pathname.endsWith('/oauth2/token') ? new URLSearchParams(await incoming.clone().text()) : undefined;
    const response = await handler(incoming);
    return body ? inspect(body, response) : response;
  });
}

async function shortInitialToken(body: URLSearchParams, response: Response) {
  if (body.get('grant_type') !== 'authorization_code') return response;
  assert.equal(response.status, 200);
  return Response.json({ ...await response.json() as Record<string, unknown>, expires_in: 1 });
}

test('CLI native login reuses its public registration, keeps private state, and clears and revokes logout', { timeout: 40_000 }, async (t) => {
  const { app, directory } = await setup(t);
  let registrations = 0;
  const handler = createAuthApp(app.db, app.config);
  app.setAuthHandler(async (incoming) => {
    if (new URL(incoming.url).pathname.endsWith('/oauth2/register')) {
      registrations++;
      const body = await incoming.clone().json() as Record<string, unknown>;
      assert.equal(body.application_type, 'native');
      assert.equal(body.token_endpoint_auth_method, 'none');
      assert.equal('client_secret' in body, false);
      assert.deepEqual(body.grant_types, ['authorization_code', 'refresh_token']);
    }
    return handler(incoming);
  });
  const first = await signIn(t, app, directory);
  assert.equal(first.url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(first.url.searchParams.get('resource'), app.config.resource);
  const whoami = await command(t, app, directory, ['whoami']).result;
  assert.equal(whoami.code, 0, whoami.stderr);
  assert.deepEqual(JSON.parse(whoami.stdout), first.identity);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  for (const file of await readdir(directory)) assert.equal((await stat(join(directory, file))).mode & 0o777, 0o600);
  const original = storedProfile(directory, app.config.resource);
  const signedOut = await command(t, app, directory, ['logout']).result;
  assert.equal(signedOut.code, 0, signedOut.stderr);
  assert.deepEqual(JSON.parse(signedOut.stdout), { signedOut: true, remoteRevocation: 'confirmed' });
  const denied = await command(t, app, directory, ['whoami']).result;
  assert.equal(denied.code, 1);
  assert.match(denied.stderr, /You are not signed in\. Run artifacts login --server /);
  const automation = await command(t, app, directory, ['whoami'], { ARTIFACTS_ACCESS_TOKEN: original.tokens.accessToken }).result;
  assert.equal(automation.code, 0, automation.stderr);
  assert.deepEqual(JSON.parse(automation.stdout), first.identity);
  const second = await signIn(t, app, directory);
  assert.equal(second.identity.clientId, first.identity.clientId);
  assert.equal(registrations, 1);
});

test('CLI callback rejects an incorrect path, state, issuer, and duplicate parameters before accepting the real grant', { timeout: 30_000 }, async (t) => {
  const { app, directory } = await setup(t);
  const login = command(t, app, directory, ['login', '--no-browser']);
  const authorization = await login.authorizationUrl();
  const callback = new URL(authorization.searchParams.get('redirect_uri')!);
  callback.search = new URLSearchParams({ code: 'invalid-code', state: authorization.searchParams.get('state')!, iss: app.config.issuer }).toString();
  const wrongPath = new URL(callback); wrongPath.pathname = '/another/callback';
  assert.equal((await request(wrongPath)).status, 404);
  const wrongState = new URL(callback); wrongState.searchParams.set('state', 'incorrect-state');
  assert.equal((await request(wrongState)).status, 400);
  const wrongIssuer = new URL(callback); wrongIssuer.searchParams.set('iss', 'https://other.example/auth');
  assert.equal((await request(wrongIssuer)).status, 400);
  const duplicated = new URL(callback); duplicated.searchParams.append('state', authorization.searchParams.get('state')!);
  assert.equal((await request(duplicated)).status, 400);
  const wrongHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const outgoing = httpRequest(callback, { headers: { host: 'localhost' }, signal: AbortSignal.timeout(10_000) }, (response) => { response.resume(); resolve(response.statusCode); });
    outgoing.once('error', reject); outgoing.end();
  });
  assert.equal(wrongHostStatus, 404);
  const actualCallback = await approve(app, authorization);
  const result = await login.result;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).userId, app.ownerId);
  await assert.rejects(request(actualCallback), /fetch failed/);
});

test('CLI logout advances the epoch while the browser waits and a late callback cannot restore credentials', { timeout: 30_000 }, async (t) => {
  const { app, directory } = await setup(t);
  const login = command(t, app, directory, ['login', '--no-browser']);
  const authorization = await login.authorizationUrl();
  const signedOut = await command(t, app, directory, ['logout']).result;
  assert.equal(signedOut.code, 0, signedOut.stderr);
  assert.deepEqual(JSON.parse(signedOut.stdout), { signedOut: true, remoteRevocation: 'not-needed' });
  await approve(app, authorization);
  const result = await login.result;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Login was superseded by another login or logout/);
  const whoami = await command(t, app, directory, ['whoami']).result;
  assert.equal(whoami.code, 1);
  assert.match(whoami.stderr, /You are not signed in/);
});

test('concurrent CLI commands serialize refresh and both use the rotated credentials', { timeout: 35_000 }, async (t) => {
  const { app, directory } = await setup(t);
  let refreshes = 0;
  interceptTokens(app, async (body, response) => {
    if (body.get('grant_type') === 'refresh_token') { refreshes++; await delay(150); }
    return shortInitialToken(body, response);
  });
  const { identity } = await signIn(t, app, directory);
  const results = await Promise.all([command(t, app, directory, ['whoami']).result, command(t, app, directory, ['whoami']).result]);
  for (const result of results) {
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), identity);
  }
  assert.equal(refreshes, 1);
  const signedOut = await command(t, app, directory, ['logout']).result;
  assert.deepEqual(JSON.parse(signedOut.stdout), { signedOut: true, remoteRevocation: 'confirmed' });
});

test('SIGKILL after provider rotation releases the SQLite lock and preserves uncertainty without replaying refresh', { timeout: 35_000 }, async (t) => {
  const { app, directory } = await setup(t);
  let refreshed!: () => void;
  const refreshReceived = new Promise<void>((resolve) => { refreshed = resolve; });
  let refreshes = 0;
  interceptTokens(app, async (body, response) => {
    if (body.get('grant_type') === 'refresh_token') {
      assert.equal(response.status, 200);
      refreshes++;
      refreshed();
      return new Promise<Response>(() => {});
    }
    return shortInitialToken(body, response);
  });
  await signIn(t, app, directory);
  const refreshing = command(t, app, directory, ['whoami']);
  await Promise.race([refreshReceived, delay(10_000, undefined, { ref: false }).then(() => { throw new Error('Refresh was not received'); })]);
  refreshing.child.kill('SIGKILL');
  assert.equal((await refreshing.result).signal, 'SIGKILL');
  const afterCrash = await command(t, app, directory, ['whoami']).result;
  assert.equal(afterCrash.code, 1);
  assert.match(afterCrash.stderr, /The previous token refresh has an uncertain result\. Run artifacts login --server /);
  assert.equal(refreshes, 1);
  const signedOut = await command(t, app, directory, ['logout']).result;
  assert.equal(signedOut.code, 0, signedOut.stderr);
  assert.deepEqual(JSON.parse(signedOut.stdout), { signedOut: true, remoteRevocation: 'unconfirmed' });
});

test('CLI rejects resource metadata mismatches and reports unconfirmed revocation without retaining local tokens', { timeout: 35_000 }, async (t) => {
  const { app, directory } = await setup(t);
  app.setResourceHandler(async (incoming) => new URL(incoming.url).pathname.startsWith('/.well-known/')
    ? Response.json({ resource: `${app.config.resource}/different`, authorization_servers: [app.config.issuer] })
    : app.resourceHandler(incoming));
  const rejected = await command(t, app, directory, ['login', '--no-browser']).result;
  assert.equal(rejected.code, 1);
  assert.match(rejected.stderr, /Protected resource metadata does not match the exact server URL/);
  app.setResourceHandler(app.resourceHandler);
  await signIn(t, app, directory);
  const handler = createAuthApp(app.db, app.config);
  app.setAuthHandler(async (incoming) => new URL(incoming.url).pathname.endsWith('/oauth2/revoke')
    ? new Response(null, { status: 503 }) : handler(incoming));
  const signedOut = await command(t, app, directory, ['logout']).result;
  assert.equal(signedOut.code, 0, signedOut.stderr);
  assert.deepEqual(JSON.parse(signedOut.stdout), { signedOut: true, remoteRevocation: 'unconfirmed' });
  const whoami = await command(t, app, directory, ['whoami']).result;
  assert.equal(whoami.code, 1);
  assert.match(whoami.stderr, /You are not signed in/);
});

test('CLI cancels browser login on SIGTERM and closes its exact loopback listener', { timeout: 25_000 }, async (t) => {
  const { app, directory } = await setup(t);
  const login = command(t, app, directory, ['login', '--no-browser']);
  const authorization = await login.authorizationUrl();
  login.child.kill('SIGTERM');
  const result = await login.result;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Login cancelled/);
  await assert.rejects(request(authorization.searchParams.get('redirect_uri')!), /fetch failed/);
  const whoami = await command(t, app, directory, ['whoami']).result;
  assert.equal(whoami.code, 1);
  assert.match(whoami.stderr, /You are not signed in/);
});

test('CLI verifies ID token signatures before saving the login', { timeout: 25_000 }, async (t) => {
  const { app, directory } = await setup(t);
  interceptTokens(app, async (body, response) => {
    if (body.get('grant_type') !== 'authorization_code') return response;
    const tokens = await response.json() as { id_token: string };
    const parts = tokens.id_token.split('.');
    parts[2] = (parts[2]!.startsWith('A') ? 'B' : 'A') + parts[2]!.slice(1);
    return Response.json({ ...tokens, id_token: parts.join('.') });
  });
  const login = command(t, app, directory, ['login', '--no-browser']);
  await approve(app, await login.authorizationUrl());
  const result = await login.result;
  assert.equal(result.code, 1);
  assert.deepEqual(JSON.parse(result.stderr.trim().split('\n').at(-1)!), { error: { code: 'local_error', message: 'invalid response encountered', details: {} } });
  const whoami = await command(t, app, directory, ['whoami']).result;
  assert.equal(whoami.code, 1);
  assert.match(whoami.stderr, /You are not signed in/);
});

test('CLI refuses issuer metadata with foreign, plaintext, or credential-bearing OAuth endpoints', { timeout: 25_000 }, async (t) => {
  const { app, directory } = await setup(t);
  const handler = createAuthApp(app.db, app.config);
  for (const tokenEndpoint of ['https://foreign.example/token', 'http://192.0.2.1/token', 'http://127.1/token', `${app.config.issuer}/oauth2/token?secret=value`]) {
    app.setAuthHandler(async (incoming) => {
      const response = await handler(incoming);
      if (!new URL(incoming.url).pathname.endsWith('/.well-known/openid-configuration')) return response;
      return Response.json({ ...await response.json() as Record<string, unknown>, token_endpoint: tokenEndpoint });
    });
    const rejected = await command(t, app, directory, ['login', '--no-browser']).result;
    assert.equal(rejected.code, 1);
    assert.match(rejected.stderr, /OAuth (endpoints must use the issuer origin|URLs require HTTPS)/);
  }
});

test('CLI never follows a redirect carrying refresh credentials', { timeout: 30_000 }, async (t) => {
  const { app, directory } = await setup(t);
  interceptTokens(app, shortInitialToken);
  await signIn(t, app, directory);
  let redirectedRequests = 0;
  const handler = createAuthApp(app.db, app.config);
  app.setAuthHandler(async (incoming) => {
    const path = new URL(incoming.url).pathname;
    if (path === '/redirected-token') { redirectedRequests++; return new Response(null, { status: 500 }); }
    if (path.endsWith('/oauth2/token')) return new Response(null, { status: 307, headers: { location: `${app.config.origin}/redirected-token` } });
    return handler(incoming);
  });
  const result = await command(t, app, directory, ['whoami']).result;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Token refresh failed and its result is uncertain/);
  const retry = await command(t, app, directory, ['whoami']).result;
  assert.equal(retry.code, 1);
  assert.match(retry.stderr, /The previous token refresh has an uncertain result/);
  assert.equal(redirectedRequests, 0);
});

test('CLI logout waits for in-flight refresh and revokes the rotated token before the next command', { timeout: 30_000 }, async (t) => {
  const { app, directory } = await setup(t);
  let received!: () => void;
  let release!: () => void;
  const refreshReceived = new Promise<void>((resolve) => { received = resolve; });
  const releaseRefresh = new Promise<void>((resolve) => { release = resolve; });
  let rotatedToken = '';
  let revokedToken = '';
  const handler = createAuthApp(app.db, app.config);
  app.setAuthHandler(async (incoming) => {
    const path = new URL(incoming.url).pathname;
    const body = incoming.method === 'POST' ? new URLSearchParams(await incoming.clone().text()) : undefined;
    if (path.endsWith('/oauth2/revoke')) revokedToken = body!.get('token')!;
    const response = await handler(incoming);
    if (!path.endsWith('/oauth2/token')) return response;
    if (body!.get('grant_type') === 'refresh_token') {
      const tokens = await response.json() as { refresh_token: string };
      rotatedToken = tokens.refresh_token;
      received();
      await releaseRefresh;
      return Response.json(tokens);
    }
    return shortInitialToken(body!, response);
  });
  const { identity } = await signIn(t, app, directory);
  const refreshing = command(t, app, directory, ['whoami']);
  await Promise.race([refreshReceived, delay(10_000, undefined, { ref: false }).then(() => { throw new Error('Refresh was not received'); })]);
  const loggingOut = command(t, app, directory, ['logout']);
  assert.equal(await Promise.race([loggingOut.result.then(() => 'completed'), delay(250).then(() => 'waiting')]), 'waiting');
  release();
  const current = await refreshing.result;
  assert.equal(current.code, 0, current.stderr);
  assert.deepEqual(JSON.parse(current.stdout), identity);
  const signedOut = await loggingOut.result;
  assert.equal(signedOut.code, 0, signedOut.stderr);
  assert.deepEqual(JSON.parse(signedOut.stdout), { signedOut: true, remoteRevocation: 'confirmed' });
  assert.equal(revokedToken, rotatedToken);
  const next = await command(t, app, directory, ['whoami']).result;
  assert.equal(next.code, 1);
  assert.match(next.stderr, /You are not signed in/);
});

test('CLI isolates DCR registrations and credentials by canonical resource', { timeout: 30_000 }, async (t) => {
  const { app, directory } = await setup(t);
  const other = await fixture({ transport: 'rest', resourcePath: '/other' });
  t.after(() => other.close());
  const first = await signIn(t, app, directory);
  const second = await signIn(t, other, directory);
  assert.notEqual(first.identity.clientId, second.identity.clientId);
  const signedOut = await command(t, app, directory, ['logout']).result;
  assert.deepEqual(JSON.parse(signedOut.stdout), { signedOut: true, remoteRevocation: 'confirmed' });
  const retained = await command(t, other, directory, ['whoami']).result;
  assert.equal(retained.code, 0, retained.stderr);
  assert.deepEqual(JSON.parse(retained.stdout), second.identity);
});

test('a stalled refresh times out, releases coordination, and requires login without a second token request', { timeout: 30_000 }, async (t) => {
  const { app, directory } = await setup(t);
  let refreshes = 0;
  interceptTokens(app, async (body, response) => {
    if (body.get('grant_type') === 'refresh_token') {
      refreshes++;
      return new Promise<Response>(() => {});
    }
    return shortInitialToken(body, response);
  });
  await signIn(t, app, directory);
  const timedOut = await command(t, app, directory, ['whoami']).result;
  assert.equal(timedOut.code, 1);
  assert.match(timedOut.stderr, /Token refresh failed and its result is uncertain/);
  const retry = await command(t, app, directory, ['whoami']).result;
  assert.equal(retry.code, 1);
  assert.match(retry.stderr, /The previous token refresh has an uncertain result/);
  assert.equal(refreshes, 1);
});

test('SIGTERM after the callback aborts token exchange and cannot save a partial login', { timeout: 25_000 }, async (t) => {
  const { app, directory } = await setup(t);
  let received!: () => void;
  const tokenReceived = new Promise<void>((resolve) => { received = resolve; });
  interceptTokens(app, async (body, response) => {
    if (body.get('grant_type') === 'authorization_code') { received(); return new Promise<Response>(() => {}); }
    return response;
  });
  const login = command(t, app, directory, ['login', '--no-browser']);
  const authorization = await login.authorizationUrl();
  await approve(app, authorization);
  await Promise.race([tokenReceived, delay(10_000, undefined, { ref: false }).then(() => { throw new Error('Token request was not received'); })]);
  login.child.kill('SIGTERM');
  const cancelled = await login.result;
  assert.equal(cancelled.code, 1);
  await assert.rejects(request(authorization.searchParams.get('redirect_uri')!), /fetch failed/);
  const whoami = await command(t, app, directory, ['whoami']).result;
  assert.equal(whoami.code, 1);
  assert.match(whoami.stderr, /You are not signed in/);
});

test('a changed resource issuer cannot receive the previous issuer refresh token during login', { timeout: 30_000 }, async (t) => {
  const { app, directory } = await setup(t);
  interceptTokens(app, shortInitialToken);
  await signIn(t, app, directory);
  const other = await fixture({ transport: 'rest' });
  t.after(() => other.close());
  let refreshesAtNewIssuer = 0;
  const otherHandler = createAuthApp(other.db, other.config);
  other.setAuthHandler(async (incoming) => {
    if (new URL(incoming.url).pathname.endsWith('/oauth2/token')) refreshesAtNewIssuer++;
    return otherHandler(incoming);
  });
  app.setResourceHandler(async (incoming) => new URL(incoming.url).pathname.startsWith('/.well-known/')
    ? Response.json({ resource: app.config.resource, authorization_servers: [other.config.issuer] })
    : app.resourceHandler(incoming));
  const login = command(t, app, directory, ['login', '--no-browser']);
  const authorization = await login.authorizationUrl();
  assert.equal(authorization.origin, other.config.origin);
  const whoami = await command(t, app, directory, ['whoami']).result;
  assert.equal(whoami.code, 1);
  assert.match(whoami.stderr, /You are not signed in/);
  assert.equal(refreshesAtNewIssuer, 0);
  login.child.kill('SIGTERM');
  assert.equal((await login.result).code, 1);
});
