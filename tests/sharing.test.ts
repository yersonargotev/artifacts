import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { artifactCommand, artifactShare, session, user } from '../packages/db/src/schema.ts';
import { createArtifactStore, consumeGrantSchema, type Actor, type Snapshot } from '../packages/artifacts/src/index.ts';
import { canonicalJson, sha256 } from '../packages/artifacts/src/serialization.ts';
import { createPublicationApp } from '../apps/publication/src/http.ts';
import { artifactErrorResponse, panelActor, publicationReadSchema, publicationServiceAuthorized } from '../apps/dashboard/src/publication.ts';
import { fixture } from './helpers.ts';

const snapshot: Snapshot = { metadata: { title: 'Shared artifact', description: '' }, content: { kind: 'html', text: '<p>shared</p>' }, files: [] };
const publishedSnapshot: Snapshot = { metadata: { title: 'Quarterly plan', description: 'Shared with one guest', custom: { audience: 'guest' } }, content: { kind: 'html', text: '<h1>Shared revision</h1>' }, files: [{ path: 'notes.txt', mediaType: 'text/plain', encoding: 'utf8', data: 'Shared attachment.\n' }] };
const publishOrigin = 'https://published.example.test';
const cookieHeader = (response: Response) => response.headers.getSetCookie().map((value) => value.split(';')[0]!).join('; ');
const viewerCookie = (response: Response) => response.headers.getSetCookie().find((value) => value.startsWith('__Host-artifacts-viewer-'))!.split(';')[0]!;

function stubbedWorker(read: typeof fetch) {
  const publish = 'https://publication.example.test';
  const backend: typeof fetch = async (input, init) => String(input).endsWith('/consume') ? Response.json({ artifactId: 'artifact-a', userId: 'owner-a', sessionId: 'session-a', expiresAt: Date.now() + 60_000 }) : read(input, init);
  const worker = createPublicationApp({ DASHBOARD_URL: 'https://panel.example.test', PUBLISH_URL: publish, PUBLICATION_SERVICE_SECRET: 's'.repeat(40), PUBLICATION_COOKIE_SECRET: 'c'.repeat(40) }, backend);
  async function open() {
    const begin = await worker(new Request(`${publish}/a/artifact-a`));
    const state = new URL(begin.headers.get('location')!).searchParams.get('state')!;
    return viewerCookie(await worker(new Request(`${publish}/callback?${new URLSearchParams({ artifactId: 'artifact-a', state, code: 'a'.repeat(43) })}`, { headers: { cookie: cookieHeader(begin) } })));
  }
  return { worker, open };
}

