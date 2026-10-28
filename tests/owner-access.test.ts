import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { createAuthApp } from '../apps/auth/src/http.ts';
import { createAuth } from '../apps/auth/src/auth.ts';
import { createArtifactHttpClient } from '../packages/client/src/index.ts';
import { createArtifactStore } from '../packages/artifacts/src/index.ts';
import { accessPolicy, authConfig } from '../packages/config/src/index.ts';
import { user } from '../packages/db/src/schema.ts';
import { fixture, grant, callWhoami } from './helpers.ts';

const scopes = 'openid profile offline_access artifacts:read artifacts:write artifacts:publish';
const guestEmail = 'invited@example.test';
const snapshot = { metadata: { title: 'Owner access fixture', description: '' }, content: { kind: 'html' as const, text: '<h1>Protected owner content</h1>' }, files: [] };
type App = Awaited<ReturnType<typeof fixture>>;
const cookieFrom = (response: Response) => response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
const post = (app: App, path: string, body: unknown, cookie?: string) => fetch(`${app.config.issuer}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: app.config.origin, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

test('policy defaults closed, requires the owner without email delivery, and rejects ambiguous flag values', () => {
  const base = { AUTH_URL: 'http://127.0.0.1:4100', MCP_URL: 'http://localhost:4101/mcp', DASHBOARD_URL: 'http://localhost:4321', BETTER_AUTH_SECRET: 'disposable-owner-policy-secret-over-32-characters' };
  assert.throws(() => authConfig(base), /OWNER_EMAIL/);
  assert.throws(() => authConfig({ ...base, OWNER_EMAIL: 'invalid' }), /OWNER_EMAIL/);
  assert.deepEqual(accessPolicy({ OWNER_EMAIL: ' OWNER@EXAMPLE.TEST ' }), { ownerEmail: 'owner@example.test', allowGuests: false });
  assert.deepEqual(accessPolicy({ OWNER_EMAIL: 'owner@example.test', ALLOW_GUEST_ACCESS: 'true' }), { ownerEmail: 'owner@example.test', allowGuests: true });
  assert.deepEqual(accessPolicy({ OWNER_EMAIL: 'owner@example.test', ALLOW_GUEST_ACCESS: 'false' }), { ownerEmail: 'owner@example.test', allowGuests: false });
  for (const value of ['', '1', 'TRUE', ' true ', 'yes']) assert.throws(() => accessPolicy({ OWNER_EMAIL: 'owner@example.test', ALLOW_GUEST_ACCESS: value }), /ALLOW_GUEST_ACCESS/);
});

async function pendingGrant(app: App, cookie: string) {
  const registration = await post(app, '/oauth2/register', { client_name: 'Pending policy grant', application_type: 'native', redirect_uris: ['http://127.0.0.1:49997/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] });
  assert.equal(registration.status, 201);
  const client = await registration.json() as { client_id: string };
  const verifier = randomBytes(32).toString('base64url');
  const parameters = new URLSearchParams({ client_id: client.client_id, redirect_uri: 'http://127.0.0.1:49997/callback', response_type: 'code', scope: scopes, state: randomUUID(), code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: app.config.resource });
  const authorization = await fetch(`${app.config.issuer}/oauth2/authorize?${parameters}`, { headers: { cookie, accept: 'text/html', 'sec-fetch-mode': 'navigate' }, redirect: 'manual' });
  assert.equal(authorization.status, 200);
  const consent = new URL((await authorization.json() as { url: string }).url, app.config.origin);
  const approved = await post(app, '/oauth2/consent', { accept: true, oauth_query: consent.search.slice(1) }, cookie);
  assert.equal(approved.status, 200);
  const result = await approved.json() as { url?: string; redirect_uri?: string };
  const code = new URL(result.url ?? result.redirect_uri!).searchParams.get('code')!;
  return { grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: 'http://127.0.0.1:49997/callback', code, code_verifier: verifier, resource: app.config.resource };
}

async function invited() {
  const app = await fixture({ allowGuests: true, emailCode: true, transport: 'combined' });
  const ownerToken = await grant(app, scopes);
  const ownerClient = createArtifactHttpClient({ resource: app.config.resource, accessToken: ownerToken.access_token });
  const artifact = await ownerClient.create({ requestId: randomUUID(), snapshot });
  const share = await ownerClient.share({ requestId: randomUUID(), artifactId: artifact.artifactId, email: guestEmail });
  await ownerClient.publish({ requestId: randomUUID(), artifactId: artifact.artifactId, revisionId: artifact.revision.id, expectedPublicationVersion: 0 });
  const guest = await app.auth.api.signUpEmail({ body: { email: guestEmail, name: 'Invited guest', password: app.password } });
  await app.db.update(user).set({ emailVerified: true }).where(eq(user.id, guest.user.id));
  const signed = await post(app, '/sign-in/email', { email: guestEmail, password: app.password });
  assert.equal(signed.status, 200);
  const cookie = cookieFrom(signed);
  const tokens = await grant({ ...app, cookie }, scopes);
  const state = await fetch(`${app.config.issuer}/get-session`, { headers: { cookie } }).then((response) => response.json()) as { session: { id: string }; user: { id: string } };
  const actor = { userId: state.user.id, sessionId: state.session.id, clientId: tokens.clientId, scopes: scopes.split(' ') };
  return { app, ownerToken, ownerClient, artifact, share, cookie, tokens, actor };
}

test('closing access denies old guest sessions, bearer tokens, refresh replay, and pending codes while the owner survives', async () => {
  const { app, ownerToken, cookie, tokens } = await invited();
  const handlers: ReturnType<typeof createAuthApp>[] = [];
  const exchange = (body: Record<string, string>) => fetch(`${app.config.issuer}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  const refreshBody = { grant_type: 'refresh_token', client_id: tokens.clientId, refresh_token: tokens.refresh_token, resource: app.config.resource };
  try {
    assert.equal((await callWhoami(app.config.resource, tokens.access_token)).status, 200);
    const pending = await pendingGrant(app, cookie);
    const rotated = await exchange(refreshBody);
    assert.equal(rotated.status, 200);
    const renewed = await rotated.json() as { access_token: string; refresh_token: string };
    const counts = await app.client.execute('SELECT (SELECT count(*) FROM session) AS sessions, (SELECT count(*) FROM artifact_share) AS shares');
    const closedConfig = { ...app.config, access: { ...app.config.access, allowGuests: false } };
    const closed = createAuthApp(app.db, closedConfig);
    handlers.push(closed);
    app.setAuthHandler(closed);
    const oldSession = await fetch(`${app.config.issuer}/get-session`, { headers: { cookie } });
    assert(oldSession.status === 401 || oldSession.status === 403 || (oldSession.status === 200 && await oldSession.json() === null));
    assert.equal((await callWhoami(app.config.resource, tokens.access_token)).status, 401);
    assert.equal((await callWhoami(app.config.resource, renewed.access_token)).status, 401);
    for (const body of [refreshBody, { ...refreshBody, refresh_token: renewed.refresh_token }, pending]) assert.equal((await exchange(body)).status, 400);
    const userinfo = await fetch(`${app.config.issuer}/oauth2/userinfo`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
    assert.equal(userinfo.status, 403);
    const deniedPassword = await post(app, '/sign-in/email', { email: guestEmail, password: app.password });
    assert(deniedPassword.status === 401 || deniedPassword.status === 403);
    assert.deepEqual(deniedPassword.headers.getSetCookie(), []);
    const direct = createAuth(app.db, closedConfig);
    await assert.rejects(() => direct.api.signInEmail({ body: { email: guestEmail, password: app.password } }));
    assert.equal((await callWhoami(app.config.resource, ownerToken.access_token)).status, 200);
    assert.equal((await exchange({ grant_type: 'refresh_token', client_id: ownerToken.clientId, refresh_token: ownerToken.refresh_token, resource: app.config.resource })).status, 200);
    assert.equal((await post(app, '/sign-in/email', { email: 'owner@example.test', password: app.password }, cookie)).status, 200, 'owner can recover while sending an old guest cookie');
    assert.equal((await post(app, '/sign-out', {}, cookie)).status, 200);
    assert.deepEqual((await app.client.execute('SELECT count(*) AS shares FROM artifact_share')).rows.map((row) => row.shares), counts.rows.map((row) => row.shares));
    const reopened = createAuthApp(app.db, app.config);
    handlers.push(reopened);
    app.setAuthHandler(reopened);
    assert.equal((await callWhoami(app.config.resource, tokens.access_token)).status, 401, 'explicit guest sign-out invalidated its session');
    const signin = await app.auth.api.signInEmail({ body: { email: guestEmail, password: app.password }, returnHeaders: true });
    const freshCookie = signin.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    assert.equal((await callWhoami(app.config.resource, (await grant({ ...app, cookie: freshCookie }, scopes)).access_token)).status, 200);
  } finally { for (const handler of handlers) await handler.drain(); await app.close(); }
});

