import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import { fixture } from './helpers.ts';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { reportError, scrubEvent, withMonitoring } from '../packages/monitoring/src/index.ts';

const secrets = {
  cookie: 'session-cookie-value',
  token: 'bearer-token-value',
  body: 'private-artifact-body',
  query: 'query-grant-value',
  email: 'owner@example.test',
};

test('beforeSend removes cookies, tokens, bodies, query strings, and email addresses from an event', () => {
  const event: Parameters<typeof scrubEvent>[0] = {
    type: undefined,
    message: `Lookup failed for ${secrets.email}`,
    exception: { values: [
      { type: 'Error', value: `fetch https://artifacts.example/v1/lookup?grant=${secrets.query} failed for ${secrets.email}` },
      { type: 'TypeError', value: `Invalid URL "https://artifacts.example/x?token=${secrets.query}"` },
      { type: 'Error', value: `GET /v1/artifacts?share=${secrets.query} rejected Bearer ${secrets.token}` },
      { type: 'DrizzleQueryError', value: `Failed query: select * from session where token = ? and body = ?\nparams: ${secrets.token},${secrets.body}` },
    ] },
    request: {
      method: 'POST',
      url: `https://artifacts.example/v1/artifacts?share=${secrets.query}#${secrets.query}`,
      query_string: `share=${secrets.query}`,
      cookies: { session: secrets.cookie },
      data: { snapshot: secrets.body },
      env: { REMOTE_ADDR: '203.0.113.7' },
      headers: {
        'User-Agent': 'artifacts-cli/1.0',
        'cf-ray': '8f1d2c3b4a5e6f70-IAD',
        authorization: `Bearer ${secrets.token}`,
        cookie: `session=${secrets.cookie}`,
        'x-forwarded-email': secrets.email,
        'cf-connecting-ip': '203.0.113.7',
      },
    },
    user: { id: 'user-123', email: secrets.email, username: secrets.email, ip_address: '203.0.113.7' },
    breadcrumbs: [
      { category: 'fetch', data: { method: 'POST', url: `https://auth.example/oauth2/introspect?token=${secrets.token}`, status_code: 500, request_body_size: 42 } },
      { category: 'fetch', data: { url: 'https://auth.example/oauth2/token', request_body: secrets.body } },
      { category: 'fetch', data: { url: 'https://auth.example/jwks', response_body: secrets.body } },
      { category: 'console', message: `signed in ${secrets.email}` },
    ],
    extra: { contact: secrets.email },
  };
  const scrubbed = scrubEvent(event);
  const serialized = JSON.stringify(scrubbed);
  for (const [name, value] of Object.entries(secrets)) assert(!serialized.includes(value), `${name} survived beforeSend`);
  assert(!serialized.includes('203.0.113.7'), 'the client IP address survived beforeSend');
  assert.deepEqual(scrubbed.request, { method: 'POST', url: 'https://artifacts.example/v1/artifacts', headers: { 'User-Agent': 'artifacts-cli/1.0', 'cf-ray': '8f1d2c3b4a5e6f70-IAD' } });
  assert.deepEqual(scrubbed.user, { id: 'user-123' });
  assert.deepEqual(scrubbed.breadcrumbs?.map((breadcrumb) => breadcrumb.data?.url), ['https://auth.example/oauth2/introspect'], 'console and body breadcrumbs are dropped');
  assert.equal(scrubbed.breadcrumbs?.[0]?.data?.status_code, 500);
  assert.deepEqual(scrubbed.extra, { contact: '[email]' });
  assert.deepEqual(scrubbed.exception?.values?.map(({ value }) => value), [
    'fetch https://artifacts.example/v1/lookup failed for [email]',
    'Invalid URL "https://artifacts.example/x"',
    'GET /v1/artifacts rejected Bearer [token]',
    'Failed query: select * from session where token = ? and body = ?\nparams: [redacted]',
  ]);
});

