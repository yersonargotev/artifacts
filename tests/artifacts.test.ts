import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { eq } from 'drizzle-orm';
import { artifact, artifactRevision, artifactPublication, publicationGrant, session } from '../packages/db/src/schema.ts';
import { createArtifactStore, projectNameSchema, snapshotSchema, type Actor, type Snapshot } from '../packages/artifacts/src/index.ts';
import { openDatabase } from '../packages/db/src/index.ts';
import { fixture, grant } from './helpers.ts';

const snapshot: Snapshot = {
  metadata: { title: 'Revision one', description: 'Original description', custom: { labels: ['retained'], order: 1 } },
  content: { kind: 'html', text: '<h1>Original</h1>' },
  files: [
    { path: 'notes/hello.txt', mediaType: 'text/plain', encoding: 'utf8', data: 'Hola, mundo 🌎\n' },
    { path: 'bytes.bin', mediaType: 'application/octet-stream', encoding: 'base64', data: 'AAH+/w==' },
  ],
};
async function artifactFixture() {
  const app = await fixture();
  const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
  assert(signedIn);
  const actor: Actor = { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'test-author', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
  const store = createArtifactStore(app.db, { publishOrigin: 'https://published.example.test' });
  return { ...app, store, actor };
}
const createInput = () => ({ requestId: randomUUID(), snapshot });

test('immutable revisions retain metadata and bytes, while publication advances independently', async () => {
  const app = await artifactFixture();
  try {
    const first = await app.store.create(app.actor, createInput());
    assert.equal(first.revision.sequence, 1);
    assert.deepEqual(first.revision.snapshot, snapshot);
    const published = await app.store.publish(app.actor, { requestId: randomUUID(), artifactId: first.artifactId, revisionId: first.revision.id, expectedPublicationVersion: 0 });
    assert.equal(published.url, `https://published.example.test/a/${first.artifactId}`);
    const nextSnapshot = { ...snapshot, metadata: { title: 'Revision two', description: 'Changed description', custom: { labels: ['changed'], order: 2 } }, content: { kind: 'text' as const, text: 'Second content' }, files: [] };
    const second = await app.store.update(app.actor, { requestId: randomUUID(), artifactId: first.artifactId, expectedRevisionId: first.revision.id, snapshot: nextSnapshot });
    assert.equal(second.revision.sequence, 2);
    assert.equal(second.revision.parentRevisionId, first.revision.id);
    assert.equal(second.publication?.revisionId, first.revision.id);
    const historical = await app.store.read(app.actor, { artifactId: first.artifactId, revisionId: first.revision.id });
    assert.deepEqual(historical.revision.snapshot, snapshot);
    assert.equal(historical.headRevisionId, second.revision.id);
    const exported = await app.store.export(app.actor, { artifactId: first.artifactId, revisionId: first.revision.id });
    const repeated = await app.store.export(app.actor, { artifactId: first.artifactId, revisionId: first.revision.id });
    assert.deepEqual(repeated, exported);
    const files = unzipSync(Buffer.from(exported.base64, 'base64'));
    assert.deepEqual(Object.keys(files), ['artifact.json', 'content.html', 'files/bytes.bin', 'files/notes/hello.txt']);
    assert.equal(strFromU8(files['content.html']), '<h1>Original</h1>');
    assert.equal(strFromU8(files['files/notes/hello.txt']), 'Hola, mundo 🌎\n');
    assert.deepEqual([...files['files/bytes.bin']], [0, 1, 254, 255]);
    const manifest = JSON.parse(strFromU8(files['artifact.json']));
    assert.deepEqual(manifest.metadata, snapshot.metadata);
    assert.equal(manifest.revision.id, first.revision.id);
    assert.equal(manifest.files[0].path, 'bytes.bin');
    assert.equal(manifest.files[0].size, 4);
    assert.equal(manifest.files[0].encoding, 'base64');
    assert.equal(manifest.files[0].sha256, 'c5dbae22661af6db18a1f676db82a7ef7de46d27c3a263a872f00478b0d99fc4');
    assert.deepEqual(Object.keys(manifest).sort(), ['artifactId', 'content', 'files', 'formatVersion', 'metadata', 'ownerId', 'revision']);
    const history = await app.store.history(app.actor, { artifactId: first.artifactId, limit: 1 });
    assert.deepEqual(history.items.map((item) => item.id), [second.revision.id]);
    const older = await app.store.history(app.actor, { artifactId: first.artifactId, limit: 1, beforeSequence: history.nextBeforeSequence! });
    assert.deepEqual(older.items.map((item) => item.id), [first.revision.id]);
    const republished = await app.store.publish(app.actor, { requestId: randomUUID(), artifactId: first.artifactId, revisionId: second.revision.id, expectedPublicationVersion: 1 });
    assert.equal(republished.version, 2);
    assert.equal(republished.url, published.url);
  } finally { await app.close(); }
});

test('mutations replay receipts, reject changed arguments, and enforce authority before replay', async () => {
  const app = await artifactFixture();
  try {
    const input = createInput();
    const [first, concurrent] = await Promise.all([app.store.create(app.actor, input), app.store.create(app.actor, input)]);
    assert.deepEqual(concurrent, first);
    assert.deepEqual(await app.store.create(app.actor, input), first);
    await assert.rejects(app.store.create(app.actor, { ...input, snapshot: { ...snapshot, content: { kind: 'text', text: 'Different' } } }), { code: 'request_conflict' });
    const update = { requestId: randomUUID(), artifactId: first.artifactId, expectedRevisionId: first.revision.id, snapshot };
    const second = await app.store.update(app.actor, update);
    assert.deepEqual(await app.store.update(app.actor, update), second);
    const publishing = { requestId: randomUUID(), artifactId: first.artifactId, revisionId: first.revision.id, expectedPublicationVersion: 0 };
    const result = await app.store.publish(app.actor, publishing);
    assert.deepEqual(await app.store.publish(app.actor, publishing), result);
    await assert.rejects(app.store.create({ ...app.actor, scopes: ['artifacts:read'] }, input), { code: 'forbidden' });
    await app.db.delete(session).where(eq(session.id, app.actor.sessionId));
    await assert.rejects(app.store.create(app.actor, input), { code: 'forbidden' });
    await assert.rejects(app.store.publish(app.actor, publishing), { code: 'forbidden' });
  } finally { await app.close(); }
});

test('competing updates and publishers produce one winner and report current versions', async () => {
  const app = await artifactFixture();
  try {
    const first = await app.store.create(app.actor, createInput());
    const secondConnection = await openDatabase({ url: app.databaseUrl });
    const secondStore = createArtifactStore(secondConnection.db, { publishOrigin: 'https://published.example.test' });
    const updates = await Promise.allSettled([app.store, secondStore].map((store, number) => store.update(app.actor, { requestId: randomUUID(), artifactId: first.artifactId, expectedRevisionId: first.revision.id, snapshot: { ...snapshot, content: { kind: 'text', text: `Writer ${number}` } } })));
    secondConnection.client.close();
    assert.equal(updates.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = updates.find((result) => result.status === 'rejected');
    assert(rejected?.status === 'rejected');
    assert.equal(rejected.reason.code, 'conflict');
    const latest = await app.store.read(app.actor, { artifactId: first.artifactId });
    assert.equal(rejected.reason.details.currentRevisionId, latest.revision.id);
    assert.equal((await app.store.history(app.actor, { artifactId: first.artifactId })).items.length, 2);
    const publishers = await Promise.allSettled([first.revision.id, latest.revision.id].map((revisionId) => app.store.publish(app.actor, { requestId: randomUUID(), artifactId: first.artifactId, revisionId, expectedPublicationVersion: 0 })));
    assert.equal(publishers.filter((result) => result.status === 'fulfilled').length, 1);
    const current = await app.store.read(app.actor, { artifactId: first.artifactId });
    assert(current.publication);
    await assert.rejects(app.store.publish(app.actor, { requestId: randomUUID(), artifactId: first.artifactId, revisionId: current.publication.revisionId, expectedPublicationVersion: 0 }), { code: 'conflict', details: { currentPublicationVersion: 1 } });
    const noop = await app.store.publish(app.actor, { requestId: randomUUID(), artifactId: first.artifactId, revisionId: current.publication.revisionId, expectedPublicationVersion: 1 });
    assert.equal(noop.version, 1);
  } finally { await app.close(); }
});

test('owner filters and revision membership prevent reads or publication through another artifact', async () => {
  const app = await artifactFixture();
  try {
    const first = await app.store.create(app.actor, createInput());
    const other = await app.store.create(app.actor, createInput());
    const page = await app.store.list(app.actor, { limit: 1 });
    const next = await app.store.list(app.actor, { limit: 1, cursor: page.nextCursor! });
    assert.equal(new Set([...page.items, ...next.items].map((item) => item.artifactId)).size, 2);
    await assert.rejects(app.store.read(app.actor, { artifactId: first.artifactId, revisionId: other.revision.id }), { code: 'not_found' });
    await assert.rejects(app.store.publish(app.actor, { requestId: randomUUID(), artifactId: first.artifactId, revisionId: other.revision.id, expectedPublicationVersion: 0 }), { code: 'not_found' });
    const outsider = await app.auth.api.signUpEmail({ body: { name: 'Other owner', email: 'other@example.test', password: app.password } });
    const otherSession = await app.auth.api.signInEmail({ body: { email: 'other@example.test', password: app.password } });
    const sessions = await app.db.select().from(session).where(eq(session.userId, outsider.user.id));
    assert(otherSession.token);
    const actor = { ...app.actor, userId: outsider.user.id, sessionId: sessions[0].id };
    assert.deepEqual((await app.store.list(actor, {})).items, []);
    await assert.rejects(app.store.read(actor, { artifactId: first.artifactId }), { code: 'not_found' });
    await assert.rejects(app.store.history(actor, { artifactId: first.artifactId }), { code: 'not_found' });
    await assert.rejects(app.store.export(actor, { artifactId: first.artifactId, revisionId: first.revision.id }), { code: 'not_found' });
  } finally { await app.close(); }
});

test('publication grants are bound, one-use, and recheck live sessions and selected revisions', async () => {
  const app = await artifactFixture();
  try {
    const first = await app.store.create(app.actor, createInput());
    await app.store.publish(app.actor, { requestId: randomUUID(), artifactId: first.artifactId, revisionId: first.revision.id, expectedPublicationVersion: 0 });
    const state = randomUUID();
    const issued = await app.store.issuePublicationGrant(app.actor, { artifactId: first.artifactId, state });
    await assert.rejects(app.store.consumePublicationGrant({ artifactId: first.artifactId, state: randomUUID(), code: issued.code }), { code: 'invalid_grant' });
    const viewer = await app.store.consumePublicationGrant({ artifactId: first.artifactId, state, code: issued.code });
    const published = await app.store.readPublished(viewer, { artifactId: first.artifactId });
    assert.deepEqual(published.revision.snapshot, snapshot);
    await assert.rejects(app.store.consumePublicationGrant({ artifactId: first.artifactId, state, code: issued.code }), { code: 'invalid_grant' });
    await assert.rejects(app.store.readPublished({ ...viewer, artifactId: randomUUID() }, { artifactId: first.artifactId }), { code: 'forbidden' });
    const second = await app.store.update(app.actor, { requestId: randomUUID(), artifactId: first.artifactId, expectedRevisionId: first.revision.id, snapshot: { ...snapshot, files: [] } });
    await app.store.publish(app.actor, { requestId: randomUUID(), artifactId: first.artifactId, revisionId: second.revision.id, expectedPublicationVersion: 1 });
    await assert.rejects(app.store.readPublished(viewer, { artifactId: first.artifactId, revisionId: first.revision.id }), { code: 'not_found' });
    assert.equal((await app.store.readPublished(viewer, { artifactId: first.artifactId })).revision.id, second.revision.id);
    const pending = await app.store.issuePublicationGrant(app.actor, { artifactId: first.artifactId, state });
    await app.db.delete(session).where(eq(session.id, app.actor.sessionId));
    await assert.rejects(app.store.readPublished(viewer, { artifactId: first.artifactId }), { code: 'forbidden' });
    await assert.rejects(app.store.consumePublicationGrant({ artifactId: first.artifactId, state, code: pending.code }), { code: 'invalid_grant' });
  } finally { await app.close(); }
});

test('snapshot validation rejects malformed bytes, unsafe paths, extra fields, and oversized payloads', () => {
  assert.deepEqual(snapshotSchema.parse(snapshot), snapshot);
  const file = snapshot.files[0];
  for (const path of ['../escape', '/absolute', 'a/../b', 'a\\b', 'a//b', 'a/%2e%2e', 'a\u0000b']) assert.equal(snapshotSchema.safeParse({ ...snapshot, files: [{ ...file, path }] }).success, false, path);
  for (const data of ['!', 'AB==', 'AA', 'AA==\n']) assert.equal(snapshotSchema.safeParse({ ...snapshot, files: [{ ...file, encoding: 'base64', data }] }).success, false, data);
  assert.equal(snapshotSchema.safeParse({ ...snapshot, files: [file, file] }).success, false);
  assert.equal(snapshotSchema.safeParse({ ...snapshot, files: Array(33).fill(file) }).success, false);
  assert.equal(snapshotSchema.safeParse({ ...snapshot, metadata: { ...snapshot.metadata, ignored: 'must reject' } }).success, false);
  assert.equal(snapshotSchema.safeParse({ ...snapshot, content: { kind: 'text', text: '🌎'.repeat(270_000) } }).success, false);
});

test('projects group case-insensitively, move without new revisions, and vanish with their last artifact', async () => {
  const app = await artifactFixture();
  try {
    const alpha = await app.store.create(app.actor, { ...createInput(), project: 'Alpha' });
    const beta = await app.store.create(app.actor, { ...createInput(), project: '  alpha ' });
    const loose = await app.store.create(app.actor, createInput());
    const accented = await app.store.create(app.actor, { ...createInput(), project: 'Éxito' });
    const folded = await app.store.create(app.actor, { ...createInput(), project: 'éxito' });
    assert.deepEqual([alpha.project, beta.project, loose.project, accented.project, folded.project], ['Alpha', 'Alpha', null, 'Éxito', 'Éxito']);
    assert.deepEqual(await app.store.projects(app.actor), { items: [{ name: 'Alpha', artifactCount: 2 }, { name: 'Éxito', artifactCount: 2 }] });
    assert.deepEqual((await app.store.list(app.actor, { project: 'ALPHA' })).items.map((item) => [item.artifactId, item.project]), [[alpha.artifactId, 'Alpha'], [beta.artifactId, 'Alpha']].sort(([left], [right]) => left!.localeCompare(right!)));
    assert.deepEqual((await app.store.list(app.actor, { project: 'Missing' })).items, []);
    assert.equal((await app.store.list(app.actor)).items.find((item) => item.artifactId === loose.artifactId)?.project, null);

    const publication = await app.store.publish(app.actor, { requestId: randomUUID(), artifactId: beta.artifactId, revisionId: beta.revision.id, expectedPublicationVersion: 0 });
    const move = { requestId: randomUUID(), artifactId: beta.artifactId, project: 'Beta' };
    assert.deepEqual(await app.store.move(app.actor, move), { artifactId: beta.artifactId, project: 'Beta' });
    assert.deepEqual(await app.store.move(app.actor, move), { artifactId: beta.artifactId, project: 'Beta' });
    await assert.rejects(app.store.move(app.actor, { ...move, project: 'Gamma' }), { code: 'request_conflict' });
    const moved = await app.store.read(app.actor, { artifactId: beta.artifactId });
    assert.equal(moved.project, 'Beta');
    assert.equal(moved.headRevisionId, beta.headRevisionId);
    assert.deepEqual(moved.publication, { revisionId: beta.revision.id, version: 1, url: publication.url });
    assert.deepEqual((await app.store.history(app.actor, { artifactId: beta.artifactId })).items.map((item) => item.id), [beta.revision.id]);
    assert.deepEqual(await app.store.move(app.actor, { requestId: randomUUID(), artifactId: alpha.artifactId, project: 'ALPHA' }), { artifactId: alpha.artifactId, project: 'Alpha' });
    assert.deepEqual((await app.store.projects(app.actor)).items, [{ name: 'Alpha', artifactCount: 1 }, { name: 'Beta', artifactCount: 1 }, { name: 'Éxito', artifactCount: 2 }]);
    assert.deepEqual(await app.store.move(app.actor, { requestId: randomUUID(), artifactId: alpha.artifactId, project: null }), { artifactId: alpha.artifactId, project: null });
    assert.equal((await app.store.read(app.actor, { artifactId: alpha.artifactId })).project, null);
    assert.deepEqual((await app.store.projects(app.actor)).items, [{ name: 'Beta', artifactCount: 1 }, { name: 'Éxito', artifactCount: 2 }]);

    await app.store.delete(app.actor, { requestId: randomUUID(), artifactId: beta.artifactId, expectedRevisionId: beta.headRevisionId, expectedPublicationVersion: 1 });
    assert.deepEqual((await app.store.projects(app.actor)).items, [{ name: 'Éxito', artifactCount: 2 }]);
    await assert.rejects(app.store.move(app.actor, move), { code: 'not_found' });
    await assert.rejects(app.store.move(app.actor, { requestId: randomUUID(), artifactId: 'missing-artifact', project: 'Alpha' }), { code: 'not_found' });
    await assert.rejects(app.store.move({ ...app.actor, scopes: ['artifacts:read'] }, { requestId: randomUUID(), artifactId: loose.artifactId, project: 'Alpha' }), { code: 'forbidden' });
    await assert.rejects(app.store.projects({ ...app.actor, scopes: ['artifacts:write'] }), { code: 'forbidden' });
    const outsider = await app.auth.api.signUpEmail({ body: { name: 'Project outsider', email: 'projects-other@example.test', password: app.password } });
    await app.auth.api.signInEmail({ body: { email: 'projects-other@example.test', password: app.password } });
    const [outsiderSession] = await app.db.select().from(session).where(eq(session.userId, outsider.user.id));
    const other = { ...app.actor, userId: outsider.user.id, sessionId: outsiderSession.id };
    assert.deepEqual(await app.store.projects(other), { items: [] });
    await assert.rejects(app.store.move(other, { requestId: randomUUID(), artifactId: accented.artifactId, project: null }), { code: 'not_found' });
    assert.equal((await app.store.create(other, { ...createInput(), project: 'éxito' })).project, 'éxito');
  } finally { await app.close(); }
});

test('project names are NFC-normalized, trimmed, bounded, and free of control characters', () => {
  assert.equal(projectNameSchema.parse('  Cafe\u0301 '), 'Café');
  assert.equal(projectNameSchema.parse('a'.repeat(80)), 'a'.repeat(80));
  for (const name of ['', '   ', 'a'.repeat(81), 'bell\u0007', 'line\nbreak', 'lone\uD800']) assert.equal(projectNameSchema.safeParse(name).success, false, JSON.stringify(name));
});

test('MCP artifact tools use verified OAuth identity and individual operation scopes', async () => {
  const app = await artifactFixture();
  try {
    const tokens = await grant(app, 'openid profile artifacts:read artifacts:write artifacts:publish');
    async function tool(name: string, input: unknown, token = tokens.access_token) {
      const response = await fetch(app.config.resource, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } }) });
      assert.equal(response.status, 200);
      const body = await response.text();
      const payload = body.startsWith('event:') ? body.split('\n').find((line) => line.startsWith('data:'))!.slice(5) : body;
      return JSON.parse(payload).result;
    }
    const discoveryResponse = await fetch(app.config.resource, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${tokens.access_token}`, 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
    const discoveryText = await discoveryResponse.text();
    const discovery = JSON.parse(discoveryText.startsWith('event:') ? discoveryText.split('\n').find((line) => line.startsWith('data:'))!.slice(5) : discoveryText);
    assert.deepEqual(discovery.result.tools.map((tool: { name: string }) => tool.name).sort(), ['artifacts_create', 'artifacts_export', 'artifacts_history', 'artifacts_list', 'artifacts_publish', 'artifacts_read', 'artifacts_update', 'whoami']);
    const created = await tool('artifacts_create', createInput());
    assert.equal(created.structuredContent.ownerId, app.ownerId);
    assert.equal(created.structuredContent.revision.authorClientId, tokens.clientId);
    const first = created.structuredContent;
    const read = await tool('artifacts_read', { artifactId: first.artifactId });
    assert.deepEqual(read.structuredContent.revision.snapshot, snapshot);
    const readOnly = await grant(app);
    const deniedWrite = await tool('artifacts_update', { requestId: randomUUID(), artifactId: first.artifactId, expectedRevisionId: first.revision.id, snapshot }, readOnly.access_token);
    assert.equal(deniedWrite.isError, true);
    assert.equal(deniedWrite.structuredContent.error, 'forbidden');
    const deniedPublish = await tool('artifacts_publish', { requestId: randomUUID(), artifactId: first.artifactId, revisionId: first.revision.id, expectedPublicationVersion: 0 }, readOnly.access_token);
    assert.equal(deniedPublish.structuredContent.error, 'forbidden');
    const writer = await grant(app, 'openid profile artifacts:read artifacts:write');
    const writerPublish = await tool('artifacts_publish', { requestId: randomUUID(), artifactId: first.artifactId, revisionId: first.revision.id, expectedPublicationVersion: 0 }, writer.access_token);
    assert.equal(writerPublish.structuredContent.error, 'forbidden');
    const publisher = await grant(app, 'openid profile artifacts:read artifacts:publish');
    const published = await tool('artifacts_publish', { requestId: randomUUID(), artifactId: first.artifactId, revisionId: first.revision.id, expectedPublicationVersion: 0 }, publisher.access_token);
    assert.equal(published.structuredContent.version, 1);
    const publisherWrite = await tool('artifacts_update', { requestId: randomUUID(), artifactId: first.artifactId, expectedRevisionId: first.revision.id, snapshot }, publisher.access_token);
    assert.equal(publisherWrite.structuredContent.error, 'forbidden');
    const exported = await tool('artifacts_export', { artifactId: first.artifactId, revisionId: first.revision.id });
    assert.equal(strFromU8(unzipSync(Buffer.from(exported.structuredContent.base64, 'base64'))['content.html']), '<h1>Original</h1>');
  } finally { await app.close(); }
});


test('database constraints reject historical rewrites and cross-artifact pointers', async () => {
  const app = await artifactFixture();
  try {
    const first = await app.store.create(app.actor, createInput());
    const other = await app.store.create(app.actor, createInput());
    await assert.rejects(app.db.update(artifactRevision).set({ snapshot: '{}' }).where(eq(artifactRevision.id, first.revision.id)));
    await assert.rejects(app.db.update(artifact).set({ headRevisionId: other.revision.id }).where(eq(artifact.id, first.artifactId)));
    await assert.rejects(app.db.insert(artifactPublication).values({ artifactId: first.artifactId, revisionId: other.revision.id, version: 1 }));
    await assert.rejects(app.db.insert(artifactRevision).values({ id: randomUUID(), artifactId: first.artifactId, parentRevisionId: other.revision.id, sequence: 2, authorUserId: app.actor.userId, authorClientId: app.actor.clientId, createdAt: new Date(), sha256: first.revision.sha256, snapshot: JSON.stringify(snapshot) }));
    assert.deepEqual((await app.store.read(app.actor, { artifactId: first.artifactId })).revision.snapshot, snapshot);
    assert.equal((await app.store.history(app.actor, { artifactId: first.artifactId })).items.length, 1);
  } finally { await app.close(); }
});

test('grant consumption races admit once and expired sessions and grants fail closed', async () => {
  const app = await artifactFixture();
  try {
    const created = await app.store.create(app.actor, createInput());
    await app.store.publish(app.actor, { requestId: randomUUID(), artifactId: created.artifactId, revisionId: created.revision.id, expectedPublicationVersion: 0 });
    const state = randomUUID();
    const issued = await app.store.issuePublicationGrant(app.actor, { artifactId: created.artifactId, state });
    const input = { artifactId: created.artifactId, state, code: issued.code };
    const outcomes = await Promise.allSettled([app.store.consumePublicationGrant(input), app.store.consumePublicationGrant(input)]);
    assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((result) => result.status === 'rejected' && result.reason.code === 'invalid_grant').length, 1);
    const expired = await app.store.issuePublicationGrant(app.actor, { artifactId: created.artifactId, state });
    await app.db.update(publicationGrant).set({ expiresAt: new Date(Date.now() - 1) });
    await assert.rejects(app.store.consumePublicationGrant({ ...input, code: expired.code }), { code: 'invalid_grant' });
    const pending = await app.store.issuePublicationGrant(app.actor, { artifactId: created.artifactId, state });
    await app.db.update(session).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(session.id, app.actor.sessionId));
    await assert.rejects(app.store.consumePublicationGrant({ ...input, code: pending.code }), { code: 'invalid_grant' });
    await assert.rejects(app.store.read(app.actor, { artifactId: created.artifactId }), { code: 'forbidden' });
  } finally { await app.close(); }
});
