import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../packages/db/src/schema.ts';
import { createArtifactStore, type Actor, type Snapshot } from '../packages/artifacts/src/index.ts';
import { createPanel, panelLibraryQuerySchema } from '../packages/artifacts/src/panel/index.ts';
import { readDetailUrl, detailQuery, detailHref, previewHref, exportHref, readLibraryUrl, libraryHref, scopeHref } from '../apps/dashboard/src/urls.ts';
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
    const publishedHead = await store.update(actor, { requestId: randomUUID(), artifactId: published.artifactId, expectedRevisionId: published.revision.id, snapshot: snapshot('Beta published') });
    await store.publish(actor, { requestId: randomUUID(), artifactId: published.artifactId, revisionId: publishedHead.revision.id, expectedPublicationVersion: 0 });
    const loose = await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Loose draft') });
    const all = await panel.library(actor);
    assert.deepEqual(all.page.counts, { all: 4, published: 1, unpublished: 2, pending: 1 });
    assert.deepEqual(all.workspace.total, { count: 4, published: 2, pending: 1 });
    assert.deepEqual(all.workspace.unfiled, { count: 1, published: 0, pending: 0 });
    assert.deepEqual(all.workspace.projects.map(({ name, count, published, pending }) => ({ name, count, published, pending })), [{ name: 'Álpha', count: 2, published: 1, pending: 1 }, { name: 'Beta', count: 1, published: 1, pending: 0 }]);
    const publishedCard = all.page.cards.find(({ artifactId }) => artifactId === published.artifactId)!;
    assert.deepEqual(publishedCard.publication, { state: 'published', url: `https://published.example.test/a/${published.artifactId}`, version: 1, revision: { revisionId: publishedHead.revision.id, sequence: 2, createdAt: new Date(publishedHead.revision.createdAt) } });
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

