import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { createPanelIdentity } from '../apps/dashboard/src/identity.ts';
import { session } from '../packages/db/src/schema.ts';
import { fixture } from './helpers.ts';

async function panel(app: Awaited<ReturnType<typeof fixture>>) {
  const client = await app.auth.api.adminCreateOAuthClient({ headers: new Headers({ cookie: app.cookie }), body: { client_name: 'Test dashboard', application_type: 'native', redirect_uris: ['http://localhost:4321/auth/callback'], token_endpoint_auth_method: 'client_secret_basic', grant_types: ['authorization_code'], response_types: ['code'], scope: 'openid profile', enable_end_session: true, skip_consent: true, require_pkce: true } });
  assert(client.client_secret);
  const config = { origin: 'http://localhost:4321', auth: app.config.origin, issuer: app.config.issuer, clientId: client.client_id, clientSecret: client.client_secret };
  const identity = createPanelIdentity(app.db, config);
  async function login() {
    const transaction = await identity.startLogin();
    const response = await fetch(transaction.url, { headers: { cookie: app.cookie }, redirect: 'manual' });
    assert.equal(response.status, 200);
    const redirect = await response.json() as { url: string };
    return { transaction, callback: new URL(redirect.url) };
  }
  return { config, identity, login };
}

test('OIDC validates signed identity and durable one-use state, then panel logout preserves central access', async () => {
  const app = await fixture();
  try {
    const browser = await panel(app);
    const login = await browser.login();
    const local = await browser.identity.completeLogin(login.callback, login.transaction.token);
    const identity = await browser.identity.load(local.token);
    assert.equal(identity?.userId, app.ownerId);
    assert(identity?.sessionId);
    const restarted = createPanelIdentity(app.db, browser.config);
    assert.equal((await restarted.load(local.token))?.userId, app.ownerId);
    await assert.rejects(browser.identity.completeLogin(login.callback, login.transaction.token), /used login transaction/);
    await browser.identity.logout(local.token);
    assert.equal(await browser.identity.load(local.token), undefined);
    assert(await app.db.select().from(session).where(eq(session.id, identity.sessionId)).get());
  } finally { await app.close(); }
});

test('OIDC state tampering and expired or deleted central sessions cannot establish or retain panel access', async () => {
  const app = await fixture();
  try {
    const browser = await panel(app);
    const tampered = await browser.login();
    tampered.callback.searchParams.set('state', 'attacker');
    await assert.rejects(browser.identity.completeLogin(tampered.callback, tampered.transaction.token));
    const login = await browser.login();
    const local = await browser.identity.completeLogin(login.callback, login.transaction.token);
    const identity = await browser.identity.load(local.token);
    assert(identity);
    await app.db.update(session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(session.id, identity.sessionId));
    assert.equal(await browser.identity.load(local.token), undefined);
    await app.db.delete(session).where(eq(session.id, identity.sessionId));
    assert.equal(await browser.identity.load(local.token), undefined);
  } finally { await app.close(); }
});

test('a callback released after central revocation cannot create a panel session', async () => {
  const app = await fixture();
  try {
    const browser = await panel(app);
    const login = await browser.login();
    const { createAuthApp } = await import('../apps/auth/src/http.ts');
    const original = createAuthApp(app.db, app.config);
    const issued = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    app.setAuthHandler(async (request) => {
      const response = await original(request);
      if (new URL(request.url).pathname.endsWith('/oauth2/token')) { issued.resolve(); await release.promise; }
      return response;
    });
    const pending = browser.identity.completeLogin(login.callback, login.transaction.token);
    const rejected = assert.rejects(pending, /Central session is no longer active/);
    await issued.promise;
    await app.db.delete(session).where(eq(session.userId, app.ownerId));
    release.resolve();
    await rejected;
  } finally { await app.close(); }
});

test('a valid issuer signature cannot link a different subject to the owner central session', async () => {
  const app = await fixture();
  try {
    const browser = await panel(app);
    const login = await browser.login();
    const { createAuthApp } = await import('../apps/auth/src/http.ts');
    const original = createAuthApp(app.db, app.config);
    app.setAuthHandler(async (request) => {
      const response = await original(request);
      if (!new URL(request.url).pathname.endsWith('/oauth2/token')) return response;
      const tokens = await response.json() as { id_token: string };
      const signed = await app.auth.api.signJWT({ body: { payload: { ...decodeJwt(tokens.id_token), sub: 'different-user' } } });
      return Response.json({ ...tokens, id_token: signed.token });
    });
    await assert.rejects(browser.identity.completeLogin(login.callback, login.transaction.token), /Central session is no longer active/);
  } finally { await app.close(); }
});
