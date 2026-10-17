import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { createArtifactStore, type Actor, type Snapshot } from '../packages/artifacts/src/index.ts';
import { createPanel, panelLibraryQuerySchema } from '../packages/artifacts/src/panel/index.ts';
import { readLibraryUrl, libraryHref, scopeHref } from '../apps/dashboard/src/urls.ts';
import { session } from '../packages/db/src/schema.ts';
import { fixture } from './helpers.ts';

const snapshot = (title: string): Snapshot => ({ metadata: { title, description: `Description for ${title}` }, content: { kind: 'text', text: title }, files: [] });
const options = { publishOrigin: 'https://published.example.test/nested' };
const actorFor = async (app: Awaited<ReturnType<typeof fixture>>): Promise<Actor> => {
  const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
  assert(signedIn);
  return { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'panel-reader-test', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
};

test('panel snapshot resolves every scope, partitions status counts, and retains published revision references', async () => {
  const app = await fixture();
  try {
    const actor = await actorFor(app);
    const store = createArtifactStore(app.db, options);
    const panel = createPanel(app.db, options);
    const draft = await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Alpha draft'), project: 'Álpha' });
    const pending = await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Alpha pending'), project: 'álpha' });
    await store.publish(actor, { requestId: randomUUID(), artifactId: pending.artifactId, revisionId: pending.revision.id, expectedPublicationVersion: 0 });
    const updated = await store.update(actor, { requestId: randomUUID(), artifactId: pending.artifactId, expectedRevisionId: pending.revision.id, snapshot: snapshot('Alpha revised') });
    const published = await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Beta published'), project: 'Beta' });
    await store.publish(actor, { requestId: randomUUID(), artifactId: published.artifactId, revisionId: published.revision.id, expectedPublicationVersion: 0 });
    const loose = await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Loose draft') });
    const all = await panel.library(actor);
    assert.deepEqual(all.page.counts, { all: 4, published: 1, unpublished: 2, pending: 1 });
    assert.deepEqual(all.workspace.total, { count: 4, published: 2, pending: 1 });
    assert.deepEqual(all.workspace.unfiled, { count: 1, published: 0, pending: 0 });
    assert.deepEqual(all.workspace.projects.map(({ name, count, published, pending }) => ({ name, count, published, pending })), [{ name: 'Álpha', count: 2, published: 1, pending: 1 }, { name: 'Beta', count: 1, published: 1, pending: 0 }]);
    const card = all.page.cards.find(({ artifactId }) => artifactId === pending.artifactId)!;
    assert.deepEqual(card, { artifactId: pending.artifactId, title: 'Alpha revised', description: 'Description for Alpha revised', kind: 'text', project: 'Álpha', head: { revisionId: updated.revision.id, sequence: 2, createdAt: new Date(updated.revision.createdAt) }, publication: { state: 'pending', url: `https://published.example.test/a/${pending.artifactId}`, version: 1, revision: { revisionId: pending.revision.id, sequence: 1, createdAt: new Date(pending.revision.createdAt) } } });
    const alpha = await panel.library(actor, { scope: { kind: 'project', name: 'ÁLPHA' } });
    assert.deepEqual(alpha.page.scope, { kind: 'project', project: all.workspace.projects[0] });
    assert.deepEqual(alpha.page.counts, { all: 2, published: 0, unpublished: 1, pending: 1 });
    assert.deepEqual(alpha.page.cards.map(({ artifactId }) => artifactId).sort(), [draft.artifactId, pending.artifactId].sort());
    for (const [status, ids] of [['published', [published.artifactId]], ['pending', [pending.artifactId]], ['unpublished', [draft.artifactId, loose.artifactId]]] as const) {
      const filtered = await panel.library(actor, { status });
      assert.deepEqual(filtered.page.cards.map(({ artifactId }) => artifactId).sort(), [...ids].sort());
      assert.deepEqual(filtered.page.counts, all.page.counts);
      assert.deepEqual(filtered.workspace, all.workspace);
    }
    const unfiled = await panel.library(actor, { scope: { kind: 'unfiled' } });
    assert.deepEqual(unfiled.page.scope, { kind: 'unfiled', tally: { count: 1, published: 0, pending: 0 } });
    assert.deepEqual(unfiled.page.cards.map(({ artifactId }) => artifactId), [loose.artifactId]);
    assert.deepEqual(unfiled.page.counts, { all: 1, published: 0, unpublished: 1, pending: 0 });
    const vanished = await panel.library(actor, { scope: { kind: 'project', name: 'Gone' }, q: 'draft', status: 'published' });
    assert.deepEqual(vanished, { workspace: all.workspace, page: { scope: { kind: 'vanishedProject', name: 'Gone' }, q: 'draft', status: 'published', cards: [], counts: { all: 0, published: 0, unpublished: 0, pending: 0 }, next: null, continued: false } });
    await store.move(actor, { requestId: randomUUID(), artifactId: draft.artifactId, project: null });
    const removed = await panel.library(actor, { scope: { kind: 'project', name: 'Álpha' } });
    assert.deepEqual(removed.page.counts, { all: 1, published: 0, unpublished: 0, pending: 1 });
  } finally { await app.close(); }
});

test('recent cursor orders equal-millisecond heads by descending ID without gaps and ignores move or publish time', async (t) => {
  const app = await fixture();
  try {
    const actor = await actorFor(app);
    const store = createArtifactStore(app.db, options);
    const panel = createPanel(app.db, options);
    const timestamp = Date.now();
    t.mock.timers.enable({ apis: ['Date'], now: timestamp });
    const created = [];
    for (let index = 0; index < 30; index++) created.push(await store.create(actor, { requestId: randomUUID(), snapshot: snapshot(`Tied ${index}`) }));
    const ordered = created.map(({ artifactId }) => artifactId).sort().reverse();
    const first = await panel.library(actor);
    assert.deepEqual(first.page.cards.map(({ artifactId }) => artifactId), ordered.slice(0, 25));
    assert.equal(first.page.next, `${timestamp}:${ordered[24]}`);
    const second = await panel.library(actor, { cursor: first.page.next! });
    assert.deepEqual(second.page.cards.map(({ artifactId }) => artifactId), ordered.slice(25));
    assert.deepEqual(second.page.counts, { all: 30, published: 0, unpublished: 30, pending: 0 });
    assert.equal(second.page.continued, true);
    assert.equal(second.page.next, null);
    const target = created.find(({ artifactId }) => artifactId === ordered[29])!;
    t.mock.timers.setTime(timestamp + 1_000);
    await store.publish(actor, { requestId: randomUUID(), artifactId: target.artifactId, revisionId: target.revision.id, expectedPublicationVersion: 0 });
    await store.move(actor, { requestId: randomUUID(), artifactId: target.artifactId, project: 'Moved' });
    assert.deepEqual((await panel.library(actor)).page.cards.map(({ artifactId }) => artifactId), ordered.slice(0, 25));
    await store.update(actor, { requestId: randomUUID(), artifactId: target.artifactId, expectedRevisionId: target.revision.id, snapshot: snapshot('Most recent') });
    assert.deepEqual((await panel.library(actor)).page.cards.map(({ artifactId }) => artifactId), [target.artifactId, ...ordered.slice(0, 24)]);
    const exact = await panel.library(actor, { q: 'Tied', cursor: `${timestamp}:${ordered[3]}` });
    assert.equal(exact.page.cards.length, 25);
    assert.equal(exact.page.next, null);
    const empty = await panel.library(actor, { cursor: `${timestamp}:0` });
    assert.deepEqual(empty.page.cards, []);
    assert.equal(empty.page.next, null);
    assert.deepEqual(empty.page.counts, { all: 30, published: 0, unpublished: 29, pending: 1 });
  } finally { t.mock.timers.reset(); await app.close(); }
});

test('workspace and pages isolate owners even for empty searches, status filters, and same-name projects', async () => {
  const app = await fixture();
  try {
    const actor = await actorFor(app);
    const store = createArtifactStore(app.db, options);
    const panel = createPanel(app.db, options);
    await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Private owner title'), project: 'Alpha' });
    const outsider = await app.auth.api.signUpEmail({ body: { name: 'Other owner', email: 'panel-other@example.test', password: app.password } });
    await app.auth.api.signInEmail({ body: { email: 'panel-other@example.test', password: app.password } });
    const [otherSession] = await app.db.select().from(session).where(eq(session.userId, outsider.user.id));
    const other = { ...actor, userId: outsider.user.id, sessionId: otherSession.id };
    await store.create(other, { requestId: randomUUID(), snapshot: snapshot('Other title'), project: 'alpha' });
    await store.create(other, { requestId: randomUUID(), snapshot: snapshot('Other loose') });
    const own = await panel.library(actor);
    for (const query of [{ q: 'Other' }, { status: 'published' as const }, { scope: { kind: 'unfiled' as const } }]) {
      const result = await panel.library(actor, query);
      assert.deepEqual(result.workspace, own.workspace);
      assert.deepEqual(result.page.cards, []);
      assert.equal(result.workspace.total.count, 1);
      assert.equal(result.workspace.projects[0].name, 'Alpha');
    }
    const otherPage = await panel.library(other, { scope: { kind: 'project', name: 'ALPHA' } });
    assert.deepEqual(otherPage.page.cards.map(({ title }) => title), ['Other title']);
    assert.deepEqual(otherPage.page.counts, { all: 1, published: 0, unpublished: 1, pending: 0 });
    assert.deepEqual(otherPage.workspace.total, { count: 2, published: 0, pending: 0 });
    assert.equal(otherPage.workspace.projects[0].name, 'alpha');
    await assert.rejects(panel.library({ ...actor, scopes: [] }), { code: 'forbidden' });
    await assert.rejects(panel.library({ ...actor, sessionId: other.sessionId }), { code: 'forbidden' });
    await app.db.delete(session).where(eq(session.id, actor.sessionId));
    await assert.rejects(panel.library(actor), { code: 'forbidden' });
  } finally { await app.close(); }
});

test('panel URLs validate explicit scopes and cursors and reset cursors when filters change', () => {
  const read = (query: string) => readLibraryUrl(new URL(`https://panel.example.test/${query}`));
  assert.deepEqual(read('?unfiled=1&q=%20draft%20&status=unknown'), { scope: { kind: 'unfiled' }, q: 'draft', status: 'all' });
  assert.deepEqual(read('?project=%20Beta%20'), { scope: { kind: 'project', name: 'Beta' }, q: '', status: 'all' });
  assert.equal(scopeHref({ kind: 'unfiled' }), '/?unfiled=1');
  const query = { scope: { kind: 'unfiled' as const }, q: 'draft', status: 'pending' as const, cursor: '1:abc' };
  assert.equal(libraryHref(query), '/?unfiled=1&q=draft&status=pending');
  assert.equal(libraryHref(query, { status: 'published' }), '/?unfiled=1&q=draft&status=published');
  assert.equal(libraryHref(query, { cursor: '2:def' }), '/?unfiled=1&q=draft&status=pending&cursor=2%3Adef');
  for (const value of ['?project=Beta&unfiled=1', '?project=', '?unfiled=0', '?q=' + 'x'.repeat(257), '?cursor=1', '?cursor=-1:abc', '?cursor=01:abc', '?cursor=1.5:abc', '?cursor=8640000000000001:abc', '?cursor=1:']) assert.throws(() => read(value), { name: 'ZodError' }, value);
  assert.deepEqual(panelLibraryQuerySchema.parse({}), { scope: { kind: 'all' }, status: 'all', q: '' });
  assert.equal(panelLibraryQuerySchema.safeParse({ status: 'unknown' }).success, false);
});