test('projects index returns inclusive tallies, the three newest titles per group, and head-derived update times', async (t) => {
  const app = await fixture();
  try {
    const actor = await actorFor(app);
    const store = createArtifactStore(app.db, options);
    const panel = createPanel(app.db, options);
    const timestamp = Date.now();
    t.mock.timers.enable({ apis: ['Date'], now: timestamp });
    const alpha: Awaited<ReturnType<typeof store.create>>[] = [];
    const loose: Awaited<ReturnType<typeof store.create>>[] = [];
    for (let index = 0; index < 4; index++) {
      alpha.push(await store.create(actor, { requestId: randomUUID(), snapshot: snapshot(`Alpha ${index}`), project: index ? 'álpha' : 'Álpha' }));
      loose.push(await store.create(actor, { requestId: randomUUID(), snapshot: snapshot(`Loose ${index}`) }));
    }
    const beta = await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Beta draft'), project: 'Beta' });
    await store.publish(actor, { requestId: randomUUID(), artifactId: alpha[0].artifactId, revisionId: alpha[0].revision.id, expectedPublicationVersion: 0 });
    await store.publish(actor, { requestId: randomUUID(), artifactId: alpha[1].artifactId, revisionId: alpha[1].revision.id, expectedPublicationVersion: 0 });
    t.mock.timers.setTime(timestamp + 1_000);
    await store.update(actor, { requestId: randomUUID(), artifactId: alpha[1].artifactId, expectedRevisionId: alpha[1].revision.id, snapshot: snapshot('Newest Alpha') });
    const result = await panel.projectsIndex(actor);
    assert.deepEqual(result.workspace.total, { count: 9, published: 2, pending: 1 });
    assert.deepEqual(result.workspace.unfiled, { count: 4, published: 0, pending: 0 });
    assert.deepEqual(result.workspace.projects, [
      { name: 'Álpha', count: 4, published: 2, pending: 1, updatedAt: new Date(timestamp + 1_000) },
      { name: 'Beta', count: 1, published: 0, pending: 0, updatedAt: new Date(timestamp) },
    ]);
    const tied = alpha.filter((item) => item.artifactId !== alpha[1].artifactId).sort((left, right) => left.artifactId < right.artifactId ? 1 : -1);
    assert.deepEqual(result.overview.projects[0].recent, [{ artifactId: alpha[1].artifactId, title: 'Newest Alpha' }, ...tied.slice(0, 2).map((item) => ({ artifactId: item.artifactId, title: item.revision.snapshot.metadata.title }))]);
    assert.deepEqual(result.overview.projects[1].recent, [{ artifactId: beta.artifactId, title: 'Beta draft' }]);
    assert.deepEqual(result.overview.unfiled, { tally: { count: 4, published: 0, pending: 0 }, recent: [...loose].sort((left, right) => left.artifactId < right.artifactId ? 1 : -1).slice(0, 3).map((item) => ({ artifactId: item.artifactId, title: item.revision.snapshot.metadata.title })) });
    t.mock.timers.setTime(timestamp + 2_000);
    await store.update(actor, { requestId: randomUUID(), artifactId: beta.artifactId, expectedRevisionId: beta.revision.id, snapshot: snapshot('Newest Beta') });
    const reordered = await panel.projectsIndex(actor);
    assert.deepEqual(reordered.workspace.projects.map(({ name }) => name), ['Álpha', 'Beta'], 'Sidebar retains project order');
    assert.deepEqual(reordered.overview.projects.map(({ project: { name, updatedAt } }) => ({ name, updatedAt })), [{ name: 'Beta', updatedAt: new Date(timestamp + 2_000) }, { name: 'Álpha', updatedAt: new Date(timestamp + 1_000) }]);
    t.mock.timers.setTime(timestamp + 3_000);
    await store.publish(actor, { requestId: randomUUID(), artifactId: loose[0].artifactId, revisionId: loose[0].revision.id, expectedPublicationVersion: 0 });
    await store.move(actor, { requestId: randomUUID(), artifactId: loose[0].artifactId, project: 'Beta' });
    const moved = await panel.projectsIndex(actor);
    assert.deepEqual(moved.overview.projects[0].project, { name: 'Beta', count: 2, published: 1, pending: 0, updatedAt: new Date(timestamp + 2_000) });
    await store.move(actor, { requestId: randomUUID(), artifactId: beta.artifactId, project: null });
    assert.deepEqual((await panel.projectsIndex(actor)).overview.projects.map(({ project: { name } }) => name), ['Álpha', 'Beta'], 'Move time does not become update time');
  } finally { t.mock.timers.reset(); await app.close(); }
});

test('projects index breaks project timestamp ties by project order and represents empty and unfiled-only owners', async (t) => {
  const app = await fixture();
  try {
    const actor = await actorFor(app);
    const store = createArtifactStore(app.db, options);
    const panel = createPanel(app.db, options);
    assert.deepEqual(await panel.projectsIndex(actor), { workspace: { total: { count: 0, published: 0, pending: 0 }, unfiled: { count: 0, published: 0, pending: 0 }, projects: [] }, overview: { projects: [], unfiled: { tally: { count: 0, published: 0, pending: 0 }, recent: [] } } });
    const loose = await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Only loose') });
    assert.deepEqual(await panel.projectsIndex(actor), { workspace: { total: { count: 1, published: 0, pending: 0 }, unfiled: { count: 1, published: 0, pending: 0 }, projects: [] }, overview: { projects: [], unfiled: { tally: { count: 1, published: 0, pending: 0 }, recent: [{ artifactId: loose.artifactId, title: 'Only loose' }] } } });
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Zeta'), project: 'Zeta' });
    await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Alpha'), project: 'Alpha' });
    assert.deepEqual((await panel.projectsIndex(actor)).overview.projects.map(({ project: { name } }) => name), ['Alpha', 'Zeta']);
  } finally { t.mock.timers.reset(); await app.close(); }
});

