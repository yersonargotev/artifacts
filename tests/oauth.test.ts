import assert from 'node:assert/strict';
import { test } from 'node:test';
import { and, eq, isNotNull } from 'drizzle-orm';
import { oauthRefreshToken, session } from '../packages/db/src/schema.ts';
import { decodeJwt } from 'jose';
import { callWhoami, fixture, grant } from './helpers.ts';
import { revokeUserIdentity } from '../apps/auth/src/revocation.ts';

test('PKCE token and authenticated introspection identify the owner on every MCP request', async () => {
  const app = await fixture();
  try {
    assert.equal((await callWhoami(app.config.resource)).status, 401);
    const token = await grant(app);
    const claims = decodeJwt(token.access_token);
    assert.equal(claims.sub, app.ownerId);
    assert.equal(typeof claims.sid, 'string');
    const response = await callWhoami(app.config.resource, token.access_token);
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, new RegExp(app.ownerId));
    await revokeUserIdentity(app.db, app.ownerId);
    assert.equal((await callWhoami(app.config.resource, token.access_token)).status, 401);
  } finally { await app.close(); }
});

test('MCP challenges missing credentials, rejects invalid claims and scope, and fails closed on introspection outage', async () => {
  const app = await fixture();
  try {
    const anonymous = await callWhoami(app.config.resource);
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get('www-authenticate')!, /resource_metadata=/);
    const token = await grant(app);
    const claims = decodeJwt(token.access_token);
    for (const change of [{ sid: undefined }, { aud: 'https://wrong.example/mcp' }, { iss: 'https://wrong.example' }, { exp: Math.floor(Date.now() / 1000) - 60 }, { sid: 'deleted-session' }]) {
      const invalid = await app.auth.api.signJWT({ body: { payload: { ...claims, ...change } } });
      assert.equal((await callWhoami(app.config.resource, invalid.token)).status, 401);
    }
    const parts = token.access_token.split('.');
    parts[2] = (parts[2]!.startsWith('A') ? 'B' : 'A') + parts[2]!.slice(1);
    assert.equal((await callWhoami(app.config.resource, parts.join('.'))).status, 401);
    const anonymousIntrospection = await fetch(`${app.config.issuer}/oauth2/introspect`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: token.access_token }) });
    assert.equal(anonymousIntrospection.status, 401);
    const limited = await grant(app, 'openid profile offline_access');
    const forbidden = await callWhoami(app.config.resource, limited.access_token);
    assert.equal(forbidden.status, 403);
    assert.match(forbidden.headers.get('www-authenticate')!, /insufficient_scope/);
    assert.equal((await callWhoami(app.config.resource, token.access_token)).status, 200);
    app.setAuthHandler(async () => new Response('unavailable', { status: 503 }));
    assert.equal((await callWhoami(app.config.resource, token.access_token)).status, 503);
    app.setAuthHandler(async () => new Promise<Response>(() => {}));
    assert.equal((await callWhoami(app.config.resource, token.access_token)).status, 503);
  } finally { await app.close(); }
});

test('MCP rejects inactive and inconsistent introspection results without trusting a prior request', async () => {
  const app = await fixture();
  try {
    const token = await grant(app);
    const claims = decodeJwt(token.access_token);
    assert.equal((await callWhoami(app.config.resource, token.access_token)).status, 200);
    app.setAuthHandler(async () => Response.json({ active: false }));
    assert.equal((await callWhoami(app.config.resource, token.access_token)).status, 401);
    app.setAuthHandler(async () => Response.json({ ...claims, active: true, sub: 'other-user' }));
    assert.equal((await callWhoami(app.config.resource, token.access_token)).status, 401);
    app.setAuthHandler(async () => Response.json({ active: true }));
    assert.equal((await callWhoami(app.config.resource, token.access_token)).status, 503);
  } finally { await app.close(); }
});

