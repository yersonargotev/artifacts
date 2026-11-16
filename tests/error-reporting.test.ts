import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { fixture, grant } from './helpers.ts';
import { restBase } from '../packages/contracts/src/http.ts';
import { createArtifactStore } from '../packages/artifacts/src/index.ts';
import { createArtifactRestApp } from '../packages/rest/src/index.ts';
import { createMcpApp } from '../apps/mcp/src/http.ts';
import { artifactErrorResponse } from '../apps/dashboard/src/publication.ts';
import { publishSelectedRevision } from '../apps/dashboard/src/publish.ts';
import { ArtifactError } from '../packages/contracts/src/index.ts';

const fullScope = 'openid profile offline_access artifacts:read artifacts:write artifacts:publish';

async function failingFixture() {
  const app = await fixture();
  const reported: unknown[] = [];
  const failure = new Error('database connection lost');
  const store = { ...createArtifactStore(app.db, { access: app.config.access, publishOrigin: 'https://published.example.test' }), list: async () => { throw failure; } };
  const token = (await grant(app, fullScope)).access_token;
  return { app, reported, failure, store, token, reportError: (error: unknown) => { reported.push(error); } };
}

function rest(app: Awaited<ReturnType<typeof fixture>>, token: string, path: string, init: RequestInit = {}) {
  return fetch(`${restBase(app.config.resource)}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } });
}

async function mcp(app: Awaited<ReturnType<typeof fixture>>, token: string, name: string, args: unknown) {
  const response = await fetch(app.config.resource, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  assert.equal(response.status, 200);
  const text = await response.text();
  return (JSON.parse(text.startsWith('event:') ? text.split('\n').find((line) => line.startsWith('data: '))!.slice(6) : text) as { result: { structuredContent: unknown; isError?: boolean } }).result;
}

test('the REST handler reports an unexpected store error and keeps its 503 response', async () => {
  const { app, reported, failure, store, token, reportError } = await failingFixture();
  try {
    app.setResourceHandler(createArtifactRestApp(app.mcpOptions, store, { reportError }));
    const response = await rest(app, token, '/artifacts');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: { code: 'unavailable', message: 'Artifact service unavailable', details: {} } });
    assert.deepEqual(reported, [failure]);

    assert.equal((await rest(app, token, '/artifacts/missing')).status, 404, 'ArtifactError');
    assert.equal((await rest(app, token, '/artifacts', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415, 'HttpFailure');
    assert.equal((await rest(app, token, '/artifacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400, 'ZodError');
    assert.deepEqual(reported, [failure], 'expected errors are not reported');
  } finally { await app.close(); }
});

test('the MCP tools report an unexpected store error and keep their unavailable result', async () => {
  const { app, reported, failure, store, token, reportError } = await failingFixture();
  try {
    app.setResourceHandler(createMcpApp(app.mcpOptions, store, { reportError }));
    const result = await mcp(app, token, 'artifacts_list', {});
    assert.equal(result.isError, true);
    assert.deepEqual(result.structuredContent, { error: 'unavailable', message: 'Artifact service unavailable' });
    assert.deepEqual(reported, [failure]);

    const missing = await mcp(app, token, 'artifacts_read', { artifactId: 'missing' });
    assert.equal((missing.structuredContent as { error: string }).error, 'not_found');
    assert.deepEqual(reported, [failure], 'an ArtifactError is not reported');
  } finally { await app.close(); }
});

test('bearer authorization reports a failed token introspection and keeps its 503 response', async () => {
  const { app, reported, store, token, reportError } = await failingFixture();
  try {
    app.setResourceHandler(createArtifactRestApp(app.mcpOptions, store, { reportError }));
    assert.equal((await rest(app, token, '/identity')).status, 200);
    app.setAuthHandler(async (request, bindings) => new URL(request.url).pathname.endsWith('/oauth2/introspect') ? new Response('upstream failed', { status: 500 }) : app.authHandler(request, bindings));
    const response = await rest(app, token, '/identity');
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: 'unavailable', message: 'Identity service unavailable', details: {} } });
    assert.equal(reported.length, 1);
    assert.match(String(reported[0]), /Token introspection returned HTTP 500/);

    app.setAuthHandler(async (request, bindings) => new URL(request.url).pathname.endsWith('/oauth2/introspect') ? new Response('not json') : app.authHandler(request, bindings));
    assert.equal((await rest(app, token, '/identity')).status, 503);
    assert.equal(reported.length, 2);
    assert(reported[1] instanceof SyntaxError);

    app.setAuthHandler(async (request, bindings) => new URL(request.url).pathname.endsWith('/oauth2/introspect') ? Response.json({ active: false }) : app.authHandler(request, bindings));
    assert.equal((await rest(app, token, '/identity')).status, 401);
    assert.equal(reported.length, 2, 'an inactive token is not reported');
  } finally { await app.close(); }
});

async function failedWorkerStartup(worker: 'auth' | 'mcp') {
  const app = await fixture();
  try {
    const source = `
      import assert from 'node:assert/strict';
      import worker from './apps/${worker}/src/worker.ts';
      const env = { ...JSON.parse(process.env.WORKER_FIXTURE), DATABASE_URL: 'unsupported://database' };
      const response = await worker.fetch(new Request(env.${worker === 'auth' ? 'AUTH_URL' : 'API_URL'} + '/health'), env, { waitUntil() {} });
      assert.equal(response.headers.get('cache-control'), 'no-store');
      console.log(JSON.stringify({ status: response.status, body: await response.text() }));
    `;
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], {
      cwd: new URL('..', import.meta.url), timeout: 15_000,
      env: { PATH: process.env.PATH, WORKER_FIXTURE: JSON.stringify({ OWNER_EMAIL: app.config.access.ownerEmail, AUTH_URL: app.config.origin, API_URL: new URL(app.config.resource).origin, MCP_URL: app.config.resource, DASHBOARD_URL: app.config.dashboard, PUBLISH_URL: 'https://published.example.test', BETTER_AUTH_SECRET: app.config.secret, MCP_INTROSPECTION_CLIENT_ID: app.mcpOptions.clientId, MCP_INTROSPECTION_CLIENT_SECRET: app.mcpOptions.clientSecret }) },
    });
    return { response: JSON.parse(result.stdout) as { status: number; body: string }, stderr: result.stderr };
  } finally { await app.close(); }
}

test('the auth Worker logs a failed startup and keeps its 503 response', async () => {
  const { response, stderr } = await failedWorkerStartup('auth');
  assert.deepEqual(response, { status: 503, body: 'Authorization unavailable' });
  assert.match(stderr, /URL_SCHEME_NOT_SUPPORTED/);
});

test('the MCP Worker logs a failed startup and keeps its 503 response', async () => {
  const { response, stderr } = await failedWorkerStartup('mcp');
  assert.deepEqual(response, { status: 503, body: 'MCP unavailable' });
  assert.match(stderr, /URL_SCHEME_NOT_SUPPORTED/);
});

test('the panel reports an unexpected store error behind a 503 or an uncertain outcome and keeps the response', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const failure = new Error('database connection lost');
  const response = artifactErrorResponse(failure);
  assert.equal(response.status, 503);
  assert.equal(await response.text(), 'El servicio no está disponible.');
  assert.equal(artifactErrorResponse(new ArtifactError('not_found', 'Artifact not found')).status, 404);
  assert.deepEqual(logged.mock.calls.map((call) => call.arguments[0]), [failure], 'only the unexpected error is reported');

  logged.mock.resetCalls();
  const actor = { userId: 'user', sessionId: 'session', clientId: 'panel', scopes: [] };
  const command = { requestId: 'publish-uncertain', artifactId: 'artifact', revisionId: 'revision', expectedPublicationVersion: 0 };
  const failing = { publish: async () => { throw failure; }, read: async () => { throw failure; } };
  assert.deepEqual(await publishSelectedRevision(failing, actor, command), { kind: 'uncertain' });
  assert.deepEqual(logged.mock.calls.map((call) => call.arguments[0]), [failure]);
});