async function setup() {
  const app = await fixture();
  const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
  assert(signedIn);
  const owner: Actor = { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'sharing-test', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
  const store = createArtifactStore(app.db, { publishOrigin });
  async function account(name: string, email: string): Promise<Actor> {
    const created = await app.auth.api.signUpEmail({ body: { name, email, password: app.password } });
    await app.auth.api.signInEmail({ body: { email, password: app.password } });
    const [signedInSession] = await app.db.select().from(session).where(eq(session.userId, created.user.id));
    return panelActor({ userId: created.user.id, sessionId: signedInSession.id, name, clientId: 'panel-client', scopes: [], expiresAt: signedInSession.expiresAt });
  }
  const other = await account('Outsider', 'outsider@example.test');
  const guest = await account('Guest', 'guest@example.test');
  const verify = (actor: Actor, emailVerified: boolean) => app.db.update(user).set({ emailVerified }).where(eq(user.id, actor.userId));
  await verify(guest, true);
  const create = async (actor: Actor) => (await store.create(actor, { requestId: randomUUID(), snapshot })).artifactId;
  const share = (actor: Actor, artifactId: string, email: string) => store.share(actor, { requestId: randomUUID(), artifactId, email });
  const publish = (artifactId: string, revisionId: string, expectedPublicationVersion = 0) => store.publish(owner, { requestId: randomUUID(), artifactId, revisionId, expectedPublicationVersion });
  async function admit(actor: Actor, artifactId: string) {
    const state = randomUUID();
    const { code } = await store.issuePublicationGrant(actor, { artifactId, state });
    return store.consumePublicationGrant({ artifactId, state, code });
  }
  return { ...app, owner, other, guest, store, verify, create, share, publish, admit };
}

test('share stores the email in lowercase, returns the existing share for a duplicate, and replays a retried request', async () => {
  const app = await setup();
  try {
    const artifactId = await app.create(app.owner);
    const request = { requestId: randomUUID(), artifactId, email: 'Ana@Example.com' };
    const shared = await app.store.share(app.owner, request);
    assert.deepEqual(shared, { shareId: shared.shareId, artifactId, kind: 'email', value: 'ana@example.com', createdAt: shared.createdAt });
    assert.deepEqual(await app.db.select().from(artifactShare), [{ id: shared.shareId, artifactId, kind: 'email', value: 'ana@example.com', createdBy: app.ownerId, createdAt: new Date(shared.createdAt) }]);
    assert.deepEqual(await app.store.share(app.owner, request), shared);
    assert.deepEqual(await app.store.share(app.owner, { ...request, email: ' ANA@EXAMPLE.COM ' }), shared);
    await assert.rejects(app.store.share(app.owner, { ...request, email: 'bob@example.com' }), { code: 'request_conflict' });
    assert.deepEqual(await app.share(app.owner, artifactId, 'ana@example.com'), shared);
    assert.equal((await app.db.select().from(artifactShare)).length, 1);
  } finally { await app.close(); }
});

test('unshare removes the share, replays its receipt, and rejects a share that is gone', async () => {
  const app = await setup();
  try {
    const artifactId = await app.create(app.owner);
    const ana = await app.share(app.owner, artifactId, 'ana@example.com');
    const bob = await app.share(app.owner, artifactId, 'bob@example.com');
    const request = { requestId: randomUUID(), artifactId, shareId: ana.shareId };
    assert.deepEqual(await app.store.unshare(app.owner, request), { artifactId, shareId: ana.shareId });
    assert.deepEqual(await app.store.listShares(app.owner, { artifactId }), { items: [bob] });
    assert.deepEqual(await app.store.unshare(app.owner, request), { artifactId, shareId: ana.shareId });
    await assert.rejects(app.store.unshare(app.owner, { ...request, requestId: randomUUID() }), { code: 'not_found' });
    assert.deepEqual((await app.db.select().from(artifactShare)).map((row) => row.value), ['bob@example.com']);
  } finally { await app.close(); }
});

test('unshare through another artifact of the same owner returns not_found and keeps the share', async () => {
  const app = await setup();
  try {
    const first = await app.create(app.owner);
    const second = await app.create(app.owner);
    const ana = await app.share(app.owner, second, 'ana@example.com');
    await assert.rejects(app.store.unshare(app.owner, { requestId: randomUUID(), artifactId: first, shareId: ana.shareId }), { code: 'not_found' });
    assert.deepEqual(await app.store.listShares(app.owner, { artifactId: second }), { items: [ana] });
    assert.equal((await app.db.select().from(artifactShare)).length, 1);
  } finally { await app.close(); }
});

test('unshare of another owner\'s share through an owned artifact returns not_found and keeps the share', async () => {
  const app = await setup();
  try {
    const artifactId = await app.create(app.owner);
    const foreign = await app.create(app.other);
    const ana = await app.share(app.owner, artifactId, 'ana@example.com');
    await assert.rejects(app.store.unshare(app.other, { requestId: randomUUID(), artifactId: foreign, shareId: ana.shareId }), { code: 'not_found' });
    assert.deepEqual(await app.store.listShares(app.owner, { artifactId }), { items: [ana] });
    assert.equal((await app.db.select().from(artifactShare)).length, 1);
  } finally { await app.close(); }
});

test('listShares returns only the shares of the requested owned artifact, ordered by email', async () => {
  const app = await setup();
  try {
    const first = await app.create(app.owner);
    const second = await app.create(app.owner);
    const foreign = await app.create(app.other);
    const zoe = await app.share(app.owner, first, 'zoe@example.com');
    const ana = await app.share(app.owner, first, 'ana@example.com');
    await app.share(app.owner, second, 'bob@example.com');
    await app.share(app.other, foreign, 'carl@example.com');
    assert.deepEqual(await app.store.listShares(app.owner, { artifactId: first }), { items: [ana, zoe] });
    assert.deepEqual((await app.store.listShares(app.owner, { artifactId: second })).items.map((item) => item.value), ['bob@example.com']);
    assert.deepEqual(await app.store.listShares(app.owner, { artifactId: await app.create(app.owner) }), { items: [] });
  } finally { await app.close(); }
});

test('a non-owner gets not_found and a token without artifacts:publish gets forbidden', async () => {
  const app = await setup();
  try {
    const artifactId = await app.create(app.owner);
    const ana = await app.share(app.owner, artifactId, 'ana@example.com');
    await assert.rejects(app.share(app.other, artifactId, 'eve@example.com'), { code: 'not_found' });
    await assert.rejects(app.store.unshare(app.other, { requestId: randomUUID(), artifactId, shareId: ana.shareId }), { code: 'not_found' });
    await assert.rejects(app.store.listShares(app.other, { artifactId }), { code: 'not_found' });
    const writer = { ...app.owner, scopes: ['artifacts:read', 'artifacts:write'] };
    await assert.rejects(app.share(writer, artifactId, 'eve@example.com'), { code: 'forbidden', details: { requiredScope: 'artifacts:publish' } });
    await assert.rejects(app.store.unshare(writer, { requestId: randomUUID(), artifactId, shareId: ana.shareId }), { code: 'forbidden' });
    await assert.rejects(app.store.listShares(writer, { artifactId }), { code: 'forbidden' });
    assert.deepEqual(await app.db.select().from(artifactShare), [{ id: ana.shareId, artifactId, kind: 'email', value: 'ana@example.com', createdBy: app.ownerId, createdAt: new Date(ana.createdAt) }]);
  } finally { await app.close(); }
});

test('an invalid email fails validation and writes nothing', async () => {
  const app = await setup();
  try {
    const artifactId = await app.create(app.owner);
    for (const email of ['not-an-email', 'ana@', '', `${'a'.repeat(250)}@example.com`]) await assert.rejects(app.share(app.owner, artifactId, email), { name: 'ZodError' }, email);
    assert.deepEqual(await app.db.select().from(artifactShare), []);
  } finally { await app.close(); }
});

test('deleting the artifact deletes its shares and scrubs the share receipts and their payload hashes', async () => {
  const app = await setup();
  try {
    const artifactId = await app.create(app.owner);
    const request = { requestId: randomUUID(), artifactId, email: 'Ana@Example.com' };
    await app.store.share(app.owner, request);
    await app.share(app.owner, artifactId, 'bob@example.com');
    const shareHash = await sha256(canonicalJson({ kind: 'share', input: { ...request, email: 'ana@example.com' } }));
    const receiptHashes = async () => (await app.db.select().from(artifactCommand)).filter((row) => JSON.parse(row.result).artifactId === artifactId).map((row) => row.payloadHash);
    assert((await receiptHashes()).includes(shareHash), 'the share receipt carries the hash of its input');
    const current = await app.store.read(app.owner, { artifactId });
    await app.store.delete(app.owner, { requestId: randomUUID(), artifactId, expectedRevisionId: current.headRevisionId, expectedPublicationVersion: 0 });
    assert.deepEqual(await app.db.select().from(artifactShare), []);
    assert(!JSON.stringify(await app.db.select().from(artifactCommand)).includes('@example.com'));
    assert(!(await receiptHashes()).includes(shareHash), 'no receipt keeps the hash of the share input');
    await assert.rejects(app.store.share(app.owner, request), { code: 'not_found' });
    await assert.rejects(app.store.share(app.owner, { ...request, email: 'eve@example.com' }), { code: 'not_found' });
  } finally { await app.close(); }
});

test('a guest whose verified email matches a share reads the published revision without owner-only fields', async () => {
  const app = await setup();
  try {
    const first = await app.store.create(app.owner, { requestId: randomUUID(), snapshot: publishedSnapshot, project: 'Clientes' });
    await app.publish(first.artifactId, first.revision.id);
    await app.store.update(app.owner, { requestId: randomUUID(), artifactId: first.artifactId, expectedRevisionId: first.revision.id, snapshot: { ...publishedSnapshot, content: { kind: 'html', text: '<h1>Unpublished draft</h1>' } } });
    await app.share(app.owner, first.artifactId, 'guest@example.test');
    const viewer = await app.admit(app.guest, first.artifactId);
    assert.deepEqual(viewer, { artifactId: first.artifactId, userId: app.guest.userId, sessionId: app.guest.sessionId, expiresAt: viewer.expiresAt });
    const expected = {
      artifactId: first.artifactId,
      ownerName: 'Test owner',
      publication: { revisionId: first.revision.id, version: 1, url: `${publishOrigin}/a/${first.artifactId}` },
      revision: { id: first.revision.id, createdAt: first.revision.createdAt, sha256: first.revision.sha256, snapshot: publishedSnapshot },
    };
    assert.deepEqual(await app.store.readPublished(viewer, { artifactId: first.artifactId }), expected);
    assert.deepEqual(await app.store.readPublished(viewer, { artifactId: first.artifactId, revisionId: first.revision.id }), expected);
  } finally { await app.close(); }
});

test('a share matches the verified account email in any letter case', async () => {
  const app = await setup();
  try {
    const first = await app.store.create(app.owner, { requestId: randomUUID(), snapshot: publishedSnapshot });
    await app.publish(first.artifactId, first.revision.id);
    assert.equal((await app.share(app.owner, first.artifactId, 'GUEST@Example.TEST')).value, 'guest@example.test');
    await app.db.update(user).set({ email: 'Guest@Example.test' }).where(eq(user.id, app.guest.userId));
    const viewer = await app.admit(app.guest, first.artifactId);
    assert.equal((await app.store.readPublished(viewer, { artifactId: first.artifactId })).revision.id, first.revision.id);
  } finally { await app.close(); }
});

test('a share row of another kind is denied even when its value equals the guest\'s verified email', async () => {
  const app = await setup();
  try {
    const first = await app.store.create(app.owner, { requestId: randomUUID(), snapshot: publishedSnapshot });
    await app.publish(first.artifactId, first.revision.id);
    await app.db.run(sql`insert into artifact_share (id, artifact_id, kind, value, created_by, created_at) values (${randomUUID()}, ${first.artifactId}, 'domain', 'guest@example.test', ${app.ownerId}, ${Date.now()})`);
    const viewer = { artifactId: first.artifactId, userId: app.guest.userId, sessionId: app.guest.sessionId, expiresAt: Date.now() + 60_000 };
    await assert.rejects(app.admit(app.guest, first.artifactId), { code: 'not_found', message: 'Artifact not found' });
    await assert.rejects(app.store.readPublished(viewer, { artifactId: first.artifactId }), { code: 'not_found', message: 'Artifact not found' });
    await app.share(app.owner, first.artifactId, 'guest@example.test');
    assert.equal((await app.store.readPublished(viewer, { artifactId: first.artifactId })).revision.id, first.revision.id, 'the same viewer is admitted once an email share exists');
  } finally { await app.close(); }
});

test('an unverified email is denied, and verification is checked again on every grant and read', async () => {
  const app = await setup();
  try {
    const first = await app.store.create(app.owner, { requestId: randomUUID(), snapshot: publishedSnapshot });
    await app.publish(first.artifactId, first.revision.id);
    await app.share(app.owner, first.artifactId, 'guest@example.test');
    await app.share(app.owner, first.artifactId, 'outsider@example.test');
    await assert.rejects(app.admit(app.other, first.artifactId), { code: 'not_found' });
    await app.verify(app.guest, false);
    await assert.rejects(app.admit(app.guest, first.artifactId), { code: 'not_found' });
    await app.verify(app.guest, true);
    const viewer = await app.admit(app.guest, first.artifactId);
    assert.equal((await app.store.readPublished(viewer, { artifactId: first.artifactId })).revision.id, first.revision.id);
    const state = randomUUID();
    const pending = await app.store.issuePublicationGrant(app.guest, { artifactId: first.artifactId, state });
    await app.verify(app.guest, false);
    await assert.rejects(app.store.readPublished(viewer, { artifactId: first.artifactId }), { code: 'not_found' });
    await assert.rejects(app.store.consumePublicationGrant({ artifactId: first.artifactId, state, code: pending.code }), { code: 'invalid_grant' });
  } finally { await app.close(); }
});

test('revoking a share denies the next read, the pending grant, and new grants', async () => {
  const app = await setup();
  try {
    const first = await app.store.create(app.owner, { requestId: randomUUID(), snapshot: publishedSnapshot });
    await app.publish(first.artifactId, first.revision.id);
    const shared = await app.share(app.owner, first.artifactId, 'guest@example.test');
    const viewer = await app.admit(app.guest, first.artifactId);
    assert.equal((await app.store.readPublished(viewer, { artifactId: first.artifactId })).revision.id, first.revision.id);
    const state = randomUUID();
    const pending = await app.store.issuePublicationGrant(app.guest, { artifactId: first.artifactId, state });
    await app.store.unshare(app.owner, { requestId: randomUUID(), artifactId: first.artifactId, shareId: shared.shareId });
    await assert.rejects(app.store.readPublished(viewer, { artifactId: first.artifactId }), { code: 'not_found', message: 'Artifact not found' });
    await assert.rejects(app.store.consumePublicationGrant({ artifactId: first.artifactId, state, code: pending.code }), { code: 'invalid_grant', message: 'Publication grant is invalid or expired' });
    await assert.rejects(app.admit(app.guest, first.artifactId), { code: 'not_found', message: 'Artifact not found' });
  } finally { await app.close(); }
});

test('a share on a never-published artifact is kept, returns not_found, and admits the guest once published', async () => {
  const app = await setup();
  try {
    const first = await app.store.create(app.owner, { requestId: randomUUID(), snapshot: publishedSnapshot });
    const shared = await app.share(app.owner, first.artifactId, 'guest@example.test');
    await assert.rejects(app.admit(app.guest, first.artifactId), { code: 'not_found' });
    assert.deepEqual(await app.store.listShares(app.owner, { artifactId: first.artifactId }), { items: [shared] });
    await app.publish(first.artifactId, first.revision.id);
    const viewer = await app.admit(app.guest, first.artifactId);
    assert.equal((await app.store.readPublished(viewer, { artifactId: first.artifactId })).revision.id, first.revision.id);
  } finally { await app.close(); }
});

test('deleting the artifact denies an admitted guest and removes the share', async () => {
  const app = await setup();
  try {
    const first = await app.store.create(app.owner, { requestId: randomUUID(), snapshot: publishedSnapshot });
    await app.publish(first.artifactId, first.revision.id);
    await app.share(app.owner, first.artifactId, 'guest@example.test');
    const viewer = await app.admit(app.guest, first.artifactId);
    assert.equal((await app.store.readPublished(viewer, { artifactId: first.artifactId })).revision.id, first.revision.id);
    await app.store.delete(app.owner, { requestId: randomUUID(), artifactId: first.artifactId, expectedRevisionId: first.revision.id, expectedPublicationVersion: 1 });
    await assert.rejects(app.store.readPublished(viewer, { artifactId: first.artifactId }), { code: 'not_found' });
    await assert.rejects(app.admit(app.guest, first.artifactId), { code: 'not_found' });
    assert.deepEqual(await app.db.select().from(artifactShare), []);
  } finally { await app.close(); }
});

test('an admitted guest gets not_found from history, export, reads, other revisions, owner commands, and unshared artifacts', async () => {
  const app = await setup();
  try {
    const first = await app.store.create(app.owner, { requestId: randomUUID(), snapshot: publishedSnapshot, project: 'Clientes' });
    await app.publish(first.artifactId, first.revision.id);
    const draft = await app.store.update(app.owner, { requestId: randomUUID(), artifactId: first.artifactId, expectedRevisionId: first.revision.id, snapshot: { ...publishedSnapshot, content: { kind: 'html', text: '<h1>Second revision</h1>' } } });
    const sibling = await app.store.create(app.owner, { requestId: randomUUID(), snapshot: publishedSnapshot });
    await app.publish(sibling.artifactId, sibling.revision.id);
    await app.share(app.owner, first.artifactId, 'guest@example.test');
    const viewer = await app.admit(app.guest, first.artifactId);
    const { artifactId } = first;
    assert.equal((await app.store.readPublished(viewer, { artifactId })).revision.id, first.revision.id);
    const denied = {
      history: () => app.store.history(app.guest, { artifactId }),
      'export published': () => app.store.export(app.guest, { artifactId, revisionId: first.revision.id }),
      'export draft': () => app.store.export(app.guest, { artifactId, revisionId: draft.revision.id }),
      read: () => app.store.read(app.guest, { artifactId }),
      'read published revision': () => app.store.read(app.guest, { artifactId, revisionId: first.revision.id }),
      'published read of the draft': () => app.store.readPublished(viewer, { artifactId, revisionId: draft.revision.id }),
      update: () => app.store.update(app.guest, { requestId: randomUUID(), artifactId, expectedRevisionId: draft.revision.id, snapshot }),
      publish: () => app.store.publish(app.guest, { requestId: randomUUID(), artifactId, revisionId: draft.revision.id, expectedPublicationVersion: 1 }),
      move: () => app.store.move(app.guest, { requestId: randomUUID(), artifactId, project: null }),
      delete: () => app.store.delete(app.guest, { requestId: randomUUID(), artifactId, expectedRevisionId: draft.revision.id, expectedPublicationVersion: 1 }),
      'list shares': () => app.store.listShares(app.guest, { artifactId }),
      share: () => app.share(app.guest, artifactId, 'friend@example.test'),
      'grant for an unshared artifact': () => app.admit(app.guest, sibling.artifactId),
      'viewer moved to an unshared artifact': () => app.store.readPublished({ ...viewer, artifactId: sibling.artifactId }, { artifactId: sibling.artifactId }),
    };
    for (const [name, attempt] of Object.entries(denied)) await assert.rejects(attempt(), { code: 'not_found' }, name);
    assert.deepEqual((await app.store.list(app.guest)).items, []);
    assert.deepEqual((await app.store.projects(app.guest)).items, []);
    await app.publish(artifactId, draft.revision.id, 1);
    assert.equal((await app.store.readPublished(viewer, { artifactId })).revision.id, draft.revision.id);
    await assert.rejects(app.store.readPublished(viewer, { artifactId, revisionId: first.revision.id }), { code: 'not_found' });
  } finally { await app.close(); }
});

test('the owner path is unchanged: an owner reads the full ArtifactRead whether or not the email is verified or shared', async () => {
  const app = await setup();
  try {
    const [owner] = await app.db.select().from(user).where(eq(user.id, app.ownerId));
    assert.equal(owner.emailVerified, false);
    const first = await app.store.create(app.owner, { requestId: randomUUID(), snapshot: publishedSnapshot, project: 'Clientes' });
    await assert.rejects(app.admit(app.owner, first.artifactId), { code: 'not_found', message: 'Artifact is not published' });
    await app.publish(first.artifactId, first.revision.id);
    await app.store.update(app.owner, { requestId: randomUUID(), artifactId: first.artifactId, expectedRevisionId: first.revision.id, snapshot });
    const full = await app.store.read(app.owner, { artifactId: first.artifactId, revisionId: first.revision.id });
    const published = await app.store.readPublished(await app.admit(app.owner, first.artifactId), { artifactId: first.artifactId });
    assert.deepEqual(published, full);
    assert.equal(JSON.stringify(published), JSON.stringify(full), 'owner JSON matches the owner read byte for byte');
    assert.deepEqual(Object.keys(published), ['artifactId', 'ownerId', 'headRevisionId', 'project', 'publication', 'revision'], 'owner top-level key order matches S1');
    assert.deepEqual(Object.keys(published.publication!), ['revisionId', 'version', 'url'], 'owner publication key order matches S1');
    assert.deepEqual(Object.keys(published.revision), ['id', 'parentRevisionId', 'sequence', 'authorUserId', 'authorClientId', 'createdAt', 'sha256', 'snapshot'], 'owner revision key order matches S1');
    await app.verify(app.owner, true);
    await app.share(app.owner, first.artifactId, 'owner@example.test');
    assert.deepEqual(await app.store.readPublished(await app.admit(app.owner, first.artifactId), { artifactId: first.artifactId }), full);
  } finally { await app.close(); }
});

test('owner publication responses preserve current main document, content and attachment bytes', async () => {
  const fixture = {
    artifactId: 'artifact-a', ownerId: 'owner-a', headRevisionId: 'revision-2', project: 'Clientes', publication: { revisionId: 'revision-1', version: 2, url: 'https://publication.example.test/a/artifact-a' },
    revision: { id: 'revision-1', parentRevisionId: null, sequence: 1, authorUserId: 'owner-a', authorClientId: 'client-a', createdAt: '2026-01-01T00:00:00.000Z', sha256: 'a'.repeat(64), snapshot: { metadata: { title: 'Owner document', description: 'Owner bytes', custom: { audience: 'owner' } }, content: { kind: 'html', text: '<h1>Owner bytes</h1>' }, files: [{ path: 'notes.txt', mediaType: 'text/plain', encoding: 'utf8', data: 'Owner attachment.\n' }] } },
  };
  const { worker, open } = stubbedWorker(async () => Response.json(fixture));
  const cookie = await open();
  const chrome = 'Mozilla/5.0 Chrome/154.0.0.0 Safari/537.36';
  const firefox = 'Mozilla/5.0 Firefox/152.0';
  const trunk = {
    'document chrome': ['/a/artifact-a', { 'user-agent': chrome }, 'b496c2e5c39bfb33d6b3067254b16d8cf9c557fbc0d3b35724c35389a2387f56', '2112e8cc538b94315c53d41727626486783661ef8fad44f3790ec82d11f7839e'],
    'document firefox': ['/a/artifact-a', { 'user-agent': firefox }, '2267388758feadde1f1b9337eb473204da26f0005f0675c770ad2d906276da1d', '2112e8cc538b94315c53d41727626486783661ef8fad44f3790ec82d11f7839e'],
    'content chrome': ['/a/artifact-a/r/revision-1/content', { 'user-agent': chrome, 'sec-fetch-dest': 'iframe' }, 'e57c5fe3812eedcc2548d1fc2810317bf0788e0fec03255aff808341df6fce0a', '890084d63cbd10604c34d16c30c212f776cb017092fb54a4213cb9e7bff69baf'],
    'content firefox': ['/a/artifact-a/r/revision-1/content', { 'user-agent': firefox, 'sec-fetch-dest': 'iframe' }, '91cb14088fd3a2d934e17c6181cc3a7232649a16ebecaaf8a818befa8a957fa8', '67f49211de7298a23e5c65ae4c68d18417deb98e83b3365d78a613d97ac268c1'],
    file: ['/a/artifact-a/r/revision-1/files/notes.txt', {}, '0e54cea37ef73ea17d1c7a0b959f535b01292aa4f02b8abe9a55ee86a102ef2f', '7fec148ca4fb9a57917ac5e1cde34c647c1aa7d3a9c0fcd5e79e8dbae49e9a56'],
  } as const;
  for (const [name, [path, headers, body, headerList]] of Object.entries(trunk)) {
    const response = await worker(new Request(`https://publication.example.test${path}`, { headers: { cookie, ...headers } }));
    assert.equal(response.status, 200, name);
    assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), body, `${name} body matches main`);
    assert.equal(createHash('sha256').update([...response.headers].filter(([key]) => key !== 'set-cookie').map(([key, value]) => `${key}: ${value}`).join('\n')).digest('hex'), headerList, `${name} headers match main`);
  }
});

