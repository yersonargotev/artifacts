import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createArtifactStore, type Actor, type Snapshot } from '../packages/artifacts/src/index.ts';
import { parseMoveForm, submitMove, type MoveForm } from '../apps/dashboard/src/move.ts';
import { fixture } from './helpers.ts';

const snapshot = (title: string): Snapshot => ({ metadata: { title, description: '' }, content: { kind: 'text', text: title }, files: [] });
const request = (artifactId: string, body: string, contentType = 'application/x-www-form-urlencoded') => new Request(`https://panel.example.test/artifacts/${artifactId}/move`, { method: 'POST', headers: { 'content-type': contentType }, body });
const encode = (form: MoveForm) => new URLSearchParams(form).toString();

async function setup() {
  const app = await fixture();
  const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
  assert(signedIn);
  const actor: Actor = { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'panel-move-test', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
  const store = createArtifactStore(app.db, { publishOrigin: 'https://published.example.test' });
  const submit = async (form: MoveForm) => submitMove(store, actor, await parseMoveForm(request(form.artifactId, encode(form)), form.artifactId));
  const project = async (artifactId: string) => (await store.read(actor, { artifactId })).project;
  return { app, actor, store, submit, project };
}

test('move forms preserve the exact submitted fields', async () => {
  const form: MoveForm = { artifactId: 'artifact-one', requestId: 'move-request-one', project: '  Client onboarding ', intent: 'move' };
  assert.deepEqual(await parseMoveForm(request('artifact-one', encode(form)), 'artifact-one'), form);
  assert.deepEqual(await parseMoveForm(request('artifact-one', encode({ ...form, intent: 'remove' })), 'artifact-one'), { ...form, intent: 'remove' });
});

test('move form rejects extra, repeated, missing, malformed, oversized or mismatched values', async () => {
  const fields = encode({ artifactId: 'artifact-one', requestId: 'move-request-one', project: 'Gamma', intent: 'move' });
  const invalid = [
    `${fields}&ownerId=intruder`, `${fields}&project=Delta`, fields.replace('project=Gamma&', ''), fields.replace('intent=move', 'intent=archive'),
    fields.replace('move-request-one', 'short'), fields.replace('Gamma', '%ZZ'), fields.replace('Gamma', '%C0%AF'), fields.replace('Gamma', 'x'.repeat(5000)),
  ];
  for (const body of invalid) await assert.rejects(parseMoveForm(request('artifact-one', body), 'artifact-one'), (error: unknown) => error instanceof Response && error.status === 400);
  await assert.rejects(parseMoveForm(request('artifact-one', fields), 'other-artifact'), (error: unknown) => error instanceof Response && error.status === 400);
  await assert.rejects(parseMoveForm(request('artifact-one', fields, 'application/json'), 'artifact-one'), (error: unknown) => error instanceof Response && error.status === 400);
});

test('panel moves reuse an existing spelling, remove the project and keep the head revision', async () => {
  const { app, store, actor, submit, project } = await setup();
  try {
    await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Filed'), project: 'Gamma' });
    const loose = await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Loose') });
    assert.deepEqual(await submit({ artifactId: loose.artifactId, requestId: randomUUID(), project: '  gAMMA ', intent: 'move' }), { kind: 'moved', location: '/?project=Gamma' });
    assert.equal(await project(loose.artifactId), 'Gamma');
    assert.deepEqual(await store.projects(actor), { items: [{ name: 'Gamma', artifactCount: 2 }] });
    assert.deepEqual(await submit({ artifactId: loose.artifactId, requestId: randomUUID(), project: 'Client onboarding', intent: 'move' }), { kind: 'moved', location: '/?project=Client+onboarding' });
    assert.deepEqual(await submit({ artifactId: loose.artifactId, requestId: randomUUID(), project: 'Ignored on removal', intent: 'remove' }), { kind: 'moved', location: '/' });
    const removed = await store.read(actor, { artifactId: loose.artifactId });
    assert.equal(removed.project, null);
    assert.equal(removed.headRevisionId, loose.headRevisionId);
    assert.deepEqual(await store.projects(actor), { items: [{ name: 'Gamma', artifactCount: 1 }] });
  } finally { await app.close(); }
});

test('an invalid project name writes nothing and leaves the retained request unused', async () => {
  const { app, store, actor, submit, project } = await setup();
  try {
    const loose = await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Loose') });
    const form: MoveForm = { artifactId: loose.artifactId, requestId: randomUUID(), project: '   ', intent: 'move' };
    for (const name of ['   ', 'x'.repeat(81), 'Tab\tname']) assert.deepEqual(await submit({ ...form, project: name }), { kind: 'invalid' });
    assert.equal(await project(loose.artifactId), null);
    assert.deepEqual(await store.projects(actor), { items: [] });
    assert.deepEqual(await submit({ ...form, project: 'Gamma' }), { kind: 'moved', location: '/?project=Gamma' });
  } finally { await app.close(); }
});

test('a resubmitted form replays its receipt instead of moving again, and a changed one conflicts', async () => {
  const { app, store, actor, submit, project } = await setup();
  try {
    const loose = await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Loose') });
    const form: MoveForm = { artifactId: loose.artifactId, requestId: randomUUID(), project: 'Gamma', intent: 'move' };
    assert.deepEqual(await submit(form), { kind: 'moved', location: '/?project=Gamma' });
    await store.move(actor, { requestId: randomUUID(), artifactId: loose.artifactId, project: 'Delta' });
    assert.deepEqual(await submit(form), { kind: 'moved', location: '/?project=Gamma' });
    assert.equal(await project(loose.artifactId), 'Delta');
    assert.deepEqual(await submit({ ...form, project: 'Epsilon' }), { kind: 'conflict' });
    assert.deepEqual(await submit({ ...form, intent: 'remove' }), { kind: 'conflict' });
    assert.equal(await project(loose.artifactId), 'Delta');
    await assert.rejects(submit({ ...form, artifactId: 'missing-artifact', requestId: randomUUID() }), { code: 'not_found' });
    assert.deepEqual(await submitMove({ move: async () => { throw new Error('connection lost after commit'); } }, actor, form), { kind: 'uncertain' });
  } finally { await app.close(); }
});
