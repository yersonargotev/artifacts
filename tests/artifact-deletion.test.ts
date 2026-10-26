import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { artifact, artifactCommand, artifactPublication, artifactRevision, publicationGrant, session } from '../packages/db/src/schema.ts';
import { createArtifactStore, type Actor, type Snapshot } from '../packages/artifacts/src/index.ts';
import { openDatabase } from '../packages/db/src/index.ts';
import { fixture } from './helpers.ts';

const snapshot: Snapshot = { metadata: { title: 'Delete me', description: 'private metadata' }, content: { kind: 'html', text: '<p>private content</p>' }, files: [{ path: 'secret.txt', mediaType: 'text/plain', encoding: 'utf8', data: 'private attachment' }] };
async function setup() {
  const app = await fixture();
  const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
  assert(signedIn);
  const actor: Actor = { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'delete-test', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
  return { ...app, actor, store: createArtifactStore(app.db, { publishOrigin: 'https://published.example.test' }) };
}
const creation = () => ({ requestId: randomUUID(), snapshot });
const deletion = (read: { artifactId: string; headRevisionId: string; publication: { version: number } | null }) => ({ requestId: randomUUID(), artifactId: read.artifactId, expectedRevisionId: read.headRevisionId, expectedPublicationVersion: read.publication?.version ?? 0 });

test('deletion cascades revisions, older publication and grants, erases receipts and blocks old retries', async () => {
  const app = await setup();
  try {
    const create = creation();
    const first = await app.store.create(app.actor, create);
    const publish = { requestId: randomUUID(), artifactId: first.artifactId, revisionId: first.revision.id, expectedPublicationVersion: 0 };
    await app.store.publish(app.actor, publish);
    const update = { requestId: randomUUID(), artifactId: first.artifactId, expectedRevisionId: first.revision.id, snapshot };
    const second = await app.store.update(app.actor, update);
    const state = randomUUID();
    const admitted = await app.store.issuePublicationGrant(app.actor, { artifactId: first.artifactId, state });
    const viewer = await app.store.consumePublicationGrant({ artifactId: first.artifactId, state, code: admitted.code });
    const pending = await app.store.issuePublicationGrant(app.actor, { artifactId: first.artifactId, state });
    const before = await app.db.select().from(artifactCommand);
    const command = deletion(second);
    assert.deepEqual(await app.store.delete(app.actor, command), { artifactId: first.artifactId });
    assert.deepEqual(await app.store.delete(app.actor, command), { artifactId: first.artifactId });
    for (const table of [artifact, artifactRevision, artifactPublication, publicationGrant]) assert.deepEqual(await app.db.select().from(table), []);
    const receipts = await app.db.select().from(artifactCommand);
    assert.equal(receipts.length, 4);
    for (const previous of before) {
      const receipt = receipts.find((row) => row.requestId === previous.requestId)!;
      assert.deepEqual(JSON.parse(receipt.result), { kind: 'artifact_deleted', artifactId: first.artifactId });
      assert.equal(receipt.payloadHash, '');
      assert.deepEqual(receipt.createdAt, previous.createdAt);
    }
    assert(!JSON.stringify(receipts).includes('private'));
    for (const retry of [() => app.store.create(app.actor, create), () => app.store.update(app.actor, update), () => app.store.publish(app.actor, publish), () => app.store.delete(app.actor, deletion(second)), () => app.store.readPublished(viewer, { artifactId: first.artifactId })]) await assert.rejects(retry(), { code: 'not_found' });
    await assert.rejects(app.store.consumePublicationGrant({ artifactId: first.artifactId, state, code: pending.code }), { code: 'invalid_grant' });
    await assert.rejects(app.store.create(app.actor, { ...create, snapshot: { ...snapshot, files: [] } }), { code: 'not_found' });
    assert.deepEqual(await app.db.select().from(artifact), []);
  } finally { await app.close(); }
});

test('deletion checks authority before replay and permits another live session of the same owner', async () => {
  const app = await setup();
  try {
    const first = await app.store.create(app.actor, creation());
    const command = deletion(first);
    const outsider = await app.auth.api.signUpEmail({ body: { name: 'Other', email: 'other@example.test', password: app.password } });
    await app.auth.api.signInEmail({ body: { email: 'other@example.test', password: app.password } });
    const [otherSession] = await app.db.select().from(session).where(eq(session.userId, outsider.user.id));
    const other = { ...app.actor, userId: outsider.user.id, sessionId: otherSession.id };
    await assert.rejects(app.store.delete(other, command), { code: 'not_found' });
    const otherCreate = creation();
    const otherArtifact = await app.store.create(other, otherCreate);
    await assert.rejects(app.store.delete({ ...app.actor, scopes: ['artifacts:read'] }, command), { code: 'forbidden' });
    const unrelatedReceipt = { ownerId: other.userId, requestId: randomUUID(), payloadHash: 'other-owner-receipt', result: JSON.stringify(first), createdAt: new Date() };
    await app.db.insert(artifactCommand).values(unrelatedReceipt);
    await app.store.delete(app.actor, command);
    const [preserved] = await app.db.select().from(artifactCommand).where(eq(artifactCommand.requestId, unrelatedReceipt.requestId));
    assert.equal(preserved.result, unrelatedReceipt.result);
    await app.auth.api.signInEmail({ body: { email: 'owner@example.test', password: app.password } });
    const sessions = await app.db.select().from(session).where(eq(session.userId, app.actor.userId));
    const next = sessions.find((row) => row.id !== app.actor.sessionId)!;
    assert(next);
    assert.deepEqual(await app.store.delete({ ...app.actor, sessionId: next.id }, command), { artifactId: first.artifactId });
    assert.deepEqual(await app.store.create(other, otherCreate), otherArtifact);
    await app.db.delete(session).where(eq(session.id, app.actor.sessionId));
    await assert.rejects(app.store.delete(app.actor, command), { code: 'forbidden' });
    await assert.rejects(app.store.delete({ ...app.actor, sessionId: 'missing' }, command), { code: 'forbidden' });
  } finally { await app.close(); }
});

test('stale head or publication prevents deletion and live receipts retain exact original results', async () => {
  const app = await setup();
  try {
    const create = creation();
    const first = await app.store.create(app.actor, create);
    const initial = deletion(first);
    const update = { requestId: randomUUID(), artifactId: first.artifactId, expectedRevisionId: first.revision.id, snapshot };
    const second = await app.store.update(app.actor, update);
    await assert.rejects(app.store.delete(app.actor, initial), { code: 'conflict' });
    const fresh = deletion(second);
    const publish = { requestId: randomUUID(), artifactId: first.artifactId, revisionId: first.revision.id, expectedPublicationVersion: 0 };
    const published = await app.store.publish(app.actor, publish);
    await assert.rejects(app.store.delete(app.actor, fresh), { code: 'conflict' });
    assert.deepEqual(await app.store.create(app.actor, create), first);
    assert.deepEqual(await app.store.update(app.actor, update), second);
    assert.deepEqual(await app.store.publish(app.actor, publish), published);
    assert.equal((await app.store.read(app.actor, { artifactId: first.artifactId })).headRevisionId, second.headRevisionId);
  } finally { await app.close(); }
});

test('competing delete and update serialize without deleting an unseen successful update', async () => {
  const app = await setup();
  const connection = await openDatabase({ url: app.databaseUrl });
  try {
    const other = createArtifactStore(connection.db, { publishOrigin: 'https://published.example.test' });
    const first = await app.store.create(app.actor, creation());
    const outcomes = await Promise.allSettled([
      app.store.delete(app.actor, deletion(first)),
      other.update(app.actor, { requestId: randomUUID(), artifactId: first.artifactId, expectedRevisionId: first.revision.id, snapshot }),
    ]);
    assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
    const failure = outcomes.find((result) => result.status === 'rejected');
    assert(failure?.status === 'rejected');
    assert(['conflict', 'not_found'].includes(failure.reason.code));
    if (outcomes[1].status === 'fulfilled') assert.equal((await app.store.read(app.actor, { artifactId: first.artifactId })).headRevisionId, outcomes[1].value.headRevisionId);
  } finally { connection.client.close(); await app.close(); }
});

test('malformed associated receipts abort deletion and only exact private markers block replay', async () => {
  const app = await setup();
  try {
    const create = creation();
    const first = await app.store.create(app.actor, create);
    await app.db.update(artifactCommand).set({ result: JSON.stringify({ artifactId: first.artifactId, kind: 'artifact_deleted', extra: true }) }).where(eq(artifactCommand.requestId, create.requestId));
    await assert.rejects(app.store.create(app.actor, create), (error: Error) => error.name === 'ZodError');
    await app.db.update(artifactCommand).set({ result: '{invalid JSON' }).where(eq(artifactCommand.requestId, create.requestId));
    await assert.rejects(app.store.delete(app.actor, deletion(first)), (error: Error) => error.cause instanceof Error && /malformed JSON/.test(error.cause.message));
    assert.equal((await app.store.read(app.actor, { artifactId: first.artifactId })).artifactId, first.artifactId);
    assert.equal((await app.db.select().from(artifactRevision)).length, 1);
  } finally { await app.close(); }
});


test('competing delete and publication preserve any successful unseen publication', async () => {
  const app = await setup();
  const connection = await openDatabase({ url: app.databaseUrl });
  try {
    const other = createArtifactStore(connection.db, { publishOrigin: 'https://published.example.test' });
    const first = await app.store.create(app.actor, creation());
    const outcomes = await Promise.allSettled([
      app.store.delete(app.actor, deletion(first)),
      other.publish(app.actor, { requestId: randomUUID(), artifactId: first.artifactId, revisionId: first.revision.id, expectedPublicationVersion: 0 }),
    ]);
    assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
    const failure = outcomes.find((result) => result.status === 'rejected');
    assert(failure?.status === 'rejected');
    assert(['conflict', 'not_found'].includes(failure.reason.code));
    if (outcomes[1].status === 'fulfilled') assert.equal((await app.store.read(app.actor, { artifactId: first.artifactId })).publication?.version, 1);
  } finally { connection.client.close(); await app.close(); }
});