test('the publication Worker fails closed on a guest-shaped response with owner fields or an owner-shaped response for another user', async () => {
  const shared = { artifactId: 'artifact-a', publication: { revisionId: 'revision-1', version: 1, url: 'https://publication.example.test/a/artifact-a' }, revision: { id: 'revision-1', createdAt: '2026-01-01T00:00:00.000Z', sha256: 'a'.repeat(64), snapshot: publishedSnapshot } };
  const owned = { ...shared, ownerId: 'owner-a', headRevisionId: 'revision-1', project: null, revision: { ...shared.revision, parentRevisionId: null, sequence: 1, authorUserId: 'owner-a', authorClientId: 'client-a' } };
  const cases = {
    'guest shape': [shared, 200],
    'owner shape for the viewer': [owned, 200],
    'guest shape with ownerId': [{ ...shared, ownerId: 'owner-a' }, 503],
    'guest shape with project': [{ ...shared, project: 'Clientes' }, 503],
    'guest shape with email': [{ ...shared, email: 'owner@example.test' }, 503],
    'guest shape with authorUserId': [{ ...shared, revision: { ...shared.revision, authorUserId: 'owner-a' } }, 503],
    'owner shape for another user': [{ ...owned, ownerId: 'owner-b' }, 503],
  } as const;
  for (const [name, [body, status]] of Object.entries(cases)) {
    const { worker, open } = stubbedWorker(async () => Response.json(body));
    const response = await worker(new Request('https://publication.example.test/a/artifact-a', { headers: { cookie: await open() } }));
    assert.equal(response.status, status, name);
    if (status === 503) assert(!(await response.text()).includes('Quarterly plan'), name);
  }
});

