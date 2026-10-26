import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuth } from '../apps/auth/src/auth.ts';
import { createAuthApp } from '../apps/auth/src/http.ts';
import { fixture } from './helpers.ts';

const providerConfig = { transport: 'cloudflare' as const, ownerEmail: 'owner@example.test', from: 'codes@example.test', accountId: 'a'.repeat(32), apiToken: 'disposable-token' };
const accepted = { success: true, errors: [], result: { delivered: ['owner@example.test'], queued: [], permanent_bounces: [] } };

function request(origin: string, email = 'owner@example.test') {
  return new Request(`${origin}/api/auth/email-otp/send-verification-otp`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.40', 'x-artifacts-client-ip': '198.51.100.1' }, body: JSON.stringify({ email, type: 'sign-in' }) });
}

test('Node HTTP returns before provider delivery and drains accepted sends before teardown', async () => {
  const app = await fixture();
  const release = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const originalFetch = globalThis.fetch;
  let done = false;
  let handler: ReturnType<typeof createAuthApp> | undefined;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/email/sending/send`);
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer disposable-token');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.to, 'owner@example.test');
      assert.equal(body.from, 'codes@example.test');
      assert.match(body.text, /\b\d{6}\b/);
      assert(init?.signal);
      started.resolve();
      await release.promise;
      done = true;
      return Response.json(accepted);
    };
    handler = createAuthApp(app.db, { ...app.config, email: providerConfig });
    const response = await handler(request(app.config.origin), { incoming: { socket: { remoteAddress: '::ffff:192.0.2.15' } } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    await started.promise;
    assert.equal(done, false);
    let drained = false;
    const draining = handler.drain().then(() => { drained = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(drained, false);
    const rows = await app.client.execute("SELECT identifier FROM verification WHERE id LIKE 'artifacts:email-code:send-ip:%'");
    assert.deepEqual(rows.rows.map((row) => row.identifier), ['artifacts:email-code:send-ip:192.0.2.15']);
    release.resolve();
    await draining;
    assert.equal(done, true);
    assert.equal((await handler(request(app.config.origin))).status, 503);
  } finally { release.resolve(); if (handler && 'drain' in handler) await handler.drain(); globalThis.fetch = originalFetch; await app.close(); }
});

test('direct API awaits sender and provider failures preserve the public code response without sensitive logs', async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logs: unknown[][] = [];
  try {
    console.error = (...values) => { logs.push(values); };
    for (const outcome of [accepted, { ...accepted, result: { delivered: [], queued: ['owner@example.test'], permanent_bounces: [] } }, { success: false, errors: [{ code: 1, message: 'sensitive' }], result: null }, { ...accepted, result: { delivered: [], queued: [], permanent_bounces: ['owner@example.test'] } }, { ...accepted, result: { delivered: ['owner@example.test'], queued: [], permanent_bounces: [], suppressed_recipients: ['owner@example.test'] } }, { ...accepted, result: { delivered: 'owner@example.test', queued: [], permanent_bounces: [] } }, { ...accepted, result: { delivered: [], queued: [], permanent_bounces: [] } }, 'http-error', 'invalid-json', 'rejection']) {
      const app = await fixture();
      try {
        let complete = false;
        globalThis.fetch = async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          complete = true;
          if (outcome === 'rejection') throw new Error('sensitive recipient code');
          if (outcome === 'http-error') return new Response('sensitive provider message', { status: 503 });
          if (outcome === 'invalid-json') return new Response('not-json');
          return Response.json(outcome);
        };
        const auth = createAuth(app.db, { ...app.config, email: providerConfig });
        assert.equal((await auth.handler(request(app.config.origin, 'unknown@example.test'))).status, 200);
        const response = await auth.api.sendVerificationOTP({ body: { email: 'owner@example.test', type: 'sign-in' } });
        assert.deepEqual(response, { success: true });
        assert.equal(complete, true);
      } finally { await app.close(); }
    }
    assert.equal(logs.length, 8);
    assert(logs.every((values) => JSON.stringify(values) === '["Email code delivery failed"]'));
  } finally { globalThis.fetch = originalFetch; console.error = originalError; }
});

test('request-local schedulers isolate overlapping sends and reject a missing scheduler before I/O', async () => {
  const { createAuth: createAuthCore } = await import('../apps/auth/src/auth-core.ts');
  const { withEmailCodeRequest } = await import('../apps/auth/src/email-code-context.ts');
  const app = await fixture();
  const release = Promise.withResolvers<void>();
  try {
    const sent: string[] = [];
    const auth = createAuthCore(app.db, { ...app.config, email: providerConfig }, { fetchClientMetadataResource: async () => { throw new Error('Unused metadata request'); } }, false, async (message) => { sent.push(message.to); await release.promise; });
    const first: Promise<void>[] = [];
    const second: Promise<void>[] = [];
    const responses = await Promise.all([
      withEmailCodeRequest(request(app.config.origin), '2001:db8:1:1::1', (task) => { first.push(task); }, auth.handler),
      withEmailCodeRequest(request(app.config.origin), '2001:db8:2:1::1', (task) => { second.push(task); }, auth.handler),
    ]);
    assert.deepEqual(responses.map((response) => response.status), [200, 200]);
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.notEqual(first[0], second[0]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(sent.length, 2);
    const rows = await app.client.execute("SELECT identifier FROM verification WHERE id LIKE 'artifacts:email-code:send-ip:%' ORDER BY identifier");
    assert.deepEqual(rows.rows.map((row) => row.identifier), ['artifacts:email-code:send-ip:2001:0db8:0001:0001:0000:0000:0000:0000', 'artifacts:email-code:send-ip:2001:0db8:0002:0001:0000:0000:0000:0000']);
    release.resolve();
    await Promise.all([...first, ...second]);
    const response = await withEmailCodeRequest(request(app.config.origin), undefined, () => { throw new Error('No execution context'); }, auth.handler);
    assert.equal(response.status, 200);
    assert.equal(sent.length, 2);
  } finally { release.resolve(); await app.close(); }
});
