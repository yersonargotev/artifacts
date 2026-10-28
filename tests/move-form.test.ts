import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ArtifactError, createArtifactStore, type Actor, type Snapshot } from '../packages/artifacts/src/index.ts';
import { createPanel } from '../packages/artifacts/src/panel/index.ts';
import { parseMoveForm, prepareMovePage, submitMove, type MoveForm } from '../apps/dashboard/src/move.ts';
import { readForm } from '../apps/dashboard/src/form.ts';
import { fixture } from './helpers.ts';

const snapshot = (title: string): Snapshot => ({ metadata: { title, description: '' }, content: { kind: 'text', text: title }, files: [] });
const request = (body: string | Uint8Array, contentType = 'application/x-www-form-urlencoded') => new Request('https://panel.example.test/move', { method: 'POST', headers: { 'content-type': contentType }, body: body as BodyInit });
const encode = (form: MoveForm) => new URLSearchParams([...form.artifactIds.map((id) => ['artifactId', id]), ['requestId', form.requestId], ...(form.project === undefined ? [] : [['project', form.project]]), ['intent', form.intent]]).toString();
const sample: MoveForm = { artifactIds: ['artifact-one', 'artifact-two', 'artifact-one'], requestId: 'move-request-one', project: '  Client onboarding ', intent: 'move' };
const actor: Actor = { userId: 'owner', sessionId: 'session', clientId: 'panel', scopes: ['artifacts:read', 'artifacts:write'] };

async function setup() {
  const app = await fixture();
  const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
  assert(signedIn);
  const actor: Actor = { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'panel-move-test', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
  const options = { access: { ownerEmail: 'owner@example.test', allowGuests: false }, publishOrigin: 'https://published.example.test' };
  const store = createArtifactStore(app.db, options);
  const panel = createPanel(app.db, options);
  const submit = async (form: MoveForm) => submitMove(panel, actor, await parseMoveForm(request(encode(form))));
  return { app, actor, store, panel, submit };
}

test('move forms retain submitted ID order, repetitions, project spelling and removal without a project', async () => {
  assert.deepEqual(await parseMoveForm(request(encode(sample))), sample);
  const removal = { ...sample, intent: 'remove' as const, project: undefined };
  assert.deepEqual(await parseMoveForm(request(encode(removal))), removal);
  const large = { ...sample, artifactIds: Array.from({ length: 25 }, () => randomUUID()), project: '界'.repeat(80) };
  const body = encode(large);
  assert.equal(Buffer.byteLength(body, 'utf8'), 1967);
  assert(Buffer.byteLength(body, 'utf8') <= 4096);
  assert.deepEqual(await parseMoveForm(request(body)), large);
});

test('the native bulk remove body parses two selected IDs without a project', async () => {
  assert.deepEqual(await parseMoveForm(request('requestId=bulk-remove-request&intent=remove&artifactId=artifact-alpha&artifactId=artifact-beta')), {
    artifactIds: ['artifact-alpha', 'artifact-beta'], requestId: 'bulk-remove-request', project: undefined, intent: 'remove',
  });
});

test('move parsing rejects unknown, duplicate singleton, missing, malformed and oversized fields', async () => {
  const fields = encode(sample);
  const invalid = [
    `${fields}&ownerId=intruder`, `${fields}&project=Delta`, `${fields}&requestId=another-request`, `${fields}&intent=move`,
    fields.replace(/project=[^&]*&/, ''), fields.replace(/requestId=[^&]*&/, ''), fields.replace(/&intent=move/, ''), fields.replace(/artifactId=[^&]*&/g, ''),
    fields.replace('intent=move', 'intent=archive'), fields.replace('move-request-one', 'short'), fields.replace('Client', '%ZZ'), fields.replace('Client', '%C0%AF'),
    fields.replace('Client', '%'), fields.replace('Client', 'x'.repeat(4096)), `${fields}&artifactId=`,
    encode({ ...sample, artifactIds: Array.from({ length: 26 }, () => 'id') }), encode({ ...sample, artifactIds: ['x'.repeat(129)] }),
  ];
  for (const body of invalid) await assert.rejects(parseMoveForm(request(body)), (error: unknown) => error instanceof Response && error.status === 400);
  await assert.rejects(parseMoveForm(request(fields, 'application/json')), (error: unknown) => error instanceof Response && error.status === 400);
  await assert.rejects(parseMoveForm(request(new Uint8Array([...Buffer.from(fields), 0xc0, 0xaf]))), (error: unknown) => error instanceof Response && error.status === 400);
});

test('the streaming parser accepts exactly 4096 bytes and cancels an over-limit stream', async () => {
  const make = (size: number) => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(Buffer.from(`value=${'x'.repeat(size - 6)}`));
      if (size <= 4096) controller.close();
    }, cancel() { cancelled = true; } });
    return { request: new Request('https://panel.example.test', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, duplex: 'half' } as RequestInit), cancelled: () => cancelled };
  };
  const exact = make(4096);
  assert.equal((await readForm(exact.request, { value: [1, 1] }, 4096))?.get('value')?.length, 4090);
  const over = make(4097);
  assert.equal(await readForm(over.request, { value: [1, 1] }, 4096), undefined);
  assert.equal(over.cancelled(), true);
  assert.equal(await readForm(request('value=x&value=y'), { value: [1, 1] }, 4096), undefined);
  assert.equal(await readForm(request(''), { value: [1, 1] }, 4096), undefined);
});