test('projects index filters owners before ranking and rejects missing scope, mismatched sessions, and revocation', async () => {
  const app = await fixture();
  try {
    const actor = await actorFor(app);
    const store = createArtifactStore(app.db, options);
    const panel = createPanel(app.db, options);
    const own = await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Own Alpha'), project: 'Alpha' });
    const outsider = await app.auth.api.signUpEmail({ body: { name: 'Other owner', email: 'index-other@example.test', password: app.password } });
    await app.auth.api.signInEmail({ body: { email: 'index-other@example.test', password: app.password } });
    const [otherSession] = await app.db.select().from(session).where(eq(session.userId, outsider.user.id));
    const other = { ...actor, userId: outsider.user.id, sessionId: otherSession.id };
    for (let index = 0; index < 4; index++) await store.create(other, { requestId: randomUUID(), snapshot: snapshot(`Private ${index}`), project: 'Alpha' });
    await store.create(other, { requestId: randomUUID(), snapshot: snapshot('Private loose') });
    const result = await panel.projectsIndex(actor);
    assert.deepEqual(result.workspace.total, { count: 1, published: 0, pending: 0 });
    assert.deepEqual(result.overview.projects, [{ project: { name: 'Alpha', count: 1, published: 0, pending: 0, updatedAt: new Date(own.revision.createdAt) }, recent: [{ artifactId: own.artifactId, title: 'Own Alpha' }] }]);
    assert.deepEqual(result.overview.unfiled, { tally: { count: 0, published: 0, pending: 0 }, recent: [] });
    assert.deepEqual((await panel.projectsIndex(other)).workspace.total, { count: 5, published: 0, pending: 0 });
    await assert.rejects(panel.projectsIndex({ ...actor, scopes: [] }), { code: 'forbidden' });
    await assert.rejects(panel.projectsIndex({ ...actor, sessionId: other.sessionId }), { code: 'forbidden' });
    await app.db.delete(session).where(eq(session.id, actor.sessionId));
    await assert.rejects(panel.projectsIndex(actor), { code: 'forbidden' });
  } finally { await app.close(); }
});