test('each Worker sends a scrubbed error event to the configured DSN and nothing without one', async () => {
  const app = await fixture();
  const envelopes: string[] = [];
  const ingest = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => { envelopes.push(Buffer.concat(chunks).toString('utf8')); response.writeHead(200).end('{}'); });
  });
  ingest.listen(0, '127.0.0.1');
  await once(ingest, 'listening');
  try {
    const address = ingest.address();
    assert(address && typeof address === 'object');
    const source = `
      import auth from './apps/auth/src/worker.ts';
      import api from './apps/mcp/src/worker.ts';
      import view from './apps/publication/src/worker.ts';
      const { secrets, dsn, ...configured } = JSON.parse(process.env.WORKER_FIXTURE);
      const env = { ...configured, DATABASE_URL: 'unsupported://database' };
      const { PUBLICATION_COOKIE_SECRET: _missing, ...viewEnv } = env;
      const request = (origin) => new Request(origin + '/v1/artifacts?share=' + secrets.query + '&email=' + secrets.email, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + secrets.token, cookie: 'session=' + secrets.cookie, 'content-type': 'application/json', 'x-forwarded-email': secrets.email },
        body: JSON.stringify({ snapshot: secrets.body }),
      });
      for (const [worker, origin, workerEnv] of [[auth, env.AUTH_URL, env], [api, env.API_URL, env], [view, env.PUBLISH_URL, viewEnv]]) {
        for (const SENTRY_DSN of [undefined, dsn]) {
          const tasks = [];
          const status = await Promise.resolve().then(() => worker.fetch(request(origin), { ...workerEnv, SENTRY_DSN }, { waitUntil: (task) => tasks.push(task) })).then((response) => response.status, () => 'thrown');
          await Promise.allSettled(tasks);
          console.log(JSON.stringify({ origin, dsn: Boolean(SENTRY_DSN), status }));
        }
      }
    `;
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], {
      cwd: new URL('..', import.meta.url), timeout: 30_000,
      env: { PATH: process.env.PATH, WORKER_FIXTURE: JSON.stringify({ secrets, dsn: `http://public@127.0.0.1:${address.port}/1`, OWNER_EMAIL: app.config.access.ownerEmail, AUTH_URL: app.config.origin, API_URL: new URL(app.config.resource).origin, MCP_URL: app.config.resource, DASHBOARD_URL: app.config.dashboard, PUBLISH_URL: 'https://published.example.test', BETTER_AUTH_SECRET: app.config.secret, MCP_INTROSPECTION_CLIENT_ID: app.mcpOptions.clientId, MCP_INTROSPECTION_CLIENT_SECRET: app.mcpOptions.clientSecret, PUBLICATION_SERVICE_SECRET: 'service-secret-value-with-enough-length' }) },
    });
    const runs = result.stdout.trim().split('\n').map((line) => JSON.parse(line) as { origin: string; dsn: boolean; status: number | string });
    assert.deepEqual(runs.map(({ dsn, status }) => [dsn, status]), [[false, 503], [true, 503], [false, 503], [true, 503], [false, 'thrown'], [true, 'thrown']], 'Sentry does not change any response');
    const events = envelopes.flatMap((envelope) => envelope.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line) as { type?: string; tags?: Record<string, string>; exception?: { values?: { value?: string }[] } })).filter((item) => item.exception);
    assert.deepEqual(events.map((event) => event.tags?.service), ['artifacts-auth', 'artifacts-api', 'artifacts-view'], 'one event per Worker with a DSN, none without one');
    assert.match(events[0]!.exception!.values![0]!.value!, /URL_SCHEME_NOT_SUPPORTED/);
    assert.match(events[1]!.exception!.values![0]!.value!, /URL_SCHEME_NOT_SUPPORTED/);
    assert.match(events[2]!.exception!.values![0]!.value!, /PUBLICATION_COOKIE_SECRET/);
    for (const envelope of envelopes) for (const [name, value] of Object.entries(secrets)) assert(!envelope.includes(value), `${name} reached Sentry`);
  } finally {
    ingest.close();
    await app.close();
  }
});