test('the real publication Worker accepts a missing legacy name and escapes the current guest attribution', async () => {
  const shared = { artifactId: 'artifact-a', publication: { revisionId: 'revision-1', version: 1, url: 'https://publication.example.test/a/artifact-a' }, revision: { id: 'revision-1', createdAt: '2026-01-01T00:00:00.000Z', sha256: 'a'.repeat(64), snapshot: publishedSnapshot } };
  for (const [body, name] of [[shared, 'Usuario de Artifacts'], [{ ...shared, ownerName: '<script>bad</script> & Ana' }, '&lt;script&gt;bad&lt;/script&gt; &amp; Ana']] as const) {
    const { worker, open } = stubbedWorker(async () => Response.json(body));
    const response = await worker(new Request('https://publication.example.test/a/artifact-a', { headers: { cookie: await open() } }));
    assert.equal(response.status, 200);
    const html = await response.text();
    assert(html.includes(`Compartido por ${name}`));
    assert(html.includes('href="https://panel.example.test/#shared-with-me"'));
    assert(!html.includes('<script>bad</script>'));
  }
});

test('raw guest publication output always contains the current normalized owner name and rechecks email changes', async () => {
  const app = await setup();
  try {
    const first = await app.store.create(app.owner, { requestId: randomUUID(), snapshot: publishedSnapshot });
    await app.publish(first.artifactId, first.revision.id);
    await app.share(app.owner, first.artifactId, 'guest@example.test');
    const viewer = await app.admit(app.guest, first.artifactId);
    for (const [stored, expected] of [['  Ana <Equipo>  ', 'Ana <Equipo>'], ['  ', 'Usuario de Artifacts']]) {
      await app.db.update(user).set({ name: stored }).where(eq(user.id, app.ownerId));
      const read = await app.store.readPublished(viewer, { artifactId: first.artifactId });
      assert.deepEqual(read, { artifactId: first.artifactId, ownerName: expected, publication: { revisionId: first.revision.id, version: 1, url: `${publishOrigin}/a/${first.artifactId}` }, revision: { id: first.revision.id, createdAt: first.revision.createdAt, sha256: first.revision.sha256, snapshot: publishedSnapshot } });
    }
    await app.db.update(user).set({ email: 'changed@example.test' }).where(eq(user.id, app.guest.userId));
    await assert.rejects(app.store.readPublished(viewer, { artifactId: first.artifactId }), { code: 'not_found' });
  } finally { await app.close(); }
});

