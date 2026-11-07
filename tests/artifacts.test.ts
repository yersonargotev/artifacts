import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { eq } from 'drizzle-orm';
import { artifact, artifactCommand, artifactRevision, artifactPublication, artifactShare, publicationGrant, session, user } from '../packages/db/src/schema.ts';
import { createArtifactStore, createSchema, moveSchema, projectNameSchema, readSchema, searchSchema, slugSchema, snapshotSchema, type Actor, type Snapshot } from '../packages/artifacts/src/index.ts';
import { canonicalJson, sha256 } from '../packages/artifacts/src/serialization.ts';
import { openDatabase } from '../packages/db/src/index.ts';
import { designSnapshot, fixture, grant } from './helpers.ts';

const snapshot: Snapshot = {
  metadata: { title: 'Revision one', description: 'Original description', custom: { labels: ['retained'], order: 1 } },
  content: { kind: 'html', text: '<h1>Original</h1>' },
  files: [
    { path: 'notes/hello.txt', mediaType: 'text/plain', encoding: 'utf8', data: 'Hola, mundo 🌎\n' },
    { path: 'bytes.bin', mediaType: 'application/octet-stream', encoding: 'base64', data: 'AAH+/w==' },
  ],
};
async function artifactFixture() {
  const app = await fixture({ allowGuests: true });
  const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
  assert(signedIn);
  const actor: Actor = { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'test-author', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
  const store = createArtifactStore(app.db, { access: app.config.access, publishOrigin: 'https://published.example.test' });
  return { ...app, store, actor };
}
const createInput = () => ({ requestId: randomUUID(), snapshot });
const allScopes = 'openid profile artifacts:read artifacts:write artifacts:publish';
async function mcp(resource: string, token: string, method: string, params: unknown) {
  const response = await fetch(resource, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  assert.equal(response.status, 200);
  const body = await response.text();
  return JSON.parse(body.startsWith('event:') ? body.split('\n').find((line) => line.startsWith('data:'))!.slice(5) : body).result;
}

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
    const secondStore = createArtifactStore(secondConnection.db, { access: app.config.access, publishOrigin: 'https://published.example.test' });
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
    await app.db.insert(artifactShare).values({ id: randomUUID(), artifactId: (await app.db.select({ id: artifact.id }).from(artifact).where(eq(artifact.ownerId, app.ownerId)).limit(1))[0]!.id, kind: 'email', value: 'other@example.test', createdBy: app.ownerId, createdAt: new Date() }).onConflictDoNothing();
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

test('a design revision exports its canvas index as content.json and every board under files/boards', async () => {
  const app = await artifactFixture();
  try {
    const design = designSnapshot();
    const created = await app.store.create(app.actor, { requestId: randomUUID(), snapshot: design });
    assert.deepEqual(created.revision.snapshot, design);
    const exported = await app.store.export(app.actor, { artifactId: created.artifactId, revisionId: created.revision.id });
    const files = unzipSync(Buffer.from(exported.base64, 'base64'));
    assert.deepEqual(Object.keys(files), ['artifact.json', 'content.json', 'files/boards/Board-1.html', 'files/boards/Board-2.html', 'files/boards/Board-3.html']);
    assert.equal(strFromU8(files['content.json']!), design.content.text);
    for (const board of design.files) assert.equal(strFromU8(files[`files/${board.path}`]!), board.data);
    assert.deepEqual(JSON.parse(strFromU8(files['artifact.json']!)).content, { kind: 'design', path: 'content.json' });
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
    await app.db.insert(artifactShare).values({ id: randomUUID(), artifactId: (await app.db.select({ id: artifact.id }).from(artifact).where(eq(artifact.ownerId, app.ownerId)).limit(1))[0]!.id, kind: 'email', value: 'projects-other@example.test', createdBy: app.ownerId, createdAt: new Date() }).onConflictDoNothing();
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

test('slugs are strict lowercase kebab-case paths, and a .md suffix gets its own hint', () => {
  for (const slug of ['index', 'concepts/rag', 'a-b/c-d-1', 'history', 'x'.repeat(160)]) assert.equal(slugSchema.parse(slug), slug);
  for (const slug of ['', 'Concepts/rag', ' concepts', 'concepts/', '/concepts', 'a//b', 'a-', '-a', 'a--b', 'a_b', 'café', 'x'.repeat(161)]) assert.equal(slugSchema.safeParse(slug).success, false, JSON.stringify(slug));
  assert.deepEqual(slugSchema.safeParse('concepts/rag.md').error?.issues.map((issue) => issue.message), ['Remove the .md suffix: a slug names a page, not a file']);
  assert.equal(createSchema.safeParse({ ...createInput(), slug: 'Concepts' }).success, false);
  for (const locator of [{}, { artifactId: 'a', slug: 'b' }, { artifactId: 'a', project: 'P' }, { project: 'P' }]) assert.equal(readSchema.safeParse(locator).success, false, JSON.stringify(locator));
  for (const locator of [{ artifactId: 'a' }, { slug: 'index' }, { project: 'Wiki', slug: 'index', revisionId: 'r', response: 'compact' }]) assert.deepEqual(readSchema.parse(locator), locator);
});

test('slugs are unique per owner and canonical project, and read back by project and slug', async () => {
  const app = await artifactFixture();
  try {
    const rag = await app.store.create(app.actor, { ...createInput(), project: 'Mi-Wiki', slug: 'concepts/rag' });
    assert.deepEqual([rag.project, rag.slug], ['Mi-Wiki', 'concepts/rag']);
    const conflict = { code: 'slug_conflict', details: { slug: 'concepts/rag', project: 'Mi-Wiki', artifactId: rag.artifactId } };
    await assert.rejects(app.store.create(app.actor, { ...createInput(), project: 'Mi-Wiki', slug: 'concepts/rag' }), conflict);
    await assert.rejects(app.store.create(app.actor, { ...createInput(), project: 'mi-wiki', slug: 'concepts/rag' }), conflict);
    const elsewhere = await app.store.create(app.actor, { ...createInput(), project: 'Other', slug: 'concepts/rag' });
    const unfiled = await app.store.create(app.actor, { ...createInput(), slug: 'concepts/rag' });
    await assert.rejects(app.store.create(app.actor, { ...createInput(), slug: 'concepts/rag' }), { code: 'slug_conflict', details: { slug: 'concepts/rag', project: null, artifactId: unfiled.artifactId } });
    const plain = await app.store.create(app.actor, createInput());
    assert.equal(plain.slug, null);
    assert.equal((await app.store.create(app.actor, createInput())).slug, null, 'artifacts without a slug never conflict');

    assert.deepEqual(await app.store.read(app.actor, { project: 'MI-WIKI', slug: 'concepts/rag' }), rag);
    assert.equal((await app.store.read(app.actor, { project: 'Other', slug: 'concepts/rag' })).artifactId, elsewhere.artifactId);
    assert.equal((await app.store.read(app.actor, { slug: 'concepts/rag' })).artifactId, unfiled.artifactId, 'an absent project reads the unfiled namespace');
    const second = await app.store.update(app.actor, { requestId: randomUUID(), artifactId: rag.artifactId, expectedRevisionId: rag.revision.id, snapshot: { ...snapshot, files: [] } });
    assert.equal(second.slug, 'concepts/rag', 'an update keeps the slug');
    assert.equal((await app.store.read(app.actor, { project: 'Mi-Wiki', slug: 'concepts/rag', revisionId: rag.revision.id })).revision.id, rag.revision.id);
    for (const locator of [{ project: 'Mi-Wiki', slug: 'concepts/missing' }, { project: 'Missing', slug: 'concepts/rag' }, { project: 'Mi-Wiki', slug: 'index' }]) await assert.rejects(app.store.read(app.actor, locator), { code: 'not_found' });
    await assert.rejects(app.store.read({ ...app.actor, scopes: ['artifacts:write'] }, { project: 'Mi-Wiki', slug: 'concepts/rag' }), { code: 'forbidden' });

    const listed = (await app.store.list(app.actor, { limit: 100 })).items;
    assert.equal(listed.find((item) => item.artifactId === rag.artifactId)?.slug, 'concepts/rag');
    assert.equal(listed.find((item) => item.artifactId === plain.artifactId)?.slug, null);

    await assert.rejects(app.store.move(app.actor, { requestId: randomUUID(), artifactId: elsewhere.artifactId, project: 'mi-wiki' }), { ...conflict, details: { ...conflict.details, project: 'Mi-Wiki' } });
    assert.deepEqual(await app.store.move(app.actor, { requestId: randomUUID(), artifactId: rag.artifactId, project: 'Mi-Wiki' }), { artifactId: rag.artifactId, project: 'Mi-Wiki' }, 'a move to the current project keeps its own slug');
    assert.deepEqual(await app.store.move(app.actor, { requestId: randomUUID(), artifactId: elsewhere.artifactId, project: 'Third' }), { artifactId: elsewhere.artifactId, project: 'Third' });
    assert.equal((await app.store.read(app.actor, { project: 'Third', slug: 'concepts/rag' })).artifactId, elsewhere.artifactId, 'a move keeps the slug');

    const outsider = await app.auth.api.signUpEmail({ body: { name: 'Slug outsider', email: 'slugs-other@example.test', password: app.password } });
    await app.db.insert(artifactShare).values({ id: randomUUID(), artifactId: rag.artifactId, kind: 'email', value: 'slugs-other@example.test', createdBy: app.ownerId, createdAt: new Date() });
    await app.auth.api.signInEmail({ body: { email: 'slugs-other@example.test', password: app.password } });
    const [outsiderSession] = await app.db.select().from(session).where(eq(session.userId, outsider.user.id));
    const other = { ...app.actor, userId: outsider.user.id, sessionId: outsiderSession!.id };
    await assert.rejects(app.store.read(other, { project: 'Mi-Wiki', slug: 'concepts/rag' }), { code: 'not_found' });
    assert.equal((await app.store.create(other, { ...createInput(), project: 'Mi-Wiki', slug: 'concepts/rag' })).slug, 'concepts/rag', 'another owner has its own namespace');
  } finally { await app.close(); }
});

test('move sets, changes, or clears the slug and keeps the project unless it is given', async () => {
  const app = await artifactFixture();
  try {
    const page = await app.store.create(app.actor, { ...createInput(), project: 'Wiki' });
    const taken = await app.store.create(app.actor, { ...createInput(), project: 'Wiki', slug: 'index' });
    const elsewhere = await app.store.create(app.actor, { ...createInput(), project: 'Other', slug: 'concepts/rag' });
    const revisions = async () => (await app.db.select({ id: artifactRevision.id }).from(artifactRevision)).length;
    const before = await revisions();

    assert.deepEqual(await app.store.move(app.actor, { requestId: randomUUID(), artifactId: page.artifactId, slug: 'concepts/rag' }), { artifactId: page.artifactId, project: 'Wiki' }, 'a slug-only move keeps the project');
    assert.equal((await app.store.read(app.actor, { project: 'Wiki', slug: 'concepts/rag' })).artifactId, page.artifactId);
    assert.deepEqual(await app.store.move(app.actor, { requestId: randomUUID(), artifactId: page.artifactId, slug: 'concepts/retrieval' }), { artifactId: page.artifactId, project: 'Wiki' });
    assert.equal((await app.store.read(app.actor, { project: 'Wiki', slug: 'concepts/retrieval' })).artifactId, page.artifactId);
    await assert.rejects(app.store.read(app.actor, { project: 'Wiki', slug: 'concepts/rag' }), { code: 'not_found' }, 'the old slug is free after a rename');

    const unchanged = await app.db.select().from(artifact);
    await assert.rejects(app.store.move(app.actor, { requestId: randomUUID(), artifactId: page.artifactId, slug: 'index' }), { code: 'slug_conflict', details: { slug: 'index', project: 'Wiki', artifactId: taken.artifactId } });
    await assert.rejects(app.store.move(app.actor, { requestId: randomUUID(), artifactId: page.artifactId, project: 'other', slug: 'concepts/rag' }), { code: 'slug_conflict', details: { slug: 'concepts/rag', project: 'Other', artifactId: elsewhere.artifactId } });
    assert.deepEqual(await app.db.select().from(artifact), unchanged, 'a conflicting move changes nothing');

    assert.deepEqual(await app.store.move(app.actor, { requestId: randomUUID(), artifactId: taken.artifactId, project: 'Other' }), { artifactId: taken.artifactId, project: 'Other' });
    assert.equal((await app.store.read(app.actor, { project: 'Other', slug: 'index' })).artifactId, taken.artifactId, 'a move to another project keeps the slug');
    assert.deepEqual(await app.store.move(app.actor, { requestId: randomUUID(), artifactId: page.artifactId, project: null, slug: 'concepts/rag' }), { artifactId: page.artifactId, project: null });
    assert.equal((await app.store.read(app.actor, { slug: 'concepts/rag' })).artifactId, page.artifactId);
    assert.deepEqual(await app.store.move(app.actor, { requestId: randomUUID(), artifactId: page.artifactId, slug: null }), { artifactId: page.artifactId, project: null });
    assert.equal((await app.store.read(app.actor, { artifactId: page.artifactId })).slug, null);
    assert.equal(await revisions(), before, 'slug changes create no revisions');
    assert.deepEqual((await app.store.history(app.actor, { artifactId: page.artifactId })).items.map((item) => item.id), [page.revision.id]);

    for (const input of [{ requestId: 'r', artifactId: 'a' }, { requestId: 'r', artifactId: 'a', slug: 'Index' }, { requestId: 'r', artifactId: 'a', slug: 'index.md' }]) assert.equal(moveSchema.safeParse(input).success, false, JSON.stringify(input));
  } finally { await app.close(); }
});

test('move inputs without a slug keep their receipt fingerprint', async () => {
  const app = await artifactFixture();
  try {
    const created = await app.store.create(app.actor, createInput());
    const legacy = { requestId: 'legacy-move-request', artifactId: created.artifactId, project: 'Alpha' };
    assert.deepEqual(await app.store.move(app.actor, legacy), { artifactId: created.artifactId, project: 'Alpha' });
    const [row] = await app.db.select().from(artifactCommand).where(eq(artifactCommand.requestId, legacy.requestId));
    assert.equal(row!.payloadHash, await sha256(canonicalJson({ kind: 'move', input: { requestId: legacy.requestId, artifactId: created.artifactId, project: 'Alpha' } })));
  } finally { await app.close(); }
});

test('a slug changes no digest, export, or receipt fingerprint of inputs without one', async () => {
  const app = await artifactFixture();
  try {
    const plain = await app.store.create(app.actor, createInput());
    const slugged = await app.store.create(app.actor, { ...createInput(), slug: 'index' });
    assert.equal(slugged.revision.sha256, plain.revision.sha256);
    const archive = await app.store.export(app.actor, { artifactId: slugged.artifactId, revisionId: slugged.revision.id });
    const files = unzipSync(Buffer.from(archive.base64, 'base64'));
    assert.deepEqual(Object.keys(files), ['artifact.json', 'content.html', 'files/bytes.bin', 'files/notes/hello.txt']);
    assert.doesNotMatch(strFromU8(files['artifact.json']!), /slug|"index"/);

    const legacy = { requestId: 'legacy-create-request', snapshot: { metadata: { title: 'Legacy', description: '' }, content: { kind: 'text' as const, text: 'Legacy payload' }, files: [] } };
    assert.equal(await sha256(canonicalJson({ kind: 'create', input: createSchema.parse(legacy) })), 'cf00e97db6e580c4143fb3df098d97f68dfb7ba83657833203b9a2a74c53cf5b', 'the receipt hash recorded before slugs existed');
  } finally { await app.close(); }
});

test('MCP artifact tools use verified OAuth identity and individual operation scopes', async () => {
  const app = await artifactFixture();
  try {
    const tokens = await grant(app, allScopes);
    const tool = (name: string, input: unknown, token = tokens.access_token) => mcp(app.config.resource, token, 'tools/call', { name, arguments: input });
    const { tools } = await mcp(app.config.resource, tokens.access_token, 'tools/list', {});
    assert.deepEqual(tools.map((tool: { name: string }) => tool.name).sort(), ['artifacts_create', 'artifacts_export', 'artifacts_history', 'artifacts_list', 'artifacts_move', 'artifacts_publish', 'artifacts_read', 'artifacts_search', 'artifacts_share', 'artifacts_shares_list', 'artifacts_unshare', 'artifacts_update', 'projects_list', 'whoami']);
    const listed = (name: string) => tools.find((tool: { name: string }) => tool.name === name);
    const annotations = (name: string) => listed(name).annotations;
    assert.deepEqual(annotations('artifacts_move'), { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    assert.deepEqual(annotations('projects_list'), { readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    assert.deepEqual(annotations('artifacts_share'), { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true });
    assert.deepEqual(annotations('artifacts_unshare'), { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });
    assert.deepEqual(annotations('artifacts_shares_list'), { readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    assert.deepEqual(listed('artifacts_share').inputSchema.required.sort(), ['artifactId', 'email', 'requestId']);
    assert.deepEqual(listed('artifacts_share').inputSchema.properties.email, { type: 'string', format: 'email', description: 'Email address, trimmed and lowercased; at most 254 characters after trimming' });
    assert.deepEqual(listed('artifacts_unshare').inputSchema.required.sort(), ['artifactId', 'requestId', 'shareId']);
    assert.deepEqual(listed('artifacts_shares_list').inputSchema.required, ['artifactId']);
    const locator = listed('artifacts_read').inputSchema;
    assert.equal(locator.type, 'object');
    assert.equal(locator.required, undefined, 'artifactId and slug are alternatives');
    assert.deepEqual(Object.keys(locator.properties).sort(), ['artifactId', 'project', 'response', 'revisionId', 'slug']);
    assert.equal(locator.properties.slug.pattern, slugSchema.toJSONSchema().pattern);
    assert.equal(listed('artifacts_create').inputSchema.properties.slug.maxLength, 160);
    const move = listed('artifacts_move').inputSchema;
    assert.deepEqual(move.required.sort(), ['artifactId', 'requestId'], 'project and slug are each optional, and at least one is required');
    assert.deepEqual(Object.keys(move.properties).sort(), ['artifactId', 'project', 'requestId', 'slug']);
    assert.deepEqual(annotations('artifacts_search'), { readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    const search = listed('artifacts_search').inputSchema;
    assert.deepEqual(search.required, ['query']);
    assert.deepEqual(Object.keys(search.properties).sort(), ['cursor', 'limit', 'project', 'query']);
    assert.deepEqual([search.properties.query.maxLength, search.properties.limit.maximum, search.properties.limit.default], [256, 25, 10]);
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

test('MCP share tools share, list, and revoke an owned artifact, and a retry replays the original result', async () => {
  const app = await artifactFixture();
  try {
    const { access_token: token } = await grant(app, allScopes);
    const tool = (name: string, input: unknown) => mcp(app.config.resource, token, 'tools/call', { name, arguments: input });
    const { artifactId } = (await tool('artifacts_create', createInput())).structuredContent;
    const rows = () => app.db.select().from(artifactShare).where(eq(artifactShare.artifactId, artifactId)).orderBy(artifactShare.value);

    const sharing = { requestId: randomUUID(), artifactId, email: ' Ana@Example.COM ' };
    const shared = await tool('artifacts_share', sharing);
    const [ana] = await rows();
    assert.equal(shared.isError, undefined);
    assert.deepEqual(shared.structuredContent, { shareId: ana!.id, artifactId, kind: 'email', value: 'ana@example.com', createdAt: ana!.createdAt.toISOString() });
    assert.deepEqual(JSON.parse(shared.content[0].text), shared.structuredContent);
    assert.deepEqual(await tool('artifacts_share', sharing), shared);
    assert.equal((await rows()).length, 1);
    const conflict = await tool('artifacts_share', { ...sharing, email: 'bob@example.com' });
    assert.equal(conflict.isError, true);
    assert.deepEqual(conflict.structuredContent, { error: 'request_conflict', message: 'Request ID already used with different arguments' });

    await tool('artifacts_share', { requestId: randomUUID(), artifactId, email: 'Cara@Example.com' });
    await tool('artifacts_share', { requestId: randomUUID(), artifactId, email: 'bob@example.com' });
    const listed = await tool('artifacts_shares_list', { artifactId });
    assert.deepEqual(listed.structuredContent.items.map((item: { value: string }) => item.value), ['ana@example.com', 'bob@example.com', 'cara@example.com']);
    assert.deepEqual(listed.structuredContent, { items: (await rows()).map((row) => ({ shareId: row.id, artifactId, kind: 'email', value: row.value, createdAt: row.createdAt.toISOString() })) });

    const unsharing = { requestId: randomUUID(), artifactId, shareId: ana!.id };
    const unshared = await tool('artifacts_unshare', unsharing);
    assert.equal(unshared.isError, undefined);
    assert.deepEqual(unshared.structuredContent, { artifactId, shareId: ana!.id });
    assert.deepEqual(await tool('artifacts_unshare', unsharing), unshared);
    const gone = await tool('artifacts_unshare', { ...unsharing, requestId: randomUUID() });
    assert.equal(gone.isError, true);
    assert.deepEqual(gone.structuredContent, { error: 'not_found', message: 'Share not found' });
    assert.deepEqual((await tool('artifacts_shares_list', { artifactId })).structuredContent.items.map((item: { value: string }) => item.value), ['bob@example.com', 'cara@example.com']);
  } finally { await app.close(); }
});

test('MCP share tools require artifacts:publish and ownership, and reject an invalid email without writing', async () => {
  const app = await artifactFixture();
  try {
    const owner = await grant(app, allScopes);
    const tool = (token: string, name: string, input: unknown) => mcp(app.config.resource, token, 'tools/call', { name, arguments: input });
    const { artifactId } = (await tool(owner.access_token, 'artifacts_create', createInput())).structuredContent;
    const share = (await tool(owner.access_token, 'artifacts_share', { requestId: randomUUID(), artifactId, email: 'guest@example.test' })).structuredContent;
    const values = async () => (await app.db.select({ value: artifactShare.value }).from(artifactShare).where(eq(artifactShare.artifactId, artifactId))).map((row) => row.value);
    const calls = [
      ['artifacts_share', { requestId: randomUUID(), artifactId, email: 'bob@example.com' }],
      ['artifacts_unshare', { requestId: randomUUID(), artifactId, shareId: share.shareId }],
      ['artifacts_shares_list', { artifactId }],
    ] as const;

    const writer = await grant(app, 'openid profile artifacts:read artifacts:write');
    for (const [name, input] of calls) {
      const denied = await tool(writer.access_token, name, input);
      assert.equal(denied.isError, true, name);
      assert.deepEqual(denied.structuredContent, { error: 'forbidden', message: 'The artifacts:publish scope is required', requiredScope: 'artifacts:publish' }, name);
    }

    const signedUp = await app.auth.api.signUpEmail({ body: { name: 'Shared guest', email: 'guest@example.test', password: app.password } });
    await app.db.update(user).set({ emailVerified: true }).where(eq(user.id, signedUp.user.id));
    await app.db.insert(artifactShare).values({ id: randomUUID(), artifactId: (await app.db.select({ id: artifact.id }).from(artifact).where(eq(artifact.ownerId, app.ownerId)).limit(1))[0]!.id, kind: 'email', value: 'guest@example.test', createdBy: app.ownerId, createdAt: new Date() }).onConflictDoNothing();
    const signIn = await app.auth.api.signInEmail({ body: { email: 'guest@example.test', password: app.password }, returnHeaders: true });
    const guest = await grant({ ...app, cookie: signIn.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ') }, allScopes);
    for (const [name, input] of calls) {
      const denied = await tool(guest.access_token, name, input);
      assert.equal(denied.isError, true, name);
      assert.deepEqual(denied.structuredContent, { error: 'not_found', message: 'Artifact not found' }, name);
    }

    const invalid = await tool(owner.access_token, 'artifacts_share', { requestId: randomUUID(), artifactId, email: 'not-an-email' });
    assert.equal(invalid.isError, true);
    assert.equal(invalid.structuredContent, undefined);
    assert.match(invalid.content[0].text, /^Input validation error: Invalid arguments for tool artifacts_share/);
    assert.deepEqual(await values(), ['guest@example.test']);
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

const page = (title: string, text: string, kind: Snapshot['content']['kind'] = 'markdown', description = ''): Snapshot => ({ metadata: { title, description }, content: { kind, text }, files: [] });

test('search finds owned Markdown and text heads without accents and follows update, move, and delete', async () => {
  const app = await artifactFixture();
  try {
    const ids = async (query: string, project?: string) => (await app.store.search(app.actor, { query, project })).items.map((item) => item.artifactId);
    const envigado = await app.store.create(app.actor, { requestId: randomUUID(), snapshot: page('Viaje', 'Una tarde en Envigado con amigos.'), project: 'Wiki', slug: 'viajes/envigado' });
    const accented = await app.store.create(app.actor, { requestId: randomUUID(), snapshot: page('Búsqueda', 'Notas sueltas.', 'text') });
    const described = await app.store.create(app.actor, { requestId: randomUUID(), snapshot: page('Plain', 'Nothing here.', 'markdown', 'Described as zanahoria') });

    const [hit, ...rest] = (await app.store.search(app.actor, { query: 'envigado' })).items;
    assert.deepEqual(rest, []);
    assert.deepEqual({ ...hit, rank: typeof hit!.rank }, { artifactId: envigado.artifactId, project: 'Wiki', slug: 'viajes/envigado', title: 'Viaje', snippet: 'Una tarde en **Envigado** con amigos.', rank: 'number' });
    assert.deepEqual(await ids('busqueda'), [accented.artifactId], 'the title matches without its accent');
    assert.deepEqual(await ids('zanahoria'), [described.artifactId], 'the description is indexed');

    const updated = await app.store.update(app.actor, { requestId: randomUUID(), artifactId: envigado.artifactId, expectedRevisionId: envigado.revision.id, snapshot: page('Viaje', 'Una tarde en Sabaneta.') });
    assert.deepEqual(await ids('envigado'), [], 'removed text no longer finds the page');
    assert.deepEqual(await ids('sabaneta'), [envigado.artifactId], 'new text finds the page');
    await app.store.update(app.actor, { requestId: randomUUID(), artifactId: envigado.artifactId, expectedRevisionId: updated.revision.id, snapshot: page('Viaje', '<p class="sabaneta">Rionegro</p>', 'html') });
    assert.deepEqual(await ids('sabaneta'), [], 'an update to HTML replaces the Markdown body');
    assert.deepEqual(await ids('rionegro'), [envigado.artifactId], 'an update to HTML indexes its visible text');
    await app.store.update(app.actor, { requestId: randomUUID(), artifactId: accented.artifactId, expectedRevisionId: accented.revision.id, snapshot: page('Búsqueda', 'Notas sueltas.', 'text') });
    assert.equal((await app.store.search(app.actor, { query: 'busqueda' })).items.length, 1, 'an update replaces the row instead of adding one');

    await app.store.move(app.actor, { requestId: randomUUID(), artifactId: accented.artifactId, project: 'Otro', slug: 'notas' });
    assert.deepEqual((await app.store.search(app.actor, { query: 'busqueda' })).items.map(({ project, slug }) => ({ project, slug })), [{ project: 'Otro', slug: 'notas' }]);
    assert.deepEqual(await ids('busqueda', 'otro'), [accented.artifactId], 'the project filter uses the canonical spelling');
    assert.deepEqual(await ids('busqueda', 'Wiki'), []);
    assert.deepEqual(await ids('busqueda', 'Missing'), []);

    const current = await app.store.read(app.actor, { artifactId: accented.artifactId });
    await app.store.delete(app.actor, { requestId: randomUUID(), artifactId: accented.artifactId, expectedRevisionId: current.headRevisionId, expectedPublicationVersion: 0 });
    assert.deepEqual(await ids('busqueda'), []);
    assert.deepEqual((await app.client.execute({ sql: 'SELECT count(*) AS total FROM artifact_search WHERE artifact_id = ?', args: [accented.artifactId] })).rows[0]!.total, 0, 'the delete trigger removes the row');
  } finally { await app.close(); }
});

test('search finds HTML by visible text only and design by metadata only, and never reads attachments', async () => {
  const app = await artifactFixture();
  try {
    const ids = async (query: string) => (await app.store.search(app.actor, { query })).items.map((item) => item.artifactId);
    const html = await app.store.create(app.actor, { requestId: randomUUID(), snapshot: page('Paseo', '<html><head><title>x</title><style>.medellin{color:red}</style><script>var sabaneta = 1</script></head><body><p class="itagui" data-place="bello">Una tarde en <b>Envigado</b> &amp; Rionegro</p><p>Caldas</p></body></html>', 'html') });
    for (const query of ['envigado', 'rionegro', 'caldas']) assert.deepEqual(await ids(query), [html.artifactId], query);
    for (const query of ['medellin', 'sabaneta', 'itagui', 'bello', 'class', 'script', 'body', 'amp']) assert.deepEqual(await ids(query), [], query);
    const [hit] = (await app.store.search(app.actor, { query: 'caldas' })).items;
    assert(!hit!.snippet.includes('<'), hit!.snippet);
    assert.match(hit!.snippet, /Envigado & Rionegro \*\*Caldas\*\*/);

    const design = await app.store.create(app.actor, { requestId: randomUUID(), snapshot: { ...designSnapshot(), metadata: { title: 'Tablero Guatape', description: 'Bocetos de Jardin' } } });
    assert.deepEqual(await ids('guatape'), [design.artifactId], 'the design title is indexed');
    assert.deepEqual(await ids('jardin'), [design.artifactId], 'the design description is indexed');
    for (const query of ['board', 'boards', 'order']) assert.deepEqual(await ids(query), [], `the canvas word ${query} is not indexed`);

    const attachment = { path: 'notes/extra.txt', mediaType: 'text/plain', encoding: 'utf8', data: 'Solo en Copacabana' } as const;
    await app.store.create(app.actor, { requestId: randomUUID(), snapshot: { ...page('Adjunto', 'Texto propio'), files: [attachment] } });
    await app.store.create(app.actor, { requestId: randomUUID(), snapshot: { ...page('Adjunto HTML', '<p>Texto propio</p>', 'html'), files: [attachment] } });
    assert.deepEqual(await ids('copacabana'), [], 'attachments are not indexed');
    assert.equal((await ids('propio')).length, 2);

    await app.store.update(app.actor, { requestId: randomUUID(), artifactId: html.artifactId, expectedRevisionId: html.revision.id, snapshot: { ...designSnapshot(), metadata: { title: 'Paseo dibujado', description: '' } } });
    assert.deepEqual(await ids('caldas'), [], 'an update to design drops the HTML text');
    assert.deepEqual(await ids('dibujado'), [html.artifactId], 'an update to design indexes the new title');
  } finally { await app.close(); }
});

test('search requires every term, treats operators as text, orders by rank then ID, and pages by cursor', async () => {
  const app = await artifactFixture();
  try {
    const both = await app.store.create(app.actor, { requestId: randomUUID(), snapshot: page('Both', 'alpha beta') });
    await app.store.create(app.actor, { requestId: randomUUID(), snapshot: page('Alpha only', 'alpha gamma') });
    assert.deepEqual((await app.store.search(app.actor, { query: '  alpha   beta ' })).items.map((item) => item.artifactId), [both.artifactId]);
    for (const query of ['"foo" OR NEAR(', '(', '"', '""', 'title:alpha', 'alph*', 'alpha NOT beta']) assert.deepEqual((await app.store.search(app.actor, { query })).items, [], query);
    const near = await app.store.create(app.actor, { requestId: randomUUID(), snapshot: page('Near', 'near foo or') });
    assert.deepEqual((await app.store.search(app.actor, { query: '"foo" OR NEAR(' })).items.map((item) => item.artifactId), [near.artifactId], 'operator words match as plain terms');

    for (let index = 0; index < 4; index++) await app.store.create(app.actor, { requestId: randomUUID(), snapshot: page(`Tie ${index}`, 'kiwi') });
    const strong = await app.store.create(app.actor, { requestId: randomUUID(), snapshot: page('Kiwi', 'kiwi kiwi kiwi kiwi') });
    const all = (await app.store.search(app.actor, { query: 'kiwi', limit: 25 })).items;
    assert.equal(all.length, 5);
    assert.equal(all[0]!.artifactId, strong.artifactId, 'the strongest match ranks first');
    assert.deepEqual(all.slice(1).map((item) => item.artifactId), all.slice(1).map((item) => item.artifactId).sort(), 'equal ranks fall back to artifact ID');
    assert(all.every((item, index) => index === 0 || all[index - 1]!.rank <= item.rank), 'rank ascends');

    const first = await app.store.search(app.actor, { query: 'kiwi', limit: 2 });
    assert.equal(first.nextCursor, '2');
    const second = await app.store.search(app.actor, { query: 'kiwi', limit: 2, cursor: first.nextCursor! });
    const third = await app.store.search(app.actor, { query: 'kiwi', limit: 2, cursor: second.nextCursor! });
    assert.equal(third.nextCursor, null);
    assert.deepEqual([...first.items, ...second.items, ...third.items], all);
    assert.equal((await app.store.search(app.actor, { query: 'kiwi' })).items.length, 5, 'limit defaults to 10');

    assert.deepEqual(searchSchema.parse({ query: '  kiwi ' }), { query: 'kiwi', limit: 10 });
    for (const input of [{ query: '' }, { query: '   ' }, { query: 'x'.repeat(257) }, { query: 'kiwi', limit: 0 }, { query: 'kiwi', limit: 26 }, { query: 'kiwi', cursor: 'abc' }, { query: 'kiwi', cursor: '-1' }, { query: 'kiwi', cursor: '1234567' }, { query: 'kiwi', extra: true }]) {
      assert.equal(searchSchema.safeParse(input).success, false, JSON.stringify(input));
    }
  } finally { await app.close(); }
});

test('search returns only the caller\'s owned artifacts and authorizes artifacts:read and the live session', async () => {
  const app = await artifactFixture();
  try {
    const mine = await app.store.create(app.actor, { requestId: randomUUID(), snapshot: page('Mine', 'mango') });
    const outsider = await app.auth.api.signUpEmail({ body: { name: 'Search outsider', email: 'search-other@example.test', password: app.password } });
    await app.db.insert(artifactShare).values({ id: randomUUID(), artifactId: mine.artifactId, kind: 'email', value: 'search-other@example.test', createdBy: app.ownerId, createdAt: new Date() });
    await app.auth.api.signInEmail({ body: { email: 'search-other@example.test', password: app.password } });
    const [outsiderSession] = await app.db.select().from(session).where(eq(session.userId, outsider.user.id));
    const other = { ...app.actor, userId: outsider.user.id, sessionId: outsiderSession!.id };
    const theirs = await app.store.create(other, { requestId: randomUUID(), snapshot: page('Theirs', 'mango') });
    await app.store.publish(app.actor, { requestId: randomUUID(), artifactId: mine.artifactId, revisionId: mine.revision.id, expectedPublicationVersion: 0 });
    assert.deepEqual((await app.store.search(app.actor, { query: 'mango' })).items.map((item) => item.artifactId), [mine.artifactId]);
    assert.deepEqual((await app.store.search(other, { query: 'mango' })).items.map((item) => item.artifactId), [theirs.artifactId], 'a shared artifact never appears');

    await assert.rejects(app.store.search({ ...app.actor, scopes: ['artifacts:write'] }, { query: 'mango' }), { code: 'forbidden', details: { requiredScope: 'artifacts:read' } });
    await app.db.update(session).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(session.id, app.actor.sessionId));
    await assert.rejects(app.store.search(app.actor, { query: 'mango' }), { code: 'forbidden' });
  } finally { await app.close(); }
});