let shared: Promise<Awaited<ReturnType<typeof startIngest>>> | undefined;
async function ingest() {
  const sink = await (shared ??= startIngest());
  sink.envelopes.length = 0;
  return sink;
}
test.after(async () => { (await shared)?.server.close(); });

async function startIngest() {
  const envelopes: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => { envelopes.push(Buffer.concat(chunks).toString('utf8')); response.writeHead(200).end('{}'); });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  return { server, envelopes, origin: `http://127.0.0.1:${address.port}`, dsn: `http://public@127.0.0.1:${address.port}/1` };
}

type TestEnv = { SENTRY_DSN?: string };

async function call(handler: ReturnType<typeof withMonitoring<TestEnv>>, request: Request, env: TestEnv) {
  const tasks: Promise<unknown>[] = [];
  const response = await handler.fetch(request, env, { waitUntil: (task) => tasks.push(task) });
  const status = response.status;
  await response.text();
  await Promise.allSettled(tasks);
  return status;
}

async function settle(envelopes: string[]) {
  for (let attempt = 0; attempt < 40 && !envelopes.some((envelope) => envelope.includes('"type":"event"')); attempt++) await delay(50);
}

test('a monitored handler receives the exact env object, so runtime caches keyed by env still hit', async () => {
  const sink = await ingest();
  try {
    const env: TestEnv = { SENTRY_DSN: sink.dsn };
    const received: unknown[] = [];
    const handler = withMonitoring<TestEnv>('artifacts-test', { fetch: async (_request, current) => { received.push(current); return new Response('ok'); } });
    for (let index = 0; index < 2; index++) assert.equal(await call(handler, new Request('https://worker.example/'), env), 200);
    assert.equal(received.length, 2);
    assert(received.every((current) => current === env), 'the handler saw a different env object');
  } finally { sink.envelopes.length = 0; }
});

test('a failed query reported through reportError reaches Sentry without its bound parameters', async () => {
  const sink = await ingest();
  try {
    const handler = withMonitoring<TestEnv>('artifacts-test', { fetch: async () => {
      reportError(new DrizzleQueryError('select * from session where token = ? and body = ?', [secrets.token, secrets.body], new Error(`database unavailable for ${secrets.email}`)));
      return new Response('unavailable', { status: 503 });
    } });
    assert.equal(await call(handler, new Request('https://worker.example/'), { SENTRY_DSN: sink.dsn }), 503);
    await settle(sink.envelopes);
    const sent = sink.envelopes.join('\n');
    assert.match(sent, /Failed query: select \* from session/);
    for (const [name, value] of Object.entries(secrets)) assert(!sent.includes(value), `${name} reached Sentry`);
  } finally { sink.envelopes.length = 0; }
});

test('a sampled sentry-trace header from a client does not make the Worker send spans', async () => {
  const sink = await ingest();
  try {
    const handler = withMonitoring<TestEnv>('artifacts-test', { fetch: async () => {
      await fetch(`${sink.origin}/outbound`);
      reportError(new Error('traced failure'));
      return new Response('ok');
    } });
    const request = new Request('https://worker.example/a/artifact-id', { headers: { 'sentry-trace': `${'a'.repeat(32)}-${'b'.repeat(16)}-1` } });
    assert.equal(await call(handler, request, { SENTRY_DSN: sink.dsn }), 200);
    await settle(sink.envelopes);
    await delay(200);
    const items = sink.envelopes.flatMap((envelope) => envelope.split('\n').filter((line) => line.startsWith('{"type"')).map((line) => (JSON.parse(line) as { type: string }).type));
    assert(items.includes('event'), `the error event was sent, items were ${items.join(', ')}`);
    assert.deepEqual(items.filter((type) => type === 'transaction' || type === 'span'), []);
  } finally { sink.envelopes.length = 0; }
});