test('closing access denies already issued publication grants and viewer cookies without deleting guest sessions', async () => {
  const { app, ownerClient, artifact, actor } = await invited();
  try {
    const opened = createArtifactStore(app.db, { publishOrigin: 'https://published.example.test', access: app.config.access });
    const input = { artifactId: artifact.artifactId, state: randomUUID() };
    const first = await opened.issuePublicationGrant(actor, input);
    const viewer = await opened.consumePublicationGrant({ ...input, code: first.code });
    assert.equal((await opened.readPublished(viewer, { artifactId: artifact.artifactId })).revision.id, artifact.revision.id);
    const pendingInput = { artifactId: artifact.artifactId, state: randomUUID() };
    const pending = await opened.issuePublicationGrant(actor, pendingInput);
    const closed = createArtifactStore(app.db, { publishOrigin: 'https://published.example.test', access: { ...app.config.access, allowGuests: false } });
    const before = await app.client.execute('SELECT count(*) AS sessions FROM session');
    await assert.rejects(() => closed.readPublished(viewer, { artifactId: artifact.artifactId }));
    await assert.rejects(() => closed.consumePublicationGrant({ ...pendingInput, code: pending.code }));
    assert.deepEqual((await app.client.execute('SELECT count(*) AS sessions FROM session')).rows, before.rows);
    assert.equal((await opened.readPublished(viewer, { artifactId: artifact.artifactId })).revision.id, artifact.revision.id);
    await ownerClient.identity();
  } finally { await app.close(); }
});

