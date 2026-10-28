import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { artifactShare, session, user } from '../packages/db/src/schema.ts';
import { createArtifactStore, libraryQuerySchema, listSchema, type Actor, type Snapshot } from '../packages/artifacts/src/index.ts';
import { createPanel } from '../packages/artifacts/src/panel/index.ts';
import { fixture, historicalSignIn } from './helpers.ts';

const snapshot = (title: string): Snapshot => ({ metadata: { title, description: '' }, content: { kind: 'text', text: title }, files: [] });

test('panel library searches the whole scope literally before status filtering and cursor pagination', async () => {
  const app = await fixture({ allowGuests: true });
  try {
    const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
    assert(signedIn);
    const actor: Actor = { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'library-test', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
    const options = { access: { ownerEmail: 'owner@example.test', allowGuests: false }, publishOrigin: 'https://published.example.test' };
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

async function sharedLibrary() {
  const app = await fixture({ allowGuests: true });
  const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
  assert(signedIn);
  const owner: Actor = { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'library-test', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
  const created = await app.auth.api.signUpEmail({ body: { name: 'Guest', email: 'guest@example.test', password: app.password } });
  await historicalSignIn(app, 'guest@example.test');
  const [guestSession] = await app.db.select().from(session).where(eq(session.userId, created.user.id));
  const guest = { ...owner, userId: created.user.id, sessionId: guestSession.id };
  await app.db.update(user).set({ email: 'GUEST@Example.TEST', emailVerified: true }).where(eq(user.id, guest.userId));
  await app.db.update(user).set({ name: '  Ana <Equipo>  ' }).where(eq(user.id, owner.userId));
  const store = createArtifactStore(app.db, { access: app.config.access, publishOrigin: 'https://published.example.test' });
  const create = (actor: Actor, title: string) => store.create(actor, { requestId: randomUUID(), snapshot: snapshot(title), project: 'Private project' });
  const publish = (read: Awaited<ReturnType<typeof create>>) => store.publish(owner, { requestId: randomUUID(), artifactId: read.artifactId, revisionId: read.revision.id, expectedPublicationVersion: 0 });
  const share = (artifactId: string) => store.share(owner, { requestId: randomUUID(), artifactId, email: 'guest@example.test' });
  return { ...app, owner, guest, store, create, publish, share };
}

test('shared library lists only current published shares, keeps published titles private from drafts, and follows revoke, re-share, publish, and delete', async () => {
  const app = await sharedLibrary();
  try {
    const first = await app.create(app.owner, 'Published title');
    const publication = await app.publish(first);
    const share = await app.share(first.artifactId);
    await app.store.update(app.owner, { requestId: randomUUID(), artifactId: first.artifactId, expectedRevisionId: first.revision.id, snapshot: snapshot('Secret draft title') });
    const never = await app.create(app.owner, 'Not published');
    await app.share(never.artifactId);
    const own = await app.create(app.guest, 'Guest own artifact');
    await app.store.publish(app.guest, { requestId: randomUUID(), artifactId: own.artifactId, revisionId: own.revision.id, expectedPublicationVersion: 0 });
    await app.store.share(app.guest, { requestId: randomUUID(), artifactId: own.artifactId, email: 'guest@example.test' });
    const expected = { artifactId: first.artifactId, title: 'Published title', ownerName: 'Ana <Equipo>', url: publication.url };
    assert.deepEqual(await app.store.listSharedWithMe(app.guest), { items: [expected] });
    assert.deepEqual((await app.store.list(app.guest)).items.map(({ title }) => title), ['Guest own artifact']);
    assert.deepEqual(await app.store.listSharedWithMe(app.owner), { items: [] });
    await app.store.unshare(app.owner, { requestId: randomUUID(), artifactId: first.artifactId, shareId: share.shareId });
    assert.deepEqual(await app.store.listSharedWithMe(app.guest), { items: [] });
    await app.share(first.artifactId);
    assert.deepEqual(await app.store.listSharedWithMe(app.guest), { items: [expected] });
    await app.publish(never);
    assert.deepEqual((await app.store.listSharedWithMe(app.guest)).items.map(({ title }) => title).sort(), ['Not published', 'Published title']);
    await app.store.delete(app.owner, { requestId: randomUUID(), artifactId: never.artifactId, expectedRevisionId: never.revision.id, expectedPublicationVersion: 1 });
    assert.deepEqual(await app.store.listSharedWithMe(app.guest), { items: [expected] });
  } finally { await app.close(); }
});

test('shared library uses the current verified email and email share kind on every read and normalizes blank owner names', async () => {
  const app = await sharedLibrary();
  try {
    const first = await app.create(app.owner, 'Current invitation');
    const publication = await app.publish(first);
    const shared = await app.share(first.artifactId);
    const expected = { artifactId: first.artifactId, title: 'Current invitation', ownerName: 'Ana <Equipo>', url: publication.url };
    assert.deepEqual(await app.store.listSharedWithMe(app.guest), { items: [expected] });
    for (const patch of [{ emailVerified: false }, { emailVerified: true, email: 'changed@example.test' }]) {
      await app.db.update(user).set(patch).where(eq(user.id, app.guest.userId));
      if ('email' in patch) await assert.rejects(app.store.listSharedWithMe(app.guest), { code: 'forbidden' });
      else assert.deepEqual(await app.store.listSharedWithMe(app.guest), { items: [] });
    }
    await app.db.update(user).set({ email: 'GUEST@Example.TEST' }).where(eq(user.id, app.guest.userId));
    await app.client.execute({ sql: 'UPDATE artifact_share SET kind = ? WHERE id = ?', args: ['domain', shared.shareId] });
    await assert.rejects(app.store.listSharedWithMe(app.guest), { code: 'forbidden' });
    await app.db.update(artifactShare).set({ kind: 'email' }).where(eq(artifactShare.id, shared.shareId));
    await app.db.update(user).set({ name: '   ' }).where(eq(user.id, app.ownerId));
    assert.deepEqual(await app.store.listSharedWithMe(app.guest), { items: [{ ...expected, ownerName: 'Usuario de Artifacts' }] });
  } finally { await app.close(); }
});

test('shared library rejects missing read scope, mismatched sessions, and expired sessions before returning data', async () => {
  const app = await sharedLibrary();
  try {
    const first = await app.create(app.owner, 'Authorized share');
    const publication = await app.publish(first);
    await app.share(first.artifactId);
    assert.deepEqual(await app.store.listSharedWithMe(app.guest), { items: [{ artifactId: first.artifactId, title: 'Authorized share', ownerName: 'Ana <Equipo>', url: publication.url }] });
    await assert.rejects(app.store.listSharedWithMe({ ...app.guest, scopes: ['artifacts:write'] }), { code: 'forbidden', details: { requiredScope: 'artifacts:read' } });
    await assert.rejects(app.store.listSharedWithMe({ ...app.guest, sessionId: app.owner.sessionId }), { code: 'forbidden' });
    await app.db.update(session).set({ expiresAt: new Date(0) }).where(eq(session.id, app.guest.sessionId));
    await assert.rejects(app.store.listSharedWithMe(app.guest), { code: 'forbidden' });
  } finally { await app.close(); }
});

test('shared library returns all fifty entries in newest-share order with artifact ID tie breaking', async () => {
  const app = await sharedLibrary();
  try {
    const entries = [];
    for (let index = 0; index < 50; index++) {
      const first = await app.create(app.owner, `Shared ${index}`);
      const published = await app.publish(first);
      const shared = await app.share(first.artifactId);
      await app.db.update(artifactShare).set({ createdAt: new Date(index < 25 ? 1000 : 2000) }).where(eq(artifactShare.id, shared.shareId));
      entries.push({ artifactId: first.artifactId, title: `Shared ${index}`, ownerName: 'Ana <Equipo>', url: published.url, order: index < 25 ? 1000 : 2000 });
    }
    const expected = entries.sort((a, b) => b.order - a.order || a.artifactId.localeCompare(b.artifactId)).map(({ order: _order, ...item }) => item);
    assert.deepEqual(await app.store.listSharedWithMe(app.guest), { items: expected });
  } finally { await app.close(); }
});