function refresh(app: Awaited<ReturnType<typeof fixture>>, clientId: string, refreshToken: string) {
  return fetch(`${app.config.issuer}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken, resource: app.config.resource }) });
}

test('refresh rotation replays the same response during grace and rejects reuse after its persisted deadline', async () => {
  const app = await fixture();
  try {
    const original = await grant(app);
    const renewed = await refresh(app, original.clientId, original.refresh_token);
    assert.equal(renewed.status, 200);
    const tokens = await renewed.json() as { access_token: string; refresh_token: string };
    assert.notEqual(tokens.refresh_token, original.refresh_token);
    const replay = await refresh(app, original.clientId, original.refresh_token);
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), tokens);
    await app.db.update(oauthRefreshToken).set({ rotationReplayExpiresAt: new Date(Date.now() - 1000) }).where(and(eq(oauthRefreshToken.clientId, original.clientId), isNotNull(oauthRefreshToken.rotatedAt)));
    assert.equal((await refresh(app, original.clientId, original.refresh_token)).status, 400);
    assert.equal((await refresh(app, original.clientId, tokens.refresh_token)).status, 400);
  } finally { await app.close(); }
});

test('a surviving refresh after central deletion mints no usable MCP identity', async () => {
  const app = await fixture();
  try {
    const original = await grant(app);
    const claims = decodeJwt(original.access_token);
    const central = await app.db.select().from(session).where(eq(session.id, String(claims.sid))).get();
    assert.equal(central?.userId, claims.sub);
    await app.db.delete(session).where(eq(session.userId, app.ownerId));
    assert.equal((await callWhoami(app.config.resource, original.access_token)).status, 401);
    const response = await refresh(app, original.clientId, original.refresh_token);
    assert.equal(response.status, 200);
    const tokens = await response.json() as { access_token: string };
    assert.equal(decodeJwt(tokens.access_token).sid, null);
    assert.equal((await callWhoami(app.config.resource, tokens.access_token)).status, 401);
  } finally { await app.close(); }
});

test('concurrent refresh and family invalidation cannot bypass a deleted central session', async () => {
  const app = await fixture();
  try {
    const original = await grant(app);
    const first = await refresh(app, original.clientId, original.refresh_token);
    assert.equal(first.status, 200);
    const rotated = await first.json() as { access_token: string; refresh_token: string };
    await app.db.update(oauthRefreshToken).set({ rotationReplayExpiresAt: new Date(Date.now() - 1000) }).where(and(eq(oauthRefreshToken.clientId, original.clientId), isNotNull(oauthRefreshToken.rotatedAt)));
    const [reused, concurrent] = await Promise.all([refresh(app, original.clientId, original.refresh_token), refresh(app, original.clientId, rotated.refresh_token)]);
    assert.equal(reused.status, 400);
    assert([200, 400].includes(concurrent.status));
    await app.db.delete(session).where(eq(session.userId, app.ownerId));
    for (const token of [original.access_token, rotated.access_token]) assert.equal((await callWhoami(app.config.resource, token)).status, 401);
    if (concurrent.status === 200) {
      const token = await concurrent.json() as { access_token: string };
      assert.equal((await callWhoami(app.config.resource, token.access_token)).status, 401);
    }
  } finally { await app.close(); }
});

test('authorization codes are single-use, signup is closed, and global revocation rejects cross-origin mutations', async () => {
  const app = await fixture();
  try {
    const original = await grant(app);
    const replay = await fetch(`${app.config.issuer}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(original.tokenBody) });
    assert.equal(replay.status, 400);
    const signup = await fetch(`${app.config.issuer}/sign-up/email`, { method: 'POST', headers: { origin: app.config.origin, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'other@example.test', password: 'a-strong-test-password', name: 'Other' }) });
    assert.equal(signup.status, 400);
    const denied = await fetch(`${app.config.origin}/revoke-all`, { method: 'POST', headers: { cookie: app.cookie, origin: 'https://attacker.example' }, redirect: 'manual' });
    assert.equal(denied.status, 403);
    const revoked = await fetch(`${app.config.origin}/revoke-all`, { method: 'POST', headers: { cookie: app.cookie, origin: app.config.origin }, redirect: 'manual' });
    assert.equal(revoked.status, 303);
    assert.match(revoked.headers.get('set-cookie')!, /Max-Age=0/);
    assert.equal((await callWhoami(app.config.resource, original.access_token)).status, 401);
  } finally { await app.close(); }
});
