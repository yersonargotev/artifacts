import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { fixture, grant } from './helpers.ts';
import { canonicalResource, protectedResourceMetadataUrl, restBase } from '../packages/contracts/src/http.ts';
import { createArtifactStore, ArtifactError as StoreError } from '../packages/artifacts/src/index.ts';
import { ArtifactError, type ArtifactRead, type Share, type Snapshot } from '../packages/contracts/src/index.ts';
import { createArtifactRestApp } from '../packages/rest/src/index.ts';

const snapshot: Snapshot = { metadata: { title: 'HTTP retained artifact', description: 'A complete REST snapshot', custom: { preserved: ['one', 2] } }, content: { kind: 'html', text: '<h1>REST first revision</h1>' }, files: [{ path: 'data/raw.bin', mediaType: 'application/octet-stream', encoding: 'base64', data: 'AAEC/w==' }] };
const fullScope = 'openid profile offline_access artifacts:read artifacts:write artifacts:publish';
function api(app: Awaited<ReturnType<typeof fixture>>, token: string) {
  return (path: string, method = 'GET', body?: unknown) => fetch(`${restBase(app.config.resource)}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual' });
}
async function error(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const value = await response.json() as { error: { code: string; message: string; details: Record<string, unknown> } };
  assert.equal(value.error.code, code);
  assert.equal(typeof value.error.message, 'string');
  return value.error;
}
async function mcp(app: Awaited<ReturnType<typeof fixture>>, token: string, name: string, args: unknown) {
  const response = await fetch(app.config.resource, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  assert.equal(response.status, 200);
  const text = await response.text();
  const value = JSON.parse(text.startsWith('event:') ? text.split('\n').find((line) => line.startsWith('data: '))!.slice(6) : text) as { result: { structuredContent: unknown; isError?: boolean } };
  return value.result;
}

test('REST sharing normalizes, lists, replays across transports, and never restores a revoked share', async () => {
  const app = await fixture({ transport: 'combined' });
  try {
    const tokens = await grant(app, fullScope);
    const call = api(app, tokens.access_token);
    const created = await (await call('/artifacts', 'POST', { requestId: 'sharing-rest-create', snapshot })).json() as ArtifactRead;
    const path = `/artifacts/${created.artifactId}/shares`;
    const command = { requestId: 'sharing-rest-normalize', email: ' Ana@Example.com ' };
    const response = await call(path, 'POST', command);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const share = await response.json() as Share;
    assert.deepEqual(share, { shareId: share.shareId, artifactId: created.artifactId, kind: 'email', value: 'ana@example.com', createdAt: share.createdAt });
    assert.equal(typeof share.shareId, 'string');
    assert.equal(Number.isNaN(Date.parse(share.createdAt)), false);
    assert.deepEqual(await (await call(path, 'POST', { ...command, email: 'ana@example.com' })).json(), share);
    assert.deepEqual(await (await call(path, 'POST', { requestId: 'sharing-rest-duplicate', email: 'ANA@example.com' })).json(), share);
    assert.deepEqual((await mcp(app, tokens.access_token, 'artifacts_share', { ...command, artifactId: created.artifactId })).structuredContent, share);
    const listing = await call(path);
    assert.equal(listing.status, 200);
    assert.equal(listing.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await listing.json(), { items: [share] });
    await error(await call(path, 'POST', { ...command, email: 'other@example.com' }), 409, 'request_conflict');
    const remove = { requestId: 'sharing-rest-remove' };
    for (let retry = 0; retry < 2; retry++) {
      const removed = await call(`${path}/${share.shareId}`, 'DELETE', remove);
      assert.equal(removed.status, 204);
      assert.equal(removed.headers.get('cache-control'), 'no-store');
      assert.equal(removed.headers.has('content-type'), false);
      assert.equal((await removed.arrayBuffer()).byteLength, 0);
    }
    assert.deepEqual((await mcp(app, tokens.access_token, 'artifacts_unshare', { ...remove, artifactId: created.artifactId, shareId: share.shareId })).structuredContent, { artifactId: created.artifactId, shareId: share.shareId });
    await error(await call(`${path}/${share.shareId}`, 'DELETE', { requestId: 'sharing-rest-missing' }), 404, 'not_found');
    await error(await call(`${path}/different`, 'DELETE', remove), 409, 'request_conflict');
    assert.deepEqual(await (await call(path, 'POST', command)).json(), share);
    assert.deepEqual(await (await call(path)).json(), { items: [] });
  } finally { await app.close(); }
});

test('REST sharing validates strict path-owned commands, queries, methods, media types, and Origin', async () => {
  const app = await fixture({ transport: 'rest' });
  try {
    const call = api(app, (await grant(app, fullScope)).access_token);
    const created = await (await call('/artifacts', 'POST', { requestId: 'sharing-boundaries-create', snapshot })).json() as ArtifactRead;
    const path = `/artifacts/${created.artifactId}/shares`;
    const command = { requestId: 'sharing-boundaries-share', email: 'ana@example.com' };
    const wrongMethod = await call(path, 'PUT', command);
    await error(wrongMethod, 405, 'method_not_allowed');
    assert.equal(wrongMethod.headers.get('allow'), 'GET, POST');
    const wrongItemMethod = await call(`${path}/share`);
    await error(wrongItemMethod, 405, 'method_not_allowed');
    assert.equal(wrongItemMethod.headers.get('allow'), 'DELETE');
    for (const suffix of ['/', '/share/extra']) await error(await call(`${path}${suffix}`), 404, 'not_found');
    for (const [method, suffix, body] of [['GET', '', undefined], ['POST', '', command], ['DELETE', '/share', { requestId: 'sharing-boundaries-delete' }]] as const) {
      await error(await call(`${path}${suffix}?unknown=1`, method, body), 400, 'invalid_input');
    }
    for (const body of [{ ...command, artifactId: created.artifactId }, { ...command, shareId: 'share' }, { ...command, email: 'not-an-email' }, { email: 'ana@example.com' }]) await error(await call(path, 'POST', body), 400, 'invalid_input');
    for (const body of [{}, { requestId: 'short' }, { requestId: 'sharing-boundaries-delete', artifactId: created.artifactId }, { requestId: 'sharing-boundaries-delete', shareId: 'share' }]) await error(await call(`${path}/share`, 'DELETE', body), 400, 'invalid_input');
    const token = (await grant(app, fullScope)).access_token;
    for (const [method, suffix] of [['POST', ''], ['DELETE', '/share']] as const) {
      const url = `${restBase(app.config.resource)}${path}${suffix}`;
      await error(await fetch(url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' }, body: '{}' }), 415, 'unsupported_media_type');
      await error(await fetch(url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{' }), 400, 'invalid_input');
      await error(await fetch(url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: 'https://foreign.example' }, body: JSON.stringify(command) }), 403, 'forbidden');
    }
    await error(await call(`${path}/share`, 'DELETE'), 415, 'unsupported_media_type');
    assert.deepEqual(await (await call(path)).json(), { items: [] });
  } finally { await app.close(); }
});

test('REST sharing enforces publish-only authority, ownership, artifact binding, and revocation before replay', async () => {
  const app = await fixture({ transport: 'rest' });
  try {
    const owner = api(app, (await grant(app, fullScope)).access_token);
    const first = await (await owner('/artifacts', 'POST', { requestId: 'sharing-authority-first', snapshot })).json() as ArtifactRead;
    const second = await (await owner('/artifacts', 'POST', { requestId: 'sharing-authority-second', snapshot })).json() as ArtifactRead;
    const path = `/artifacts/${first.artifactId}/shares`;
    const command = { requestId: 'sharing-authority-command', email: 'ana@example.com' };
    const publisherToken = (await grant(app, 'openid profile offline_access artifacts:publish')).access_token;
    const publisher = api(app, publisherToken);
    const shared = await publisher(path, 'POST', command);
    assert.equal(shared.status, 201);
    const share = await shared.json() as Share;
    assert.deepEqual(await (await publisher(path)).json(), { items: [share] });
    for (const scope of ['artifacts:read', 'artifacts:write']) {
      const limited = api(app, (await grant(app, `openid profile offline_access ${scope}`)).access_token);
      for (const [suffix, method, body] of [['', 'GET', undefined], ['', 'POST', command], [`/${share.shareId}`, 'DELETE', { requestId: 'sharing-authority-remove' }]] as const) {
        const response = await limited(`${path}${suffix}`, method, body);
        const result = await error(response, 403, 'forbidden');
        assert.deepEqual(result.details, { requiredScopes: ['artifacts:publish'] });
        assert.match(response.headers.get('www-authenticate')!, /insufficient_scope/);
      }
    }
    await error(await publisher(`/artifacts/${second.artifactId}/shares/${share.shareId}`, 'DELETE', { requestId: 'sharing-authority-wrong-artifact' }), 404, 'not_found');
    assert.deepEqual(await (await publisher(path)).json(), { items: [share] });
    await app.auth.api.signUpEmail({ body: { name: 'Guest', email: 'sharing-guest@example.test', password: app.password } });
    const signIn = await app.auth.api.signInEmail({ body: { email: 'sharing-guest@example.test', password: app.password }, returnHeaders: true });
    const cookie = signIn.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    const guest = api(app, (await grant({ ...app, cookie }, fullScope)).access_token);
    for (const [suffix, method, body] of [['', 'GET', undefined], ['', 'POST', command], [`/${share.shareId}`, 'DELETE', { requestId: 'sharing-guest-remove' }]] as const) await error(await guest(`${path}${suffix}`, method, body), 404, 'not_found');
    const remove = { requestId: 'sharing-authority-remove' };
    assert.equal((await publisher(`${path}/${share.shareId}`, 'DELETE', remove)).status, 204);
    const revoked = await fetch(`${app.config.origin}/revoke-all`, { method: 'POST', headers: { cookie: app.cookie, origin: app.config.origin }, redirect: 'manual' });
    assert.equal(revoked.status, 303);
    await error(await publisher(path, 'POST', command), 401, 'unauthenticated');
    await error(await publisher(`${path}/${share.shareId}`, 'DELETE', remove), 401, 'unauthenticated');
    await error(await publisher(path), 401, 'unauthenticated');
  } finally { await app.close(); }
});

test('REST sharing recovers lost committed POST and DELETE responses with the same commands', async () => {
  const app = await fixture({ transport: 'rest' });
  try {
    const call = api(app, (await grant(app, fullScope)).access_token);
    const created = await (await call('/artifacts', 'POST', { requestId: 'sharing-lost-create', snapshot })).json() as ArtifactRead;
    const path = `/artifacts/${created.artifactId}/shares`;
    const command = { requestId: 'sharing-lost-post', email: 'ana@example.com' };
    app.dropNextResourceResponse('POST');
    await assert.rejects(call(path, 'POST', command), /fetch failed/);
    const retried = await call(path, 'POST', command);
    assert.equal(retried.status, 201);
    const share = await retried.json() as Share;
    assert.deepEqual(await (await call(path)).json(), { items: [share] });
    const remove = { requestId: 'sharing-lost-delete' };
    app.dropNextResourceResponse('DELETE');
    await assert.rejects(call(`${path}/${share.shareId}`, 'DELETE', remove), /fetch failed/);
    const removed = await call(`${path}/${share.shareId}`, 'DELETE', remove);
    assert.equal(removed.status, 204);
    assert.equal(await removed.text(), '');
    assert.deepEqual(await (await call(path)).json(), { items: [] });
  } finally { await app.close(); }
});

test('REST-only HTTP creates, reads, edits, publishes, paginates and exports exact retained bytes', async () => {
  const app = await fixture({ transport: 'rest' });
  try {
    const tokens = await grant(app, fullScope);
    const call = api(app, tokens.access_token);
    assert.equal((await fetch(app.config.resource, { method: 'POST' })).status, 404);
    const identity = await (await call('/identity')).json();
    assert.equal(identity.userId, app.ownerId);
    assert.equal(identity.clientId, tokens.clientId);
    const metadata = await (await fetch(protectedResourceMetadataUrl(app.config.resource))).json();
    assert.equal(metadata.resource, app.config.resource);
    const command = { requestId: 'rest-create-complete', snapshot };
    const createdResponse = await call('/artifacts', 'POST', command);
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as ArtifactRead;
    assert.deepEqual(created.revision.snapshot, snapshot);
    assert.equal(created.ownerId, app.ownerId);
    assert.deepEqual(await (await call('/artifacts', 'POST', command)).json(), created);
    const listing = await (await call('/artifacts?limit=1')).json();
    assert.deepEqual(listing.items.map((item: { title: string }) => item.title), ['HTTP retained artifact']);
    assert.equal(listing.nextCursor, null);
    const changed = structuredClone(snapshot);
    changed.content.text = '<h1>REST second revision</h1>';
    const update = { requestId: 'rest-update-complete', artifactId: created.artifactId, expectedRevisionId: created.headRevisionId, snapshot: changed };
    const updated = await (await call(`/artifacts/${created.artifactId}`, 'PUT', update)).json() as ArtifactRead;
    assert.equal(updated.revision.sequence, 2);
    assert.deepEqual(updated.revision.snapshot.files, snapshot.files);
    assert.equal((await (await call(`/artifacts/${created.artifactId}?revisionId=${created.revision.id}`)).json()).revision.snapshot.content.text, '<h1>REST first revision</h1>');
    const compact = await (await call(`/artifacts/${created.artifactId}?response=compact`)).json();
    assert.equal(compact.revision.content.utf8Bytes, 29);
    assert.equal(Object.hasOwn(compact.revision, 'snapshot'), false);
    const history = await (await call(`/artifacts/${created.artifactId}/history?limit=1&response=summary`)).json();
    assert.equal(history.items[0].sequence, 2);
    assert.equal(history.nextBeforeSequence, 2);
    const previous = await (await call(`/artifacts/${created.artifactId}/history?beforeSequence=2`)).json();
    assert.deepEqual(previous.items.map((item: { sequence: number }) => item.sequence), [1]);
    const publish = { requestId: 'rest-publication-one', artifactId: created.artifactId, revisionId: created.revision.id, expectedPublicationVersion: 0 };
    const publication = await (await call(`/artifacts/${created.artifactId}/publication`, 'PUT', publish)).json();
    assert.equal(publication.version, 1);
    assert.equal(publication.revisionId, created.revision.id);
    assert.equal(publication.url, `https://published.example.test/a/${created.artifactId}`);
    const exported = await call(`/artifacts/${created.artifactId}/revisions/${created.revision.id}/export`);
    assert.equal(exported.headers.get('content-type'), 'application/zip');
    const bytes = Buffer.from(await exported.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), exported.headers.get('x-artifact-sha256'));
    const files = unzipSync(bytes);
    assert.equal(Buffer.from(files['content.html']).toString(), '<h1>REST first revision</h1>');
    assert.deepEqual([...files['files/data/raw.bin']], [0, 1, 2, 255]);
    assert.equal(JSON.parse(Buffer.from(files['artifact.json']).toString()).revision.id, created.revision.id);
  } finally { await app.close(); }
});