test('the publication Worker admits a shared guest without owner details and clears the viewer cookie after revocation', async () => {
  const app = await setup();
  try {
    const environment = { DASHBOARD_URL: 'https://panel.example.test', PUBLISH_URL: publishOrigin, PUBLICATION_SERVICE_SECRET: 's'.repeat(40), PUBLICATION_COOKIE_SECRET: 'c'.repeat(40) };
    const backend: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      if (!publicationServiceAuthorized(request, environment.PUBLICATION_SERVICE_SECRET)) return new Response('Access denied', { status: 403 });
      try {
        if (new URL(request.url).pathname === '/internal/publication/consume') return Response.json(await app.store.consumePublicationGrant(consumeGrantSchema.parse(await request.json())));
        const { viewer, ...input } = publicationReadSchema.parse(await request.json());
        return Response.json(await app.store.readPublished(viewer, input));
      } catch (error) { return artifactErrorResponse(error); }
    };
    const worker = createPublicationApp(environment, backend);
    async function open(actor: Actor, artifactId: string) {
      const begin = await worker(new Request(`${publishOrigin}/a/${artifactId}`));
      assert.equal(begin.status, 303);
      const state = new URL(begin.headers.get('location')!).searchParams.get('state')!;
      const { code } = await app.store.issuePublicationGrant(actor, { artifactId, state });
      const callback = await worker(new Request(`${publishOrigin}/callback?${new URLSearchParams({ artifactId, state, code })}`, { headers: { cookie: cookieHeader(begin) } }));
      assert.equal(callback.status, 303);
      return viewerCookie(callback);
    }
    const first = await app.store.create(app.owner, { requestId: randomUUID(), snapshot: publishedSnapshot, project: 'Clientes' });
    await app.publish(first.artifactId, first.revision.id);
    const shared = await app.share(app.owner, first.artifactId, 'guest@example.test');
    const page = (cookie: string, path = '') => worker(new Request(`${publishOrigin}/a/${first.artifactId}${path}`, { headers: { cookie, 'sec-fetch-dest': path.endsWith('/content') ? 'iframe' : 'document' } }));
    const ownerCookie = await open(app.owner, first.artifactId);
    const ownerPage = await page(ownerCookie);
    assert.equal(ownerPage.status, 200);
    assert((await ownerPage.text()).includes('<span>Clientes</span>'));
    const guestCookie = await open(app.guest, first.artifactId);
    const guestPage = await page(guestCookie);
    assert.equal(guestPage.status, 200);
    const html = await guestPage.text();
    assert(html.includes(`data-revision-id="${first.revision.id}"`));
    for (const ownerDetail of ['Clientes', app.ownerId, 'sharing-test', 'Cliente autor', 'Revisión 1']) assert(!html.includes(ownerDetail), ownerDetail);
    assert.equal(await (await page(guestCookie, `/r/${first.revision.id}/files/notes.txt`)).text(), 'Shared attachment.\n');
    await app.store.unshare(app.owner, { requestId: randomUUID(), artifactId: first.artifactId, shareId: shared.shareId });
    for (const path of ['', `/r/${first.revision.id}/content`, `/r/${first.revision.id}/files/notes.txt`]) {
      const revoked = await page(guestCookie, path);
      assert.equal(revoked.status, 403, path);
      assert.equal(await revoked.text(), 'Tu sesión o esta publicación ya no están disponibles.');
      assert(revoked.headers.getSetCookie().some((value) => value.startsWith(`${guestCookie.split('=')[0]}=;`) && value.includes('Max-Age=0')), path);
    }
    assert.equal((await page(ownerCookie)).status, 200);
  } finally { await app.close(); }
});