test('closed default keeps owner email-code and password access while suppressing guest delivery and redemption', async () => {
  const app = await fixture({ emailCode: true, transport: 'combined' });
  try {
    assert.equal((await post(app, '/email-otp/send-verification-otp', { email: 'owner@example.test', type: 'sign-in' })).status, 200);
    let text = '';
    for (let attempt = 0; attempt < 100 && !text; attempt++) {
      text = await readFile(app.emailSink!, 'utf8').catch(() => '');
      if (!text) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const messages = text.trim().split('\n').map((line) => JSON.parse(line) as { to: string; text: string });
    assert.deepEqual(messages.map((message) => message.to), ['owner@example.test']);
    const otp = messages[0]!.text.match(/\b\d{6}\b/)![0];
    const ownerCode = await post(app, '/sign-in/email-otp', { email: 'owner@example.test', otp });
    assert.equal(ownerCode.status, 200);
    assert.equal((await post(app, '/sign-in/email', { email: 'owner@example.test', password: app.password })).status, 200);
    const token = await grant({ ...app, cookie: cookieFrom(ownerCode) }, scopes);
    assert.equal((await callWhoami(app.config.resource, token.access_token)).status, 200);
    const client = createArtifactHttpClient({ resource: app.config.resource, accessToken: token.access_token });
    const artifact = await client.create({ requestId: randomUUID(), snapshot });
    await client.share({ requestId: randomUUID(), artifactId: artifact.artifactId, email: guestEmail });
    assert.equal((await post(app, '/email-otp/send-verification-otp', { email: guestEmail, type: 'sign-in' })).status, 200);
    await app.client.execute({ sql: 'INSERT INTO verification (id, identifier, value, expires_at) VALUES (?, ?, ?, ?)', args: [randomUUID(), `sign-in-otp-${guestEmail}`, `${createHash('sha256').update('123456').digest('base64url')}:0`, Date.now() + 300_000] });
    assert.equal((await post(app, '/sign-in/email-otp', { email: guestEmail, otp: '123456' })).status, 400);
    await app.authHandler.drain();
    assert.equal((await readFile(app.emailSink!, 'utf8')).trim().split('\n').length, 1);
  } finally { await app.close(); }
});

test('open mode still denies an isolated account and rechecks a removed invitation on existing tokens', async () => {
  const { app, ownerClient, artifact, share, cookie, tokens } = await invited();
  try {
    await app.auth.api.signUpEmail({ body: { name: 'Uninvited', email: 'isolated@example.test', password: app.password } });
    assert.equal((await post(app, '/sign-in/email', { email: 'isolated@example.test', password: app.password })).status, 403);
    assert.equal((await callWhoami(app.config.resource, tokens.access_token)).status, 200);
    await ownerClient.unshare({ requestId: randomUUID(), artifactId: artifact.artifactId, shareId: share.shareId });
    assert.equal((await callWhoami(app.config.resource, tokens.access_token)).status, 401);
    assert.equal(await fetch(`${app.config.issuer}/get-session`, { headers: { cookie } }).then((response) => response.json()), null);
    await ownerClient.share({ requestId: randomUUID(), artifactId: artifact.artifactId, email: guestEmail });
    assert.equal((await callWhoami(app.config.resource, tokens.access_token)).status, 200);
  } finally { await app.close(); }
});