test('detail reads one selected snapshot, light history and real client names in one transaction', async (t) => {
  const app = await fixture();
  try {
    const actor = await actorFor(app);
    await app.db.insert(schema.oauthClient).values({ id: 'different-primary-key', clientId: actor.clientId, name: 'Authoring client', redirectUris: [] });
    await app.db.insert(schema.oauthClient).values({ id: 'nullable-name-key', clientId: 'nullable-name-client', name: null, redirectUris: [] });
    const store = createArtifactStore(app.db, options);
    const first = await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('First'), project: 'Alpha' });
    const revisions = [first.revision];
    for (let sequence = 2; sequence <= 7; sequence++) {
      const next = await store.update({ ...actor, clientId: sequence === 7 ? 'unregistered-client' : sequence === 6 ? 'nullable-name-client' : actor.clientId }, { requestId: randomUUID(), artifactId: first.artifactId, expectedRevisionId: revisions.at(-1)!.id, snapshot: snapshot(`Revision ${sequence}`) });
      revisions.push(next.revision);
    }
    await store.publish(actor, { requestId: randomUUID(), artifactId: first.artifactId, revisionId: first.revision.id, expectedPublicationVersion: 0 });
    const queries: string[] = [];
    const db = drizzle(app.client, { schema, logger: { logQuery(query) { queries.push(query); } } });
    const transactions = t.mock.method(db, 'transaction');
    const panel = createPanel(db, options);
    const input = { artifactId: first.artifactId, revisionId: revisions[1].id, includeComparison: false };
    const result = await panel.artifact(actor, input);
    assert.equal(transactions.mock.callCount(), 1);
    assert.equal(queries.filter((query) => query.startsWith('select') && query.includes('"snapshot"')).length, 1);
    assert.deepEqual(result.workspace.total, { count: 1, published: 1, pending: 1 });
    assert.deepEqual(result.detail.selected, { revision: revisions[1], author: { clientId: actor.clientId, name: 'Authoring client' } });
    assert.equal(result.detail.createdAt.toISOString(), first.revision.createdAt);
    assert.equal(result.detail.head.revisionId, revisions[6].id);
    assert.deepEqual(result.detail.publication, { revision: { revisionId: first.revision.id, sequence: 1, createdAt: new Date(first.revision.createdAt) }, version: 1, url: `https://published.example.test/a/${first.artifactId}` });
    assert.deepEqual(result.detail.history.entries.map(({ sequence }) => sequence), [7, 6, 5, 4, 3]);
    assert.deepEqual(result.detail.history.entries[0].author, { clientId: 'unregistered-client', name: null });
    assert.deepEqual(result.detail.history.entries[1].author, { clientId: 'nullable-name-client', name: null });
    assert.equal(result.detail.history.olderBefore, 3);
    assert.equal(result.detail.history.before, null);
    assert.equal(result.detail.compared?.revisionId, first.revision.id);
    assert.equal(result.detail.comparison, null);
    assert.deepEqual(result.detail.choices.map(({ sequence }) => sequence), [7, 6, 5, 4, 3, 2, 1]);
    assert(result.detail.history.entries.every((entry) => !('snapshot' in entry)));
    queries.length = 0;
    const explicit = await panel.artifact(actor, { ...input, compareTo: revisions[5].id });
    assert.equal(explicit.detail.compared?.sequence, 6);
    assert.equal(explicit.detail.comparison, null);
    assert.equal(queries.filter((query) => query.startsWith('select') && query.includes('"snapshot"')).length, 1);
    queries.length = 0;
    const compared = await panel.artifact(actor, { ...input, compareTo: revisions[5].id, includeComparison: true });
    assert.equal(queries.filter((query) => query.startsWith('select') && query.includes('"snapshot"')).length, 2);
    assert.equal(compared.detail.comparison?.content.before.text, 'Revision 6');
    assert.equal(compared.detail.comparison?.content.after.text, 'Revision 2');
    const older = await panel.artifact(actor, { ...input, before: 3, compareTo: revisions[1].id });
    assert.deepEqual(older.detail.history.entries.map(({ sequence }) => sequence), [2, 1]);
    assert.equal(older.detail.history.olderBefore, null);
    assert.equal(older.detail.compared?.sequence, 1);
    assert.deepEqual(older.detail.choices.map(({ sequence }) => sequence), [7, 2, 1]);
  } finally { await app.close(); }
});

test('detail comparison falls through self, publication, head, parent, and the current history page', async () => {
  const app = await fixture();
  try {
    const actor = await actorFor(app);
    const store = createArtifactStore(app.db, options);
    const panel = createPanel(app.db, options);
    const first = await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('One') });
    const input = { artifactId: first.artifactId, includeComparison: true };
    const single = await panel.artifact(actor, input);
    assert.equal(single.detail.compared, null);
    assert.equal(single.detail.comparison, null);
    const second = await store.update(actor, { requestId: randomUUID(), artifactId: first.artifactId, expectedRevisionId: first.revision.id, snapshot: snapshot('Two') });
    const head = await panel.artifact(actor, { ...input, revisionId: first.revision.id, compareTo: first.revision.id });
    assert.equal(head.detail.compared?.sequence, 2);
    const parent = await panel.artifact(actor, { ...input, before: 1, compareTo: second.revision.id });
    assert.deepEqual(parent.detail.history.entries, []);
    assert.equal(parent.detail.compared?.sequence, 1);
    assert.equal(parent.detail.comparison?.content.before.text, 'One');
    const detachedId = randomUUID();
    await app.db.insert(schema.artifactRevision).values({ id: detachedId, artifactId: first.artifactId, parentRevisionId: null, sequence: 3, authorUserId: actor.userId, authorClientId: actor.clientId, createdAt: new Date(), sha256: second.revision.sha256, snapshot: JSON.stringify(second.revision.snapshot) });
    await app.db.update(schema.artifact).set({ headRevisionId: detachedId }).where(eq(schema.artifact.id, first.artifactId));
    const history = await panel.artifact(actor, input);
    assert.equal(history.detail.compared?.sequence, 2);
    await store.publish(actor, { requestId: randomUUID(), artifactId: first.artifactId, revisionId: detachedId, expectedPublicationVersion: 0 });
    const selfPublication = await panel.artifact(actor, input);
    assert.equal(selfPublication.detail.compared?.sequence, 2);
  } finally { await app.close(); }
});

