import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { artifact, artifactCommand, artifactPublication, artifactRevision, session } from '../packages/db/src/schema.ts';
import { createArtifactStore, type Actor, type Snapshot } from '../packages/artifacts/src/index.ts';
import { createPanel } from '../packages/artifacts/src/panel/index.ts';
import { fixture } from './helpers.ts';

async function setup() {
  const app = await fixture();
  const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
  assert(signedIn);
  const actor: Actor = { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'panel-move-test', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
  const options = { publishOrigin: 'https://published.example.test' };
  const store = createArtifactStore(app.db, options);
  const panel = createPanel(app.db, options);
  const create = (title: string, project?: string) => store.create(actor, { requestId: randomUUID(), snapshot: { metadata: { title, description: '' }, content: { kind: 'text', text: title }, files: [] } satisfies Snapshot, project });
  const immutable = async () => ({ revisions: await app.db.select().from(artifactRevision), publications: await app.db.select().from(artifactPublication), heads: (await app.db.select().from(artifact)).map(({ project: _, ...row }) => row) });
  return { app, actor, store, panel, create, immutable };
}

test('panel move atomically moves one and three IDs, resolves spelling and preserves all revision and publication data', async () => {
  const { app, actor, store, panel, create, immutable } = await setup();
  try {
    const a = await create('A', 'Éxito');
    const b = await create('B');
    const c = await create('C');
    await store.publish(actor, { requestId: randomUUID(), artifactId: a.artifactId, revisionId: a.headRevisionId, expectedPublicationVersion: 0 });
    const before = await immutable();
    assert.deepEqual(await panel.move(actor, { requestId: randomUUID(), artifactIds: [b.artifactId], project: '  éxito ' }), { project: 'Éxito', moved: 1, unchanged: 0, missing: [] });
    assert.deepEqual(await panel.move(actor, { requestId: randomUUID(), artifactIds: [a.artifactId, b.artifactId, c.artifactId], project: 'Éxito' }), { project: 'Éxito', moved: 1, unchanged: 2, missing: [] });
    assert.deepEqual(await panel.move(actor, { requestId: randomUUID(), artifactIds: [a.artifactId, b.artifactId, c.artifactId], project: 'Created by move' }), { project: 'Created by move', moved: 3, unchanged: 0, missing: [] });
    assert.deepEqual(await store.projects(actor), { items: [{ name: 'Created by move', artifactCount: 3 }] });
    assert.deepEqual(await immutable(), before);
    const subject = await panel.moveSubject(actor, [b.artifactId, a.artifactId]);
    assert.deepEqual(subject.items.map(({ title, project }) => ({ title, project })).sort((a, b) => a.title.localeCompare(b.title)), [{ title: 'A', project: 'Created by move' }, { title: 'B', project: 'Created by move' }]);
    assert.equal(subject.workspace.total.count, 3);
    assert.deepEqual(await panel.move(actor, { requestId: randomUUID(), artifactIds: [a.artifactId, b.artifactId, c.artifactId], project: null }), { project: null, moved: 3, unchanged: 0, missing: [] });
    assert.deepEqual(await store.projects(actor), { items: [] });
  } finally { await app.close(); }
});

test('missing IDs are submitted IDs only and a batch receipt survives deletion and reassignment', async () => {
  const { app, actor, store, panel, create } = await setup();
  try {
    const a = await create('A');
    const b = await create('B');
    const foreign = await create('Foreign title', 'Foreign project');
    const other = await app.auth.api.signUpEmail({ body: { name: 'Other', email: 'other@example.test', password: app.password } });
    await app.db.update(artifact).set({ ownerId: other.user.id }).where(eq(artifact.id, foreign.artifactId));
    const input = { requestId: randomUUID(), artifactIds: [b.artifactId, 'deleted-id', a.artifactId, foreign.artifactId, b.artifactId], project: 'Gamma' };
    const expected = { project: 'Gamma', moved: 2, unchanged: 0, missing: ['deleted-id', foreign.artifactId].sort() };
    assert.deepEqual(await panel.move(actor, input), expected);
    const subject = await panel.moveSubject(actor, [foreign.artifactId, 'deleted-id']);
    assert.deepEqual(subject.items, []);
    assert.deepEqual(subject.workspace.projects.map(({ name }) => name), ['Gamma']);
    await store.delete(actor, { artifactId: a.artifactId, expectedRevisionId: a.headRevisionId, expectedPublicationVersion: 0, requestId: randomUUID() });
    await store.move(actor, { artifactId: b.artifactId, project: 'Delta', requestId: randomUUID() });
    assert.deepEqual(await panel.move(actor, { ...input, artifactIds: [...input.artifactIds].reverse(), project: ' Gamma ' }), expected);
    assert.equal((await store.read(actor, { artifactId: b.artifactId })).project, 'Delta');
    const [receipt] = await app.db.select().from(artifactCommand).where(eq(artifactCommand.requestId, input.requestId));
    assert.deepEqual(JSON.parse(receipt.result), expected);
    assert.deepEqual(await panel.move(actor, { requestId: randomUUID(), artifactIds: ['gone', foreign.artifactId], project: null }), { project: null, moved: 0, unchanged: 0, missing: ['gone', foreign.artifactId].sort() });
    await assert.rejects(panel.move(actor, { ...input, project: 'Delta' }), { code: 'request_conflict' });
    await assert.rejects(panel.move(actor, { ...input, artifactIds: [b.artifactId] }), { code: 'request_conflict' });
  } finally { await app.close(); }
});

test('normalization precedes receipt hashing and command kinds remain distinct', async () => {
  const { app, actor, store, panel, create } = await setup();
  try {
    const a = await create('A', 'Gamma');
    const input = { requestId: randomUUID(), artifactIds: [a.artifactId], project: 'gAMMA' };
    assert.deepEqual(await panel.move(actor, input), { project: 'Gamma', moved: 0, unchanged: 1, missing: [] });
    await store.move(actor, { requestId: randomUUID(), artifactId: a.artifactId, project: null });
    assert.deepEqual(await panel.move(actor, input), { project: 'Gamma', moved: 0, unchanged: 1, missing: [] });
    const requestId = randomUUID();
    assert.deepEqual(await store.move(actor, { requestId, artifactId: a.artifactId, project: 'Public' }), { artifactId: a.artifactId, project: 'Public' });
    await assert.rejects(panel.move(actor, { requestId, artifactIds: [a.artifactId], project: 'Public' }), { code: 'request_conflict' });
    await assert.rejects(store.move(actor, { requestId: input.requestId, artifactId: a.artifactId, project: 'gAMMA' }), { code: 'request_conflict' });
  } finally { await app.close(); }
});

test('panel validation caps unique IDs at 25, validates every ID and authorizes before replay', async () => {
  const { app, actor, panel } = await setup();
  try {
    const input = { requestId: randomUUID(), artifactIds: Array.from({ length: 25 }, (_, i) => `id-${i}`), project: null };
    assert.deepEqual(await panel.move(actor, input), { project: null, moved: 0, unchanged: 0, missing: [...input.artifactIds].sort() });
    assert.deepEqual(await panel.move(actor, { ...input, artifactIds: [...input.artifactIds, input.artifactIds[0]] }), { project: null, moved: 0, unchanged: 0, missing: [...input.artifactIds].sort() });
    for (const artifactIds of [[], [''], ['x'.repeat(129)], [...input.artifactIds, 'id-26']]) await assert.rejects(panel.move(actor, { ...input, artifactIds }));
    await assert.rejects(panel.move({ ...actor, scopes: ['artifacts:read'] }, input), { code: 'forbidden' });
    await assert.rejects(panel.moveSubject({ ...actor, scopes: ['artifacts:write'] }, ['id']), { code: 'forbidden' });
    await app.db.delete(session).where(eq(session.id, actor.sessionId));
    await assert.rejects(panel.move(actor, input), { code: 'forbidden' });
    await assert.rejects(panel.moveSubject(actor, ['id']), { code: 'forbidden' });
  } finally { await app.close(); }
});

test('a genuine receipt INSERT failure rolls back every selected row and identical retry converges', async () => {
  const { app, actor, panel, create, immutable } = await setup();
  try {
    const a = await create('A', 'Original');
    const b = await create('B');
    const input = { requestId: randomUUID(), artifactIds: [a.artifactId, b.artifactId], project: 'New' };
    const before = await app.db.select().from(artifact);
    const fixed = await immutable();
    await app.client.execute(`CREATE TRIGGER fail_panel_receipt BEFORE INSERT ON artifact_command WHEN NEW.owner_id = '${actor.userId}' AND NEW.request_id = '${input.requestId}' BEGIN SELECT RAISE(FAIL, 'panel receipt failure'); END`);
    try { await assert.rejects(panel.move(actor, input), (error: unknown) => error instanceof Error && error.cause instanceof Error && error.cause.message.includes('panel receipt failure')); }
    finally { await app.client.execute('DROP TRIGGER fail_panel_receipt'); }
    assert.deepEqual(await app.db.select().from(artifact), before);
    assert.deepEqual(await app.db.select().from(artifactCommand).where(eq(artifactCommand.requestId, input.requestId)), []);
    const expected = { project: 'New', moved: 2, unchanged: 0, missing: [] };
    assert.deepEqual(await panel.move(actor, input), expected);
    assert.deepEqual(await panel.move(actor, input), expected);
    assert.deepEqual(await immutable(), fixed);
    assert.equal((await app.db.select().from(artifactCommand).where(eq(artifactCommand.requestId, input.requestId))).length, 1);
  } finally { await app.close(); }
});
