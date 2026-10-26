import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resendEmailSender } from '../packages/config/src/email.ts';
import { createEmailSender as nodeSender } from '../packages/config/src/email-sender-node.ts';
import { createEmailSender as workerSender } from '../packages/config/src/email-sender-worker.ts';

const config = { transport: 'resend' as const, from: 'codes@example.test', apiKey: 'disposable-key' };
const message = { to: 'guest@example.test', subject: 'Sign-in code', text: 'Your code is 123456.' };

for (const content of [message, { ...message, subject: 'Artifact invitation', html: '<p>Open your artifact.</p>' }]) {
  test(`Resend accepts ${'html' in content ? 'HTML and text' : 'text-only'} messages with one authenticated POST`, async () => {
    let calls = 0;
    const sender = resendEmailSender(config, async (url, init) => {
      calls++;
      assert.equal(String(url), 'https://api.resend.com/emails');
      assert.equal(init?.method, 'POST');
      assert.deepEqual(Object.fromEntries(new Headers(init?.headers)), { authorization: 'Bearer disposable-key', 'content-type': 'application/json' });
      assert.deepEqual(JSON.parse(String(init?.body)), { ...content, from: 'codes@example.test' });
      assert(init?.signal instanceof AbortSignal);
      assert.equal(init.signal.aborted, false);
      return Response.json({ id: ' accepted-message ' });
    });
    assert.equal(await sender(content), undefined);
    assert.equal(calls, 1);
  });
}

for (const status of [400, 401, 403, 422, 429, 500, 503]) {
  test(`Resend HTTP ${status} failures stay sanitized and are not retried`, async () => {
    let calls = 0;
    const sender = resendEmailSender(config, async () => {
      calls++;
      return Response.json({ message: 'sensitive recipient and provider details', apiKey: config.apiKey }, { status });
    });
    await assert.rejects(sender(message), { name: 'Error', message: 'Email provider request failed' });
    assert.equal(calls, 1);
  });
}

for (const body of [null, [], {}, { id: null }, { id: 123 }, { id: false }, { id: '' }, { id: ' \t\n' }]) {
  test(`Resend rejects invalid acceptance ${JSON.stringify(body)} without retry`, async () => {
    let calls = 0;
    const sender = resendEmailSender(config, async () => { calls++; return Response.json(body); });
    await assert.rejects(sender(message), { message: 'Email provider request failed' });
    assert.equal(calls, 1);
  });
}

test('Resend sanitizes malformed JSON and Fetch rejection without retry', async () => {
  for (const fetcher of [async () => new Response('sensitive malformed JSON'), async () => { throw new Error(`sensitive ${config.apiKey} ${message.to}`); }]) {
    let calls = 0;
    const sender = resendEmailSender(config, async () => { calls++; return fetcher(); });
    await assert.rejects(sender(message), (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.message, 'Email provider request failed');
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('each Resend attempt has its own ten-second signal and actively aborts the request', async (t) => {
  const controllers: AbortController[] = [];
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    assert.equal(milliseconds, 10_000);
    const controller = new AbortController();
    controllers.push(controller);
    return controller.signal;
  });
  const signals: AbortSignal[] = [];
  const sender = resendEmailSender(config, async (_url, init) => {
    assert(init?.signal);
    const signal = init.signal;
    signals.push(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  const first = assert.rejects(sender(message), { message: 'Email provider request failed' });
  const second = assert.rejects(sender(message), { message: 'Email provider request failed' });
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
  assert(signals.every((signal) => !signal.aborted));
  controllers[0]!.abort(new Error('sensitive timeout details'));
  await first;
  assert.equal(signals[0]!.aborted, true);
  assert.equal(signals[1]!.aborted, false);
  controllers[1]!.abort(new Error('sensitive second timeout'));
  await second;
  assert.equal(signals.length, 2);
});

test('Node and Worker sender factories select Resend without auth owner admission settings', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    assert.equal(String(url), 'https://api.resend.com/emails');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer disposable-key');
    return Response.json({ id: 'accepted-invitation' });
  });
  for (const factory of [nodeSender, workerSender]) {
    assert.equal(factory({}, 'https://auth.example.test'), undefined);
    const sender = factory({ EMAIL_TRANSPORT: 'resend', EMAIL_FROM: config.from, RESEND_API_KEY: config.apiKey }, 'https://auth.example.test');
    assert(sender);
    assert.equal(await sender({ ...message, html: '<p>Artifact invitation</p>' }), undefined);
  }
  assert.equal(calls, 2);
});