test('native form outcomes use canonical destinations, new projects, removal and historical replay', async () => {
  const { app, store, actor, submit } = await setup();
  try {
    await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Filed'), project: 'Gamma' });
    const loose = await store.create(actor, { requestId: randomUUID(), snapshot: snapshot('Loose') });
    const form = { artifactIds: [loose.artifactId], requestId: randomUUID(), project: ' gAMMA ', intent: 'move' as const };
    assert.deepEqual(await submit(form), { kind: 'moved', location: '/?project=Gamma' });
    await store.move(actor, { requestId: randomUUID(), artifactId: loose.artifactId, project: 'Delta' });
    assert.deepEqual(await submit(form), { kind: 'moved', location: '/?project=Gamma' });
    assert.equal((await store.read(actor, { artifactId: loose.artifactId })).project, 'Delta');
    assert.deepEqual(await submit({ ...form, project: 'Changed' }), { kind: 'conflict' });
    assert.deepEqual(await submit({ ...form, intent: 'remove' }), { kind: 'conflict' });
    assert.deepEqual(await submit({ ...form, requestId: randomUUID(), project: 'New project' }), { kind: 'moved', location: '/?project=New+project' });
    assert.deepEqual(await submit({ ...form, requestId: randomUUID(), intent: 'remove' }), { kind: 'moved', location: '/?unfiled=1' });
    assert.deepEqual(await submit({ ...form, requestId: randomUUID(), artifactIds: ['missing-artifact'] }), { kind: 'partial', location: '/?project=Gamma', result: { project: 'Gamma', moved: 0, unchanged: 0, missing: ['missing-artifact'] } });
    const unused = { ...form, requestId: randomUUID() };
    for (const project of ['   ', 'x'.repeat(81), 'Tab\tname']) assert.deepEqual(await submit({ ...unused, project }), { kind: 'invalid' });
    assert.deepEqual(await submit(unused), { kind: 'moved', location: '/?project=Gamma' });
    assert.equal((await store.read(actor, { artifactId: loose.artifactId })).headRevisionId, loose.headRevisionId);
  } finally { await app.close(); }
});

test('all non-redirect outcomes survive failed optional subject reads with exact form and recovery destination', async () => {
  const failure = async () => { throw new Error('subject database unavailable'); };
  const partial = { project: 'Historical destination', moved: 1, unchanged: 0, missing: ['artifact-two'] };
  const cases = [
    { form: sample, move: async () => partial, outcome: { kind: 'partial', result: partial, location: '/?project=Historical+destination' }, status: 200 },
    { form: { ...sample, project: '   ' }, move: async () => { throw new Error('must not call invalid command'); }, outcome: { kind: 'invalid' }, status: 400 },
    { form: sample, move: async () => { throw new ArtifactError('request_conflict', 'Changed'); }, outcome: { kind: 'conflict' }, status: 409 },
    { form: sample, move: async () => { throw new Error('command unavailable'); }, outcome: { kind: 'uncertain' }, status: 503 },
    { form: { ...sample, intent: 'remove' as const, project: undefined }, move: async () => { throw new Error('command unavailable'); }, outcome: { kind: 'uncertain' }, status: 503 },
  ];
  for (const scenario of cases) {
    const page = await prepareMovePage({ move: scenario.move, moveSubject: failure }, actor, request(encode(scenario.form)));
    assert.deepEqual(page, { kind: 'render', form: scenario.form, outcome: scenario.outcome, subject: undefined, status: scenario.status, freshHref: '/move?artifactId=artifact-one&artifactId=artifact-two&artifactId=artifact-one' });
  }
});

test('successful POST redirects without enrichment while GET and explicit authorization failures require the subject read', async () => {
  let reads = 0;
  const unavailable = async () => { reads++; throw new Error('subject unavailable'); };
  const move = async () => ({ project: null, moved: 2, unchanged: 0, missing: [] });
  assert.deepEqual(await prepareMovePage({ move, moveSubject: unavailable }, actor, request(encode(sample))), { kind: 'redirect', location: '/?unfiled=1' });
  assert.equal(reads, 0);
  await assert.rejects(prepareMovePage({ move, moveSubject: unavailable }, actor, new Request('https://panel.example.test/move?artifactId=one')), /subject unavailable/);
  await assert.rejects(prepareMovePage({ move, moveSubject: async () => { throw new ArtifactError('forbidden', 'Revoked'); } }, actor, request(encode({ ...sample, project: '' }))), { code: 'forbidden' });
  await assert.rejects(prepareMovePage({ move: async () => { throw new ArtifactError('forbidden', 'Revoked'); }, moveSubject: unavailable }, actor, request(encode(sample))), { code: 'forbidden' });
});

test('publication and deletion keep strict singleton fields after the parser migration', async () => {
  const { parsePublicationForm } = await import('../apps/dashboard/src/publish.ts');
  const { parseDeletionForm } = await import('../apps/dashboard/src/delete.ts');
  for (const [parse, revision] of [[parsePublicationForm, 'revisionId'], [parseDeletionForm, 'expectedRevisionId']] as const) {
    const body = new URLSearchParams({ artifactId: 'artifact-one', [revision]: 'revision-one', expectedPublicationVersion: '0', requestId: 'singleton-request' }).toString();
    assert.equal((await parse(request(body), 'artifact-one')).artifactId, 'artifact-one');
    for (const invalid of [`${body}&artifactId=artifact-one`, `${body}&requestId=other-request`, `${body}&project=Gamma`, body.replace('requestId=singleton-request', ''), body.replace('revision-one', '%FF'), `${body}&padding=${'x'.repeat(4096)}`]) {
      await assert.rejects(parse(request(invalid), 'artifact-one'), (error: unknown) => error instanceof Response && error.status === 400);
    }
  }
});
