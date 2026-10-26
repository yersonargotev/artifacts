import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { artifactCommand, artifactShare, session } from '../packages/db/src/schema.ts';
import { createArtifactStore, type Actor, type Snapshot } from '../packages/artifacts/src/index.ts';
import { canonicalJson, sha256 } from '../packages/artifacts/src/serialization.ts';
import { fixture } from './helpers.ts';

const snapshot: Snapshot = { metadata: { title: 'Shared artifact', description: '' }, content: { kind: 'html', text: '<p>shared</p>' }, files: [] };

async function setup() {
  const app = await fixture();
  const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
  assert(signedIn);
  const owner: Actor = { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'sharing-test', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
  const store = createArtifactStore(app.db, { publishOrigin: 'https://published.example.test' });
  const outsider = await app.auth.api.signUpEmail({ body: { name: 'Outsider', email: 'outsider@example.test', password: app.password } });
  await app.auth.api.signInEmail({ body: { email: 'outsider@example.test', password: app.password } });
  const [outsiderSession] = await app.db.select().from(session).where(eq(session.userId, outsider.user.id));
  const other: Actor = { ...owner, userId: outsider.user.id, sessionId: outsiderSession.id };
  const create = async (actor: Actor) => (await store.create(actor, { requestId: randomUUID(), snapshot })).artifactId;
  const share = (actor: Actor, artifactId: string, email: string) => store.share(actor, { requestId: randomUUID(), artifactId, email });
  return { ...app, owner, other, store, create, share };
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
