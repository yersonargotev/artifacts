import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { fixture, grant, callWhoami } from '/tmp/artifacts-identity-implementation/tests/helpers.ts';
import { createMcpApp } from '/tmp/artifacts-identity-implementation/apps/mcp/src/http.ts';

const app = await fixture({ dashboard: 'https://dashboard.example.test' });
try {
  await assert.rejects(app.auth.api.adminCreateOAuthClient({ headers: new Headers({ cookie: app.cookie }), body: {
    client_name: 'Mixed-scheme resource', redirect_uris: [`${new URL(app.config.resource).origin}/oauth/unused`],
    token_endpoint_auth_method: 'client_secret_basic', application_type: app.config.dashboard.startsWith('http:') ? 'native' : 'web',
    grant_types: ['authorization_code'], response_types: ['code'], scope: 'openid profile',
  } }), (error) => error.statusCode === 400 && /web clients require https redirect URIs/.test(error.body?.error_description));
  console.log('CONFIRMED bootstrap resource application_type uses the unrelated dashboard scheme');
  const base = { client_name: 'Privilege probe', redirect_uris: ['http://127.0.0.1:49999/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] };
  for (const extra of [{ skip_consent: true }, { grant_types: ['client_credentials'] }]) {
    const response = await fetch(`${app.config.issuer}/oauth2/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...base, ...extra }) });
    assert.equal(response.status, 400);
  }
  assert.equal((await fetch(`${app.config.issuer}/admin/oauth2/create-client`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(base) })).status, 404);
  assert.equal((await fetch(`${app.config.issuer}/token`, { headers: { cookie: app.cookie } })).status, 404);
  console.log('PASS anonymous DCR cannot skip consent or use client credentials; admin HTTP route is unavailable; generic JWT endpoint is disabled');
  const issued = await grant(app);
  const verifier = randomBytes(32).toString('base64url');
  const parameters = new URLSearchParams({ client_id: issued.clientId, redirect_uri: issued.tokenBody.redirect_uri, response_type: 'code', scope: 'openid profile offline_access artifacts:read', state: randomBytes(16).toString('hex'), code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: app.config.resource });
  const authorization = await fetch(`${app.config.issuer}/oauth2/authorize?${parameters}`, { headers: { cookie: app.cookie }, redirect: 'manual' });
  assert.equal(authorization.status, 200);
  const redirect = await authorization.json();
  const code = new URL(redirect.url).searchParams.get('code');
  assert(code);
  const wrongVerifier = await fetch(`${app.config.issuer}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...issued.tokenBody, code, code_verifier: randomBytes(32).toString('base64url') }) });
  assert.equal(wrongVerifier.status, 401);
  for (const redirectUri of ['http://127.0.0.1:49999/other', 'http://localhost:49999/callback']) {
    parameters.set('redirect_uri', redirectUri);
    const response = await fetch(`${app.config.issuer}/oauth2/authorize?${parameters}`, { headers: { cookie: app.cookie }, redirect: 'manual' });
    const result = await response.json();
    const returned = new URL(result.url);
    assert(!returned.searchParams.has('code'));
    assert(returned.searchParams.has('error'));
  }
  console.log('PASS wrong PKCE verifier and changed native-loopback hostname/path are rejected');
  const invalidIntrospection = createMcpApp({ ...app.mcpOptions, clientSecret: randomBytes(32).toString('base64url') });
  assert.equal((await invalidIntrospection(new Request(app.config.resource, { method: 'POST', headers: { authorization: `Bearer ${issued.access_token}` } }))).status, 503);
  const before = await app.client.execute('SELECT expires_at, created_at FROM session');
  await fetch(`${app.config.issuer}/get-session`, { headers: { cookie: app.cookie } });
  const after = await app.client.execute('SELECT expires_at, created_at FROM session');
  assert.deepEqual(after.rows, before.rows);
  assert(Number(before.rows[0].expires_at) - Number(before.rows[0].created_at) <= 30 * 86400 * 1000 + 1000);
  await app.client.execute({ sql: 'UPDATE session SET expires_at = ?', args: [Date.now() - 1000] });
  assert.equal((await callWhoami(app.config.resource, issued.access_token)).status, 401);
  console.log('PASS bad introspection credentials fail closed; session reads do not extend expiry; expired central session denies MCP');
} finally {
  await app.close();
}