test('detail rejects invalid IDs, another artifact or owner, missing scope, and revoked sessions', async () => {
  const app = await fixture();
  try {
    const actor = await actorFor(app);
    const store = createArtifactStore(app.db, options);
    const panel = createPanel(app.db, options);
    const own = await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Own') });
    const otherArtifact = await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Other artifact') });
    const input = { artifactId: own.artifactId, includeComparison: false };
    for (const patch of [{ revisionId: '' }, { compareTo: '' }, { before: 0 }, { before: 1.5 }]) await assert.rejects(panel.artifact(actor, { ...input, ...patch }), { name: 'ZodError' });
    for (const patch of [{ artifactId: 'missing' }, { revisionId: 'missing' }, { compareTo: 'missing' }, { revisionId: otherArtifact.revision.id }, { compareTo: otherArtifact.revision.id }]) await assert.rejects(panel.artifact(actor, { ...input, ...patch }), { code: 'not_found' });
    const outsider = await app.auth.api.signUpEmail({ body: { name: 'Other owner', email: 'detail-other@example.test', password: app.password } });
    await app.auth.api.signInEmail({ body: { email: 'detail-other@example.test', password: app.password } });
    const [otherSession] = await app.db.select().from(session).where(eq(session.userId, outsider.user.id));
    const other = { ...actor, userId: outsider.user.id, sessionId: otherSession.id };
    await assert.rejects(panel.artifact(other, input), { code: 'not_found' });
    await assert.rejects(panel.artifact({ ...actor, sessionId: other.sessionId }, input), { code: 'forbidden' });
    await assert.rejects(panel.artifact({ ...actor, scopes: [] }, input), { code: 'forbidden' });
    await app.db.delete(session).where(eq(session.id, actor.sessionId));
    await assert.rejects(panel.artifact(actor, input), { code: 'forbidden' });
  } finally { await app.close(); }
});

test('detail URLs preserve selection and cursors without rewriting the default preview URL', () => {
  const read = (query: string) => readDetailUrl('artifact-one', new URL(`https://panel.example.test/artifacts/artifact-one${query}`));
  assert.equal(read('').tab, 'preview');
  assert.equal(read('?tab=unknown').tab, 'preview');
  const state = read('?revisionId=second&compareTo=first&before=3&tab=files');
  assert.deepEqual(detailQuery(state), { artifactId: 'artifact-one', revisionId: 'second', compareTo: 'first', before: 3, includeComparison: false });
  assert.equal(detailQuery(read('?tab=compare')).includeComparison, true);
  assert.equal(detailHref(state, { tab: 'compare' }), '/artifacts/artifact-one?revisionId=second&compareTo=first&before=3&tab=compare');
  assert.equal(detailHref(state, { revisionId: 'first', before: undefined, tab: 'preview' }), '/artifacts/artifact-one?revisionId=first');
  assert.equal(previewHref('artifact-one', 'second'), '/artifacts/artifact-one/preview?revisionId=second');
  assert.equal(exportHref('artifact-one', 'second'), '/artifacts/artifact-one/export?revisionId=second');
  for (const query of ['?revisionId=', '?compareTo=', '?before=', '?before=invalid']) assert.throws(() => read(query), { name: 'ZodError' });
});
