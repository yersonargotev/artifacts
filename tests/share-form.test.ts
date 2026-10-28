import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createArtifactStore, ArtifactError, type Actor } from '../packages/artifacts/src/index.ts';
import { createPanel } from '../packages/artifacts/src/panel/index.ts';
import { loadShareView, parseShareForm, submitShare, encodeShareCommand, type ShareCommand } from '../apps/dashboard/src/share.ts';
import { fixture } from './helpers.ts';

const request = (body: string | Uint8Array, contentType = 'application/x-www-form-urlencoded') => new Request('https://panel.example.test/artifacts/artifact/share', { method: 'POST', headers: { 'content-type': contentType }, body: body as BodyInit });
const encode = (command: ShareCommand) => encodeShareCommand(command).toString();
const command: ShareCommand = { intent: 'share', requestId: 'share-request-one', email: ' Guest@Example.TEST ' };

test('share forms retain the exact submitted payload and parse a revoke without an email', async () => {
  assert.deepEqual(await parseShareForm(request(encode(command))), command);
  const revoke: ShareCommand = { intent: 'unshare', requestId: randomUUID(), shareId: 'share-one' };
  assert.deepEqual(await parseShareForm(request(encode(revoke))), revoke);
  assert.deepEqual(await parseShareForm(request(encode({ ...command, email: 'nope' }))), { ...command, email: 'nope' });
});

test('share parsing rejects body authority, duplicate, unknown, malformed, invalid and excessive fields', async () => {
  const body = encode(command);
  for (const invalid of [
    `${body}&artifactId=foreign`, `${body}&ownerId=foreign`, `${body}&email=other@example.test`, `${body}&requestId=another-request`, `${body}&intent=share`, `${body}&shareId=other`,
    body.replace('intent=share', 'intent=delete'), body.replace('requestId=share-request-one&', ''), body.replace('share-request-one', 'x'), body.replace(/email=.*/, ''),
    body.replace('Guest', '%'), body.replace('Guest', '%ZZ'), body.replace('Guest', '%C0%AF'), body.replace('Guest', 'x'.repeat(4096)),
    'requestId=share-request-one&intent=unshare&shareId=', 'requestId=share-request-one&intent=unshare&shareId=a&shareId=b',
    `requestId=share-request-one&intent=unshare&shareId=${'x'.repeat(129)}`,
  ]) await assert.rejects(parseShareForm(request(invalid)), (error: unknown) => error instanceof Response && error.status === 400);
  for (const type of ['application/json', 'text/plain', 'multipart/form-data']) await assert.rejects(parseShareForm(request(body, type)), (error: unknown) => error instanceof Response && error.status === 400);
  await assert.rejects(parseShareForm(request(new Uint8Array([...Buffer.from(body), 0xc0, 0xaf]))), (error: unknown) => error instanceof Response && error.status === 400);
});

