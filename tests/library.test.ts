import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createArtifactStore, libraryQuerySchema, listSchema, type Actor, type Snapshot } from '../packages/artifacts/src/index.ts';
import { createPanel } from '../packages/artifacts/src/panel/index.ts';
import { fixture } from './helpers.ts';

const snapshot = (title: string): Snapshot => ({ metadata: { title, description: '' }, content: { kind: 'text', text: title }, files: [] });

test('panel library searches the whole scope literally before status filtering and cursor pagination', async () => {
  const app = await fixture();
  try {
    const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
    assert(signedIn);
    const actor: Actor = { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'library-test', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
    const options = { publishOrigin: 'https://published.example.test' };
    const store = createArtifactStore(app.db, options);
    const panel = createPanel(app.db, options);
    const created = [];
    for (let index = 0; index < 31; index++) created.push(await store.create(actor, { requestId: randomUUID(), snapshot: snapshot(`Report ${index}`), project: 'Alpha' }));
    const target = created[0];
    await store.publish(actor, { requestId: randomUUID(), artifactId: target.artifactId, revisionId: target.revision.id, expectedPublicationVersion: 0 });
    const updated = await store.update(actor, { requestId: randomUUID(), artifactId: target.artifactId, expectedRevisionId: target.revision.id, snapshot: snapshot('Report Café_100% 東京') });
    const current = created[1];
    await store.publish(actor, { requestId: randomUUID(), artifactId: current.artifactId, revisionId: current.revision.id, expectedPublicationVersion: 0 });
    await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Report Café_100% 東京'), project: 'Beta' });
    await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Report Café_100% 東京') });
    const query = { scope: { kind: 'project' as const, name: 'ALPHA' } };
    const { page } = await panel.library(actor, query);
    assert.equal(page.cards.length, 25);
    assert.equal(page.cards[0].artifactId, target.artifactId);
    assert.deepEqual(page.counts, { all: 31, published: 1, unpublished: 29, pending: 1 });
    const second = (await panel.library(actor, { ...query, cursor: page.next! })).page;
    assert.equal(second.next, null);
    assert.deepEqual(second.counts, page.counts);
    assert.deepEqual([...page.cards, ...second.cards].map(({ artifactId }) => artifactId).sort(), created.map(({ artifactId }) => artifactId).sort());
    for (const q of ['café', '東京', '%', '_', target.artifactId, '  Report Café_100% 東京  ']) {
      const found = (await panel.library(actor, { ...query, q })).page;
      assert.deepEqual(found.cards.map(({ artifactId }) => artifactId), [target.artifactId], q);
      assert.deepEqual(found.counts, { all: 1, published: 0, unpublished: 0, pending: 1 });
      assert.equal(found.cards[0].head.revisionId, updated.revision.id);
      assert.deepEqual(found.cards[0].publication, { state: 'pending', revision: { revisionId: target.revision.id, sequence: 1, createdAt: new Date(target.revision.createdAt) }, version: 1, url: `https://published.example.test/a/${target.artifactId}` });
    }
    const pending = (await panel.library(actor, { ...query, q: 'report', status: 'pending' })).page;
    assert.deepEqual(pending.cards.map(({ artifactId }) => artifactId), [target.artifactId]);
    const published = (await panel.library(actor, { ...query, status: 'published' })).page;
    assert.deepEqual(published.cards.map(({ artifactId }) => artifactId), [current.artifactId]);
    const drafts = (await panel.library(actor, { ...query, q: 'report', status: 'unpublished' })).page;
    const moreDrafts = (await panel.library(actor, { ...query, q: 'report', status: 'unpublished', cursor: drafts.next! })).page;
    assert.equal(drafts.cards.length, 25);
    assert.equal(moreDrafts.cards.length, 4);
    assert.equal(moreDrafts.next, null);
    assert.equal(new Set([...drafts.cards, ...moreDrafts.cards].map(({ artifactId }) => artifactId)).size, 29);
    assert([...drafts.cards, ...moreDrafts.cards].every(({ publication }) => publication.state === 'unpublished'));
    const missing = await panel.library(actor, { ...query, q: 'no matching title', status: 'published' });
    assert.deepEqual(missing.page.counts, { all: 0, published: 0, unpublished: 0, pending: 0 });
    assert.deepEqual(missing.page.cards, []);
    assert.equal(missing.page.next, null);
    assert.deepEqual(missing.workspace.total, { count: 33, published: 2, pending: 1 });
    const ownerIdSearch = (await panel.library(actor, { scope: { kind: 'project', name: 'Beta' }, q: target.artifactId })).page;
    assert.deepEqual(ownerIdSearch.counts, { all: 0, published: 0, unpublished: 0, pending: 0 });
    assert.deepEqual(ownerIdSearch.cards, []);
  } finally { await app.close(); }
});

test('published library query exports and public MCP list validation stay unchanged', () => {
  assert.deepEqual(libraryQuerySchema.parse({}), { q: '', status: 'all' });
  assert.deepEqual(libraryQuerySchema.parse({ project: ' Alpha ' }), { q: '', status: 'all', project: 'Alpha' });
  assert.deepEqual(listSchema.parse({ project: 'Alpha' }), { limit: 25, project: 'Alpha' });
  assert.equal(libraryQuerySchema.safeParse({ status: 'unknown' }).success, false);
  assert.equal(libraryQuerySchema.safeParse({ q: 'a'.repeat(257) }).success, false);
  assert.deepEqual(listSchema.parse({}), { limit: 25 });
  assert.equal(listSchema.safeParse({ q: 'title' }).success, false);
  assert.equal(listSchema.safeParse({ status: 'published' }).success, false);
});