test('REST validates HTTP boundaries and complete route-bound commands before store mutation', async () => {
  const app = await fixture({ transport: 'rest' });
  try {
    const tokens = await grant(app, fullScope);
    const call = api(app, tokens.access_token);
    const unauthorized = await fetch(`${restBase(app.config.resource)}/artifacts`);
    await error(unauthorized, 401, 'unauthenticated');
    assert.equal(unauthorized.headers.get('www-authenticate')?.includes('resource_metadata'), false);
    for (const query of ['limit=1&limit=2', 'limit=1.0', 'limit=+1', 'limit=1e1', 'limit=9007199254740992', 'ownerId=other']) await error(await call(`/artifacts?${query}`), 400, 'invalid_input');
    await error(await call('/artifacts', 'POST', { requestId: 'invalid-extra-actor', snapshot, actor: { userId: 'spoofed' } }), 400, 'invalid_input');
    await error(await call('/artifacts', 'POST', { requestId: 'invalid-not-complete' }), 400, 'invalid_input');
    await error(await call('/artifacts/wrong', 'PUT', { requestId: 'invalid-route-identity', artifactId: 'different', expectedRevisionId: 'revision', snapshot }), 400, 'invalid_input');
    await error(await call('/artifacts/wrong/publication', 'PUT', { requestId: 'invalid-publish-route', artifactId: 'different', revisionId: 'revision', expectedPublicationVersion: 0 }), 400, 'invalid_input');
    const unsupported = await call('/artifacts', 'DELETE');
    await error(unsupported, 405, 'method_not_allowed');
    assert.equal(unsupported.headers.get('allow'), 'GET, POST');
    await error(await fetch(`${restBase(app.config.resource)}/artifacts`, { method: 'POST', headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'text/plain' }, body: '{}' }), 415, 'unsupported_media_type');
    await error(await fetch(`${restBase(app.config.resource)}/artifacts`, { method: 'POST', headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json' }, body: '{' }), 400, 'invalid_input');
    await error(await fetch(`${restBase(app.config.resource)}/artifacts`, { method: 'POST', headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json' }, body: ' '.repeat(8_388_609) }), 413, 'request_too_large');
    let chunked = false;
    app.setResourceHandler((request) => {
      chunked = request.method === 'POST' && !request.headers.has('content-length');
      return app.resourceHandler(request);
    });
    const streamed = new ReadableStream<Uint8Array>({ start(controller) { for (let index = 0; index < 129; index++) controller.enqueue(new Uint8Array(65_536).fill(32)); controller.close(); } });
    const streamedInit = { method: 'POST', headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json' }, body: streamed, duplex: 'half' };
    await error(await fetch(`${restBase(app.config.resource)}/artifacts`, streamedInit), 413, 'request_too_large');
    assert.equal(chunked, true);
    await error(await fetch(`${restBase(app.config.resource)}/artifacts`, { headers: { authorization: `Bearer ${tokens.access_token}`, origin: 'https://attacker.example' } }), 403, 'forbidden');
    const handler = createArtifactRestApp(app.mcpOptions, createArtifactStore(app.db, { publishOrigin: 'https://published.example.test' }));
    await error(await handler(new Request('http://attacker.example/mcp/v1/artifacts')), 400, 'invalid_host');
    assert.deepEqual(await (await call('/artifacts')).json(), { items: [], nextCursor: null });
  } finally { await app.close(); }
});

test('REST and MCP share retained state, exact replay, and competing publication expectations', async () => {
  const app = await fixture({ transport: 'combined' });
  try {
    const tokens = await grant(app, fullScope);
    const call = api(app, tokens.access_token);
    const command = { requestId: 'interoperable-create', snapshot };
    const created = await (await call('/artifacts', 'POST', command)).json() as ArtifactRead;
    const fromMcp = await mcp(app, tokens.access_token, 'artifacts_read', { artifactId: created.artifactId });
    assert.deepEqual(fromMcp.structuredContent, created);
    const nextSnapshot = { ...snapshot, content: { kind: 'html', text: '<h1>MCP revision</h1>' } };
    const fromMcpUpdate = await mcp(app, tokens.access_token, 'artifacts_update', { requestId: 'mcp-after-rest-update', artifactId: created.artifactId, expectedRevisionId: created.headRevisionId, snapshot: nextSnapshot });
    const updated = fromMcpUpdate.structuredContent as ArtifactRead;
    assert.equal(updated.revision.sequence, 2);
    assert.equal((await (await call(`/artifacts/${created.artifactId}`)).json()).revision.snapshot.content.text, '<h1>MCP revision</h1>');
    const basePublish = { artifactId: created.artifactId, revisionId: updated.revision.id, expectedPublicationVersion: 0 };
    const [restPublication, mcpPublication] = await Promise.all([
      call(`/artifacts/${created.artifactId}/publication`, 'PUT', { ...basePublish, requestId: 'publication-rest-race' }),
      mcp(app, tokens.access_token, 'artifacts_publish', { ...basePublish, requestId: 'publication-mcp-race' }),
    ]);
    assert.equal(Number(restPublication.status === 200) + Number(!mcpPublication.isError), 1);
    if (restPublication.status !== 200) await error(restPublication, 409, 'conflict');
    else assert.equal((mcpPublication.structuredContent as { error: string }).error, 'conflict');
    const current = await (await call(`/artifacts/${created.artifactId}`)).json();
    assert.equal(current.publication.version, 1);
    assert.equal(current.publication.url, `https://published.example.test/a/${created.artifactId}`);
    assert.deepEqual((await mcp(app, tokens.access_token, 'artifacts_create', command)).structuredContent, created);
    await error(await call('/artifacts', 'POST', { ...command, response: 'full' }), 409, 'request_conflict');
  } finally { await app.close(); }
});

test('REST and MCP share project creation, filtering, listing, and route-bound moves', async () => {
  const app = await fixture({ transport: 'combined' });
  try {
    const tokens = await grant(app, fullScope);
    const call = api(app, tokens.access_token);
    const ids = (items: { artifactId: string }[]) => items.map((item) => item.artifactId).sort();
    const alphaResponse = await call('/artifacts', 'POST', { requestId: 'rest-project-alpha', snapshot, project: 'Alpha' });
    assert.equal(alphaResponse.status, 201);
    const alpha = await alphaResponse.json() as ArtifactRead;
    assert.equal(alpha.project, 'Alpha');
    const second = (await mcp(app, tokens.access_token, 'artifacts_create', { requestId: 'mcp-project-alpha', snapshot, project: ' ALPHA ' })).structuredContent as ArtifactRead;
    assert.equal(second.project, 'Alpha');
    assert.equal((await (await call('/artifacts', 'POST', { requestId: 'rest-project-none', snapshot })).json()).project, null);
    assert.deepEqual(await (await call('/projects')).json(), { items: [{ name: 'Alpha', artifactCount: 2 }] });
    assert.deepEqual(ids((await (await call('/artifacts?project=alpha')).json()).items), [alpha.artifactId, second.artifactId].sort());

    const move = { requestId: 'rest-project-move', artifactId: second.artifactId, project: 'Beta' };
    const moved = await call(`/artifacts/${second.artifactId}/project`, 'PUT', move);
    assert.equal(moved.status, 200);
    assert.deepEqual(await moved.json(), { artifactId: second.artifactId, project: 'Beta' });
    assert.deepEqual(await (await call(`/artifacts/${second.artifactId}/project`, 'PUT', move)).json(), { artifactId: second.artifactId, project: 'Beta' });
    await error(await call(`/artifacts/${second.artifactId}/project`, 'PUT', { ...move, project: null }), 409, 'request_conflict');
    const read = await (await call(`/artifacts/${second.artifactId}`)).json() as ArtifactRead;
    assert.equal(read.project, 'Beta');
    assert.equal(read.headRevisionId, second.headRevisionId);
    assert.deepEqual((await mcp(app, tokens.access_token, 'projects_list', {})).structuredContent, { items: [{ name: 'Alpha', artifactCount: 1 }, { name: 'Beta', artifactCount: 1 }] });
    assert.deepEqual((await mcp(app, tokens.access_token, 'artifacts_move', { requestId: 'mcp-project-clear', artifactId: alpha.artifactId, project: null })).structuredContent, { artifactId: alpha.artifactId, project: null });
    assert.deepEqual(ids(((await mcp(app, tokens.access_token, 'artifacts_list', { project: 'beta' })).structuredContent as { items: { artifactId: string }[] }).items), [second.artifactId]);
    assert.deepEqual(await (await call('/projects')).json(), { items: [{ name: 'Beta', artifactCount: 1 }] });

    await error(await call(`/artifacts/${alpha.artifactId}/project`, 'PUT', { requestId: 'rest-project-mismatch', artifactId: second.artifactId, project: 'Gamma' }), 400, 'invalid_input');
    await error(await call(`/artifacts/${alpha.artifactId}/project`, 'PUT', { requestId: 'rest-project-absent', artifactId: alpha.artifactId }), 400, 'invalid_input');
    await error(await call(`/artifacts/${alpha.artifactId}/project`, 'PUT', { requestId: 'rest-project-control', artifactId: alpha.artifactId, project: 'bell\u0007' }), 400, 'invalid_input');
    const wrongMethod = await call(`/artifacts/${alpha.artifactId}/project`);
    await error(wrongMethod, 405, 'method_not_allowed');
    assert.equal(wrongMethod.headers.get('allow'), 'PUT');
    const wrongProjectsMethod = await call('/projects', 'POST', {});
    await error(wrongProjectsMethod, 405, 'method_not_allowed');
    assert.equal(wrongProjectsMethod.headers.get('allow'), 'GET');
    await error(await call('/projects?limit=1'), 400, 'invalid_input');
    await error(await call(`/artifacts?project=${'x'.repeat(81)}`), 400, 'invalid_input');
    await error(await call('/projects/Beta'), 404, 'not_found');
    const reader = api(app, (await grant(app)).access_token);
    await error(await reader(`/artifacts/${alpha.artifactId}/project`, 'PUT', { requestId: 'rest-project-reader', artifactId: alpha.artifactId, project: 'Gamma' }), 403, 'forbidden');
    assert.deepEqual(await (await reader('/projects')).json(), { items: [{ name: 'Beta', artifactCount: 1 }] });
    await error(await api(app, (await grant(app, 'openid profile offline_access artifacts:write')).access_token)('/projects'), 403, 'forbidden');
  } finally { await app.close(); }
});

test('two independent HTTP writers produce one head winner and one conflict without an extra revision', async () => {
  const app = await fixture({ transport: 'rest' });
  try {
    const tokens = await grant(app, fullScope);
    const call = api(app, tokens.access_token);
    const created = await (await call('/artifacts', 'POST', { requestId: 'http-writer-base', snapshot })).json() as ArtifactRead;
    const responses = await Promise.all(['Writer one', 'Writer two'].map((title, index) => call(`/artifacts/${created.artifactId}`, 'PUT', { requestId: `http-writer-${index}`, artifactId: created.artifactId, expectedRevisionId: created.headRevisionId, snapshot: { ...snapshot, metadata: { ...snapshot.metadata, title } } })));
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    await error(responses.find((response) => response.status === 409)!, 409, 'conflict');
    const history = await (await call(`/artifacts/${created.artifactId}/history`)).json();
    assert.deepEqual(history.items.map((item: { sequence: number }) => item.sequence), [2, 1]);
  } finally { await app.close(); }
});

test('REST ownership, scopes, and central revocation apply before command receipt replay', async () => {
  const app = await fixture({ transport: 'rest' });
  try {
    const tokens = await grant(app, fullScope);
    const call = api(app, tokens.access_token);
    const command = { requestId: 'authority-create-replay', snapshot };
    const created = await (await call('/artifacts', 'POST', command)).json() as ArtifactRead;
    const writeOnly = await grant(app, 'openid profile offline_access artifacts:write');
    const writeResponse = await api(app, writeOnly.access_token)('/artifacts', 'POST', { requestId: 'write-without-read-scope', snapshot });
    assert.equal(writeResponse.status, 201);
    assert.equal((await writeResponse.json()).ownerId, app.ownerId);
    await error(await api(app, writeOnly.access_token)(`/artifacts/${created.artifactId}`), 403, 'forbidden');
    const limited = await grant(app);
    await error(await api(app, limited.access_token)('/artifacts', 'POST', command), 403, 'forbidden');
    const publication = { requestId: 'authority-publish-replay', artifactId: created.artifactId, revisionId: created.revision.id, expectedPublicationVersion: 0 };
    assert.equal((await call(`/artifacts/${created.artifactId}/publication`, 'PUT', publication)).status, 200);
    await error(await api(app, limited.access_token)(`/artifacts/${created.artifactId}/publication`, 'PUT', publication), 403, 'forbidden');
    await app.auth.api.signUpEmail({ body: { name: 'Other owner', email: 'rest-other@example.test', password: app.password } });
    const signIn = await app.auth.api.signInEmail({ body: { email: 'rest-other@example.test', password: app.password }, returnHeaders: true });
    const outsiderCookie = signIn.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    const outsider = await grant({ ...app, cookie: outsiderCookie }, fullScope);
    const other = api(app, outsider.access_token);
    for (const path of [`/artifacts/${created.artifactId}`, `/artifacts/${created.artifactId}/history`, `/artifacts/${created.artifactId}/revisions/${created.revision.id}/export`]) await error(await other(path), 404, 'not_found');
    await error(await other(`/artifacts/${created.artifactId}/publication`, 'PUT', publication), 404, 'not_found');
    const revoked = await fetch(`${app.config.origin}/revoke-all`, { method: 'POST', headers: { cookie: app.cookie, origin: app.config.origin }, redirect: 'manual' });
    assert.equal(revoked.status, 303);
    await error(await call('/artifacts', 'POST', command), 401, 'unauthenticated');
    await error(await call(`/artifacts/${created.artifactId}/publication`, 'PUT', publication), 401, 'unauthenticated');
    await error(await call(`/artifacts/${created.artifactId}`), 401, 'unauthenticated');
  } finally { await app.close(); }
});

test('canonical root audiences remain compatible and ArtifactError keeps one runtime identity', async () => {
  assert.equal(canonicalResource('https://artifacts.example'), 'https://artifacts.example');
  assert.equal(StoreError, ArtifactError);
  const app = await fixture({ transport: 'combined', resourcePath: '' });
  try {
    const tokens = await grant(app, fullScope);
    const identity = await (await api(app, tokens.access_token)('/identity')).json();
    assert.equal(identity.userId, app.ownerId);
    assert.equal((await mcp(app, tokens.access_token, 'whoami', {})).isError, undefined);
    assert.equal((await (await fetch(protectedResourceMetadataUrl(app.config.resource))).json()).resource, app.config.resource);
  } finally { await app.close(); }
});


test('lost committed HTTP create, update, and publish responses replay their exact receipts', async () => {
  const app = await fixture({ transport: 'rest' });
  try {
    const tokens = await grant(app, fullScope);
    const call = api(app, tokens.access_token);
    const create = { requestId: 'lost-response-create', snapshot };
    app.dropNextResourceResponse('POST');
    await assert.rejects(call('/artifacts', 'POST', create), /fetch failed/);
    const created = await (await call('/artifacts', 'POST', create)).json() as ArtifactRead;
    assert.equal(created.revision.sequence, 1);
    assert.equal((await (await call('/artifacts')).json()).items.length, 1);
    const update = { requestId: 'lost-response-update', artifactId: created.artifactId, expectedRevisionId: created.headRevisionId, snapshot: { ...snapshot, content: { kind: 'text', text: 'Committed despite lost HTTP response' } } };
    app.dropNextResourceResponse('PUT');
    await assert.rejects(call(`/artifacts/${created.artifactId}`, 'PUT', update), /fetch failed/);
    const updated = await (await call(`/artifacts/${created.artifactId}`, 'PUT', update)).json() as ArtifactRead;
    assert.equal(updated.revision.sequence, 2);
    assert.equal(updated.revision.snapshot.content.text, 'Committed despite lost HTTP response');
    const publish = { requestId: 'lost-response-publish', artifactId: created.artifactId, revisionId: updated.revision.id, expectedPublicationVersion: 0 };
    app.dropNextResourceResponse('PUT');
    await assert.rejects(call(`/artifacts/${created.artifactId}/publication`, 'PUT', publish), /fetch failed/);
    const publication = await (await call(`/artifacts/${created.artifactId}/publication`, 'PUT', publish)).json();
    assert.equal(publication.version, 1);
    assert.equal(publication.revisionId, updated.revision.id);
    assert.deepEqual((await (await call(`/artifacts/${created.artifactId}/history`)).json()).items.map((item: { sequence: number }) => item.sequence), [2, 1]);
    await error(await call(`/artifacts/${created.artifactId}`, 'PUT', { ...update, response: 'full' }), 409, 'request_conflict');
    await error(await call(`/artifacts/${created.artifactId}/publication`, 'PUT', { ...publish, expectedPublicationVersion: 1 }), 409, 'request_conflict');
  } finally { await app.close(); }
});