async function setup() {
  const app = await fixture();
  const session = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
  assert(session);
  const actor: Actor = { userId: app.ownerId, sessionId: session.session.id, clientId: 'share-form-test', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
  const options = { access: { ownerEmail: 'owner@example.test', allowGuests: false }, publishOrigin: 'https://publication.example.test' };
  const store = createArtifactStore(app.db, options);
  const panel = createPanel(app.db, options);
  const artifact = await store.create(actor, { requestId: randomUUID(), snapshot: { metadata: { title: 'Shared document', description: '' }, content: { kind: 'text', text: 'Document' }, files: [] } });
  return { app, actor, store, panel, artifactId: artifact.artifactId };
}

test('actual commands normalize, deduplicate, revoke and reconcile historical receipts from the current list', async () => {
  const { app, actor, store, panel, artifactId } = await setup();
  try {
    assert.deepEqual(await submitShare(store, actor, artifactId, command), { outcome: 'confirmed' });
    let view = (await loadShareView(panel, store, actor, artifactId)).view;
    assert.equal(view.title, 'Shared document');
    assert.equal(view.published, false);
    assert.equal(view.shares.kind, 'ready');
    assert(view.shares.kind === 'ready');
    assert.deepEqual(view.shares.items.map(({ value }) => value), ['guest@example.test']);
    const shareId = view.shares.items[0].shareId;
    assert.deepEqual(await submitShare(store, actor, artifactId, { ...command, requestId: randomUUID() }), { outcome: 'confirmed' });
    assert.equal((await store.listShares(actor, { artifactId })).items.length, 1);
    const revoke: ShareCommand = { intent: 'unshare', requestId: randomUUID(), shareId };
    assert.deepEqual(await submitShare(store, actor, artifactId, revoke), { outcome: 'confirmed' });
    assert.deepEqual(await submitShare(store, actor, artifactId, command), { outcome: 'confirmed' });
    assert.deepEqual((await loadShareView(panel, store, actor, artifactId)).view.shares, { kind: 'ready', items: [] });
    assert.deepEqual(await submitShare(store, actor, artifactId, { ...command, requestId: randomUUID() }), { outcome: 'confirmed' });
    assert.deepEqual(await submitShare(store, actor, artifactId, revoke), { outcome: 'confirmed' });
    view = (await loadShareView(panel, store, actor, artifactId)).view;
    assert(view.shares.kind === 'ready');
    assert.equal(view.shares.items.length, 1);
    assert.notEqual(view.shares.items[0].shareId, shareId);
  } finally { await app.close(); }
});

test('ownership precedes semantic email validation and store authority remains live', async () => {
  const { app, actor, store, artifactId } = await setup();
  try {
    const invalid: ShareCommand = { ...command, email: 'nope' };
    assert.deepEqual(await submitShare(store, actor, artifactId, invalid), { outcome: 'invalid' });
    assert.deepEqual((await store.listShares(actor, { artifactId })).items, []);
    for (const id of ['missing-artifact', artifactId]) await assert.rejects(submitShare(store, { ...actor, userId: 'foreign-owner' }, id, invalid), (error: unknown) => error instanceof ArtifactError);
    await assert.rejects(submitShare(store, actor, 'missing-artifact', invalid), (error: unknown) => error instanceof ArtifactError && error.code === 'not_found');
    await assert.rejects(submitShare(store, { ...actor, scopes: ['artifacts:read'] }, artifactId, command), (error: unknown) => error instanceof ArtifactError && error.code === 'forbidden');
    await assert.rejects(submitShare(store, { ...actor, sessionId: 'expired' }, artifactId, command), (error: unknown) => error instanceof ArtifactError && error.code === 'forbidden');
  } finally { await app.close(); }
});

test('lost committed results retain a retry while list failures cannot undo confirmation', async () => {
  const { app, actor, store, panel, artifactId } = await setup();
  try {
    const lost = { ...store, async share(...args: Parameters<typeof store.share>) { await store.share(...args); throw new Error('Injected lost response after actual store commit'); } };
    assert.deepEqual(await submitShare(lost, actor, artifactId, command), { outcome: 'uncertain' });
    assert.equal((await store.listShares(actor, { artifactId })).items.length, 1);
    assert.deepEqual(await submitShare(store, actor, artifactId, command), { outcome: 'confirmed' });
    const unavailable = { ...store, async listShares() { throw new Error('Injected list outage'); } };
    assert.deepEqual((await loadShareView(panel, unavailable, actor, artifactId)).view.shares, { kind: 'unavailable' });
    for (const code of ['forbidden', 'not_found'] as const) await assert.rejects(loadShareView(panel, { ...store, async listShares() { throw new ArtifactError(code, 'Denied'); } }, actor, artifactId), (error: unknown) => error instanceof ArtifactError && error.code === code);
    assert.deepEqual(await submitShare(store, actor, artifactId, { ...command, email: 'other@example.test' }), { outcome: 'conflict' });
  } finally { await app.close(); }
});
