import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createAuthApp } from '../apps/auth/src/http.ts';
import { openDatabase } from '../packages/db/src/index.ts';
import { fixture, grant, callWhoami } from './helpers.ts';

const passwordBody = { email: 'missing@example.test', password: 'incorrect-password-123456' };

test('password limits are shared atomically across HTTP runtimes and ignore spoofed headers', async () => {
  const app = await fixture();
  const second = await openDatabase({ url: app.databaseUrl });
  const other = createAuthApp(second.db, app.config);
  let turn = 0;
  app.setAuthHandler((request, bindings) => (++turn % 2 ? app.authHandler : other)(request, bindings));
  try {
    const attempt = (index: number) => fetch(`${app.config.issuer}/sign-in/email`, {
      method: 'POST',
      headers: { origin: app.config.origin, 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${index}`, 'x-artifacts-client-ip': `198.51.100.${index}`, 'cf-connecting-ip': `203.0.113.${index}` },
      body: JSON.stringify(passwordBody),
    });
    const statuses = await Promise.all(Array.from({ length: 8 }, (_, index) => attempt(index).then((response) => response.status)));
    assert.deepEqual(statuses.sort(), [401, 401, 401, 429, 429, 429, 429, 429]);
    const denied = await attempt(99);
    assert.equal(denied.status, 429);
    assert(Number(denied.headers.get('x-retry-after')) > 0);
    await app.client.execute("UPDATE verification SET updated_at = updated_at - 11000 WHERE id LIKE 'artifacts:auth-rate:%'");
    assert.equal((await attempt(100)).status, 401, 'expired allowance admits a real password attempt');
  } finally { await other.drain(); second.client.close(); await app.close(); }
});

test('trusted addresses have distinct limits and IPv6 addresses share a /64', async () => {
  const app = await fixture();
  let address: string | undefined = '2001:db8:1:2::1';
  app.setAuthHandler((request) => app.authHandler(request, { incoming: { socket: { remoteAddress: address } } }));
  try {
    const attempt = () => fetch(`${app.config.issuer}/sign-in/email`, { method: 'POST', headers: { origin: app.config.origin, 'content-type': 'application/json', 'x-artifacts-client-ip': '192.0.2.1' }, body: JSON.stringify(passwordBody) });
    assert.deepEqual(await Promise.all([attempt(), attempt(), attempt()]).then((responses) => responses.map((response) => response.status)), [401, 401, 401]);
    address = '2001:db8:1:2::ffff';
    assert.equal((await attempt()).status, 429);
    address = '2001:db8:1:3::1';
    assert.equal((await attempt()).status, 401);
    address = undefined;
    assert.deepEqual(await Promise.all([attempt(), attempt(), attempt(), attempt()]).then((responses) => responses.map((response) => response.status)).then((values) => values.sort()), [401, 401, 401, 429]);
  } finally { await app.close(); }
});

test('OAuth token throttling persists across runtimes while live MCP introspection stays available', async () => {
  const app = await fixture();
  const second = await openDatabase({ url: app.databaseUrl });
  const other = createAuthApp(second.db, app.config);
  try {
    const token = await grant(app);
    for (let index = 0; index < 105; index++) assert.equal((await callWhoami(app.config.resource, token.access_token)).status, 200);
    let turn = 0;
    app.setAuthHandler((request, bindings) => (++turn % 2 ? app.authHandler : other)(request, bindings));
    const statuses = [];
    for (let index = 0; index < 20; index++) {
      const response = await fetch(`${app.config.issuer}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: token.clientId, refresh_token: 'invalid-refresh-token' }) });
      statuses.push(response.status);
    }
    assert.deepEqual(statuses, [...Array(19).fill(400), 429]);
    assert.equal((await callWhoami(app.config.resource, token.access_token)).status, 200);
  } finally { await other.drain(); second.client.close(); await app.close(); }
});

test('Worker runtimes share password quotas and use only the current Cloudflare address', async () => {
  const app = await fixture();
  try {
    const source = `
      import assert from 'node:assert/strict';
      import worker from './apps/auth/src/worker.ts';
      const env = JSON.parse(process.env.OWNER_RATE_FIXTURE);
      const other = { ...env };
      const attempt = (bindings, address, spoof) => worker.fetch(new Request(env.AUTH_URL + '/api/auth/sign-in/email', {
        method: 'POST', headers: { origin: env.AUTH_URL, 'content-type': 'application/json', 'cf-connecting-ip': address, 'x-forwarded-for': spoof, 'x-artifacts-client-ip': spoof },
        body: JSON.stringify({ email: 'missing@example.test', password: 'incorrect-password-123456' }),
      }), bindings);
      const statuses = [];
      for (let index = 0; index < 4; index++) statuses.push((await attempt(index % 2 ? other : env, '192.0.2.10', '198.51.100.' + index)).status);
      assert.deepEqual(statuses, [401, 401, 401, 429]);
      assert.equal((await attempt(other, '192.0.2.11', '192.0.2.10')).status, 401);
      console.log('Worker trusted-address quotas passed across independent runtimes');
    `;
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], { cwd: new URL('..', import.meta.url), timeout: 15_000, env: { PATH: process.env.PATH, OWNER_RATE_FIXTURE: JSON.stringify({ DATABASE_URL: app.databaseUrl, AUTH_URL: app.config.origin, MCP_URL: app.config.resource, DASHBOARD_URL: app.config.dashboard, BETTER_AUTH_SECRET: app.config.secret, OWNER_EMAIL: 'owner@example.test' }) } });
    assert.match(result.stdout, /Worker trusted-address quotas passed across independent runtimes/);
  } finally { await app.close(); }
});
