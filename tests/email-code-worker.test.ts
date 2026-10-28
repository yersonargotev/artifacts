import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { fixture } from './helpers.ts';

test('cached Worker runtime binds overlapping sends to current waitUntil and requires enabled request scope', async () => {
  const app = await fixture();
  try {
    const source = `
      import assert from 'node:assert/strict';
      import worker from './apps/auth/src/worker.ts';
      const env = JSON.parse(process.env.EMAIL_WORKER_FIXTURE);
      const release = Promise.withResolvers();
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        await release.promise;
        return Response.json({ id: 'accepted-message' });
      };
      const request = (ip) => new Request(env.AUTH_URL + '/api/auth/email-otp/send-verification-otp', { method: 'POST', headers: { origin: env.AUTH_URL, 'content-type': 'application/json', 'cf-connecting-ip': ip, 'x-forwarded-for': '192.0.2.99', 'x-artifacts-client-ip': '192.0.2.88' }, body: JSON.stringify({ email: 'owner@example.test', type: 'sign-in' }) });
      const first = [];
      const second = [];
      try {
        const responses = await Promise.all([
          worker.fetch(request('192.0.2.1'), env, { waitUntil: (task) => first.push(task) }),
          worker.fetch(request('192.0.2.2'), env, { waitUntil: (task) => second.push(task) }),
        ]);
        assert.deepEqual(responses.map((response) => response.status), [200, 200]);
        assert.equal(first.length, 1);
        assert.equal(second.length, 1);
        assert.notEqual(first[0], second[0]);
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(calls, 2);
        const missing = await worker.fetch(request('192.0.2.3'), env);
        assert.equal(missing.status, 503);
        assert.equal(calls, 2);
      } finally { release.resolve(); await Promise.all([...first, ...second]); }
      console.log('Worker request contexts passed under local Node execution');
    `;
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], {
      cwd: new URL('..', import.meta.url), timeout: 15_000,
      env: { PATH: process.env.PATH, EMAIL_WORKER_FIXTURE: JSON.stringify({ OWNER_EMAIL: app.config.access.ownerEmail, ALLOW_GUEST_ACCESS: String(app.config.access.allowGuests), DATABASE_URL: app.databaseUrl, AUTH_URL: app.config.origin, MCP_URL: app.config.resource, DASHBOARD_URL: app.config.dashboard, BETTER_AUTH_SECRET: app.config.secret, EMAIL_TRANSPORT: 'resend', EMAIL_FROM: 'codes@example.test', RESEND_API_KEY: 'fixture-token' }) },
    });
    assert.match(result.stdout, /Worker request contexts passed/);
    const counters = await app.client.execute("SELECT identifier FROM verification WHERE id LIKE 'artifacts:email-code:send-ip:%' ORDER BY identifier");
    assert.deepEqual(counters.rows.map((row) => row.identifier), ['artifacts:email-code:send-ip:192.0.2.1', 'artifacts:email-code:send-ip:192.0.2.2']);
  } finally { await app.close(); }
});
