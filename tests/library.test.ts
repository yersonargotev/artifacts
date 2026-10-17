import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { createArtifactStore, libraryQuerySchema, listSchema, type Actor, type Snapshot } from '../packages/artifacts/src/index.ts';
import { session } from '../packages/db/src/schema.ts';
import { fixture } from './helpers.ts';

const snapshot = (title: string): Snapshot => ({ metadata: { title, description: '' }, content: { kind: 'text', text: title }, files: [] });

test('library search and publication filters query all owner artifacts before stable cursor pagination', async () => {
  const app = await fixture();
  try {
    const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
    assert(signedIn);
    const actor: Actor = { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'library-test', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
    const store = createArtifactStore(app.db, { publishOrigin: 'https://published.example.test' });
    const created = [];
    for (let index = 0; index < 31; index++) created.push(await store.create(actor, { requestId: randomUUID(), snapshot: snapshot(`Report ${index}`) }));
    created.sort((left, right) => left.artifactId.localeCompare(right.artifactId));
    const target = created[26];
    await store.publish(actor, { requestId: randomUUID(), artifactId: target.artifactId, revisionId: target.revision.id, expectedPublicationVersion: 0 });
    const updated = await store.update(actor, { requestId: randomUUID(), artifactId: target.artifactId, expectedRevisionId: target.revision.id, snapshot: snapshot('Report Café_100% 東京') });
    const current = created[27];
    await store.publish(actor, { requestId: randomUUID(), artifactId: current.artifactId, revisionId: current.revision.id, expectedPublicationVersion: 0 });

    const page = await store.queryLibrary(actor, {});
    assert.equal(page.items.length, 25);
    assert.equal(page.items.some((item) => item.artifactId === target.artifactId), false);
    assert.deepEqual(page.counts, { all: 31, published: 2, unpublished: 29, pending: 1 });
    const second = await store.queryLibrary(actor, { cursor: page.nextCursor! });
    assert.deepEqual([...page.items, ...second.items].map((item) => item.artifactId), created.map((item) => item.artifactId));
    assert.equal(second.nextCursor, null);
    assert.deepEqual(second.counts, page.counts);

    for (const q of ['café', '東京', '%', '_', target.artifactId, '  Report Café_100% 東京  ']) {
      const found = await store.queryLibrary(actor, { q });
      assert.deepEqual(found.items.map((item) => item.artifactId), [target.artifactId], q);
      assert.deepEqual(found.counts, { all: 1, published: 1, unpublished: 0, pending: 1 });
      assert.equal(found.items[0].headRevisionId, updated.revision.id);
      assert.equal(found.items[0].publication?.revisionId, target.revision.id);
    }

    const pending = await store.queryLibrary(actor, { q: 'report', status: 'pending' });
    assert.deepEqual(pending.items.map((item) => item.artifactId), [target.artifactId]);
    const published = await store.queryLibrary(actor, { status: 'published' });
    assert.deepEqual(published.items.map((item) => item.artifactId), [target.artifactId, current.artifactId]);
    const drafts = await store.queryLibrary(actor, { q: 'report', status: 'unpublished' });
    assert.equal(drafts.items.length, 25);
    const moreDrafts = await store.queryLibrary(actor, { q: 'report', status: 'unpublished', cursor: drafts.nextCursor! });
    assert.equal(moreDrafts.items.length, 4);
    assert.equal(moreDrafts.nextCursor, null);
    assert.equal(new Set([...drafts.items, ...moreDrafts.items].map((item) => item.artifactId)).size, 29);
    assert([...drafts.items, ...moreDrafts.items].every((item) => item.publication === null));
    const missing = await store.queryLibrary(actor, { q: 'no matching title', status: 'published' });
    assert.deepEqual(missing, { items: [], nextCursor: null, counts: { all: 0, published: 0, unpublished: 0, pending: 0 } });

    const outsider = await app.auth.api.signUpEmail({ body: { name: 'Other owner', email: 'library-other@example.test', password: app.password } });
    await app.auth.api.signInEmail({ body: { email: 'library-other@example.test', password: app.password } });
    const [otherSession] = await app.db.select().from(session).where(eq(session.userId, outsider.user.id));
    const otherActor = { ...actor, userId: outsider.user.id, sessionId: otherSession.id };
    assert.deepEqual(await store.queryLibrary(otherActor, { q: 'report' }), { items: [], nextCursor: null, counts: { all: 0, published: 0, unpublished: 0, pending: 0 } });
    await assert.rejects(store.queryLibrary({ ...actor, scopes: [] }), { code: 'forbidden' });
    await app.db.delete(session).where(eq(session.id, actor.sessionId));
    await assert.rejects(store.queryLibrary(actor), { code: 'forbidden' });
  } finally { await app.close(); }
});

test('library project filter scopes search, publication filters, and counts', async () => {
  const app = await fixture();
  try {
    const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
    assert(signedIn);
    const actor: Actor = { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'library-test', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
    const store = createArtifactStore(app.db, { publishOrigin: 'https://published.example.test' });
    const draft = await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Alpha draft'), project: 'Alpha' });
    const shipped = await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Alpha shipped'), project: 'alpha' });
    await store.publish(actor, { requestId: randomUUID(), artifactId: shipped.artifactId, revisionId: shipped.revision.id, expectedPublicationVersion: 0 });
    await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Beta shipped'), project: 'Beta' });
    await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Loose shipped') });
    const ids = (page: { items: { artifactId: string }[] }) => page.items.map((item) => item.artifactId).sort();

    const alpha = await store.queryLibrary(actor, { project: 'ALPHA' });
    assert.deepEqual(ids(alpha), [draft.artifactId, shipped.artifactId].sort());
    assert.deepEqual(alpha.counts, { all: 2, published: 1, unpublished: 1, pending: 0 });
    assert(alpha.items.every((item) => item.project === 'Alpha'));
    const searched = await store.queryLibrary(actor, { project: 'Alpha', q: 'shipped' });
    assert.deepEqual(ids(searched), [shipped.artifactId]);
    assert.deepEqual(searched.counts, { all: 1, published: 1, unpublished: 0, pending: 0 });
    assert.deepEqual(ids(await store.queryLibrary(actor, { project: 'Alpha', status: 'unpublished' })), [draft.artifactId]);
    assert.deepEqual((await store.queryLibrary(actor, {})).counts, { all: 4, published: 1, unpublished: 3, pending: 0 });
    assert.deepEqual(await store.queryLibrary(actor, { project: 'Gamma' }), { items: [], nextCursor: null, counts: { all: 0, published: 0, unpublished: 0, pending: 0 } });
  } finally { await app.close(); }
});

test('dashboard query validation leaves the public MCP list contract unchanged', () => {
  assert.deepEqual(libraryQuerySchema.parse({}), { q: '', status: 'all' });
  assert.deepEqual(libraryQuerySchema.parse({ project: ' Alpha ' }), { q: '', status: 'all', project: 'Alpha' });
  assert.deepEqual(listSchema.parse({ project: 'Alpha' }), { limit: 25, project: 'Alpha' });
  assert.equal(libraryQuerySchema.safeParse({ status: 'unknown' }).success, false);
  assert.equal(libraryQuerySchema.safeParse({ q: 'a'.repeat(257) }).success, false);
  assert.deepEqual(listSchema.parse({}), { limit: 25 });
  assert.equal(listSchema.safeParse({ q: 'title' }).success, false);
  assert.equal(listSchema.safeParse({ status: 'published' }).success, false);
});
