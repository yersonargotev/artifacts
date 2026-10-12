import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { artifactCommand, session } from '../packages/db/src/schema.ts';
import { createArtifactStore, createSchema, historySchema, readSchema, updateSchema, type Actor, type ArtifactRead, type Revision, type Snapshot, type UpdateInput } from '../packages/artifacts/src/index.ts';
import { compactArtifactRead, compareRevisions, prepareArtifactEdit, summarizeRevision, type CompactArtifactRead, type RevisionSummary } from '../packages/artifacts/src/workflow.ts';
import { fixture, grant } from './helpers.ts';

const snapshot: Snapshot = {
  metadata: { title: 'Saved title', description: 'Saved description', custom: { retained: ['private-custom-payload'] } },
  content: { kind: 'html', text: '<h1>private-content-payload 🌎</h1>' },
  files: [
    { path: 'notes/hello.txt', mediaType: 'text/plain', encoding: 'utf8', data: 'hello' },
    { path: 'bytes.bin', mediaType: 'application/octet-stream', encoding: 'base64', data: 'AAH+/w==' },
  ],
};
const revision: Revision = {
  id: 'revision-one', parentRevisionId: null, sequence: 1, authorUserId: 'owner', authorClientId: 'client',
  createdAt: '2026-10-10T00:00:00.000Z', sha256: 'a'.repeat(64), snapshot,
};
const document: ArtifactRead = { artifactId: 'artifact-one', ownerId: 'owner', headRevisionId: revision.id, publication: null, revision };
const binarySummary = { path: 'bytes.bin', mediaType: 'application/octet-stream', encoding: 'base64' as const, decodedBytes: 4, sha256: 'c5dbae22661af6db18a1f676db82a7ef7de46d27c3a263a872f00478b0d99fc4' };
const textSummary = { path: 'notes/hello.txt', mediaType: 'text/plain', encoding: 'utf8' as const, decodedBytes: 5, sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824' };

async function workflowFixture() {
  const app = await fixture();
  const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
  assert(signedIn);
  const actor: Actor = { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'workflow-test', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
  return { ...app, actor, store: createArtifactStore(app.db, { publishOrigin: 'https://published.example.test' }) };
}

test('compact summaries retain identity and decoded attachment digests without payloads', async () => {
  const summary = await summarizeRevision(revision);
  assert.deepEqual(summary, {
    id: 'revision-one', parentRevisionId: null, sequence: 1, authorUserId: 'owner', authorClientId: 'client',
    createdAt: '2026-10-10T00:00:00.000Z', sha256: 'a'.repeat(64),
    metadata: { title: 'Saved title', description: 'Saved description' },
    content: { kind: 'html', utf8Bytes: 37 }, files: [binarySummary, textSummary],
  });
  const compact = await compactArtifactRead(document);
  assert.deepEqual(compact, { artifactId: 'artifact-one', ownerId: 'owner', headRevisionId: 'revision-one', publication: null, revision: summary });
  assert.doesNotMatch(JSON.stringify(compact), /private-content-payload|private-custom-payload|AAH\+\/w==|"data"|"snapshot"/);
});

test('revision comparison reports metadata, content and changed attachment inventories', async () => {
  const next: Revision = {
    ...revision, id: 'revision-two', parentRevisionId: revision.id, sequence: 2,
    snapshot: {
      metadata: { title: 'Changed title', description: '', custom: null },
      content: { kind: 'text', text: 'New text' },
      files: [
        { path: 'added.txt', mediaType: 'text/plain', encoding: 'utf8', data: 'hello' },
        { path: 'notes/hello.txt', mediaType: 'text/markdown', encoding: 'base64', data: 'aGVsbG8=' },
      ],
    },
  };
  assert.deepEqual(await compareRevisions(revision, next), {
    beforeRevisionId: 'revision-one', afterRevisionId: 'revision-two',
    metadata: [
      { field: 'title', before: 'Saved title', after: 'Changed title' },
      { field: 'description', before: 'Saved description', after: '' },
      { field: 'custom', before: { retained: ['private-custom-payload'] }, after: null },
    ],
    content: { before: { kind: 'html', text: '<h1>private-content-payload 🌎</h1>' }, after: { kind: 'text', text: 'New text' }, kindChanged: true, textChanged: true },
    files: [
      { path: 'added.txt', change: 'added', before: null, after: { ...textSummary, path: 'added.txt' } },
      { path: 'bytes.bin', change: 'removed', before: binarySummary, after: null },
      { path: 'notes/hello.txt', change: 'changed', before: textSummary, after: { ...textSummary, mediaType: 'text/markdown', encoding: 'base64' } },
    ],
  });
  const changedBytes = { ...revision, snapshot: { ...snapshot, files: [{ ...snapshot.files[1], data: 'aGVsbG8=' }] } };
  const byteDifference = await compareRevisions(revision, changedBytes);
  assert.deepEqual(byteDifference.files[0], { path: 'bytes.bin', change: 'changed', before: binarySummary, after: { ...binarySummary, decodedBytes: 5, sha256: textSummary.sha256 } });
  assert.equal(byteDifference.content.kindChanged, false);
  assert.equal(byteDifference.content.textChanged, false);
  const reordered = { ...revision, snapshot: { ...snapshot, metadata: { ...snapshot.metadata, custom: { b: 2, a: 1 } } } };
  const original = { ...revision, snapshot: { ...snapshot, metadata: { ...snapshot.metadata, custom: { a: 1, b: 2 } } } };
  assert.deepEqual((await compareRevisions(original, reordered)).metadata, []);
  const removed = { ...revision, snapshot: { ...snapshot, metadata: { title: 'Saved title', description: 'Saved description' } } };
  assert.deepEqual((await compareRevisions(next, removed)).metadata.at(-1), { field: 'custom', before: null, after: undefined });
  for (const file of [
    { ...snapshot.files[0], mediaType: 'text/markdown' },
    { ...snapshot.files[0], encoding: 'base64' as const, data: 'aGVsbG8=' },
  ]) {
    const fileDifference = await compareRevisions(revision, { ...revision, snapshot: { ...snapshot, files: [file, snapshot.files[1]] } });
    assert.deepEqual(fileDifference.files.map(({ path, change }) => ({ path, change })), [{ path: 'notes/hello.txt', change: 'changed' }]);
  }
  const kindDifference = await compareRevisions(revision, { ...revision, snapshot: { ...snapshot, content: { ...snapshot.content, kind: 'text' } } });
  assert.equal(kindDifference.content.kindChanged, true);
  assert.equal(kindDifference.content.textChanged, false);
  const textDifference = await compareRevisions(revision, { ...revision, snapshot: { ...snapshot, content: { ...snapshot.content, text: 'Changed text' } } });
  assert.equal(textDifference.content.kindChanged, false);
  assert.equal(textDifference.content.textChanged, true);
});

test('prepared edits preserve omitted values, isolate callers and freeze every nested value', async () => {
  const source = structuredClone(document);
  const changes = { metadata: { title: 'New title', custom: { values: ['original'] } }, content: { text: 'New text' }, files: structuredClone(snapshot.files) };
  let resolveRead!: (value: ArtifactRead) => void;
  const prepared = prepareArtifactEdit({ read: () => new Promise((resolve) => { resolveRead = resolve; }) }, { artifactId: document.artifactId, requestId: 'prepared-request', changes });
  changes.metadata.custom.values.push('caller mutation');
  changes.files[0].data = 'caller mutation';
  changes.content.text = 'caller mutation';
  resolveRead(source);
  const command = await prepared;
  source.revision.snapshot.files[0].data = 'source mutation';
  source.revision.snapshot.metadata.description = 'source mutation';
  assert.deepEqual(command, {
    artifactId: 'artifact-one', requestId: 'prepared-request', expectedRevisionId: 'revision-one',
    snapshot: { metadata: { title: 'New title', description: 'Saved description', custom: { values: ['original'] } }, content: { kind: 'html', text: 'New text' }, files: snapshot.files },
  });
  assert.throws(() => Object.assign(command, { requestId: 'different-request' }), TypeError);
  assert.throws(() => Object.assign(command.snapshot.metadata, { description: 'changed' }), TypeError);
  assert.throws(() => Object.assign(command.snapshot.files[0], { data: 'changed' }), TypeError);
  assert.throws(() => Object.assign(command.snapshot.metadata.custom!, { values: [] }), TypeError);
  assert.throws(() => Object.assign((command.snapshot.metadata.custom as { values: readonly string[] }).values, { 0: 'changed' }), TypeError);
  assert.equal(Object.isFrozen(source), false);
  const preserved = await prepareArtifactEdit({ read: async () => document }, { artifactId: 'artifact-one', requestId: 'preserved-request', changes: { content: { text: 'Only text' } } });
  assert.deepEqual(preserved.snapshot, { ...snapshot, content: { kind: 'html', text: 'Only text' } });
  const nullCustom = await prepareArtifactEdit({ read: async () => document }, { artifactId: 'artifact-one', requestId: 'null-custom-request', changes: { metadata: { custom: null }, files: [] } });
  assert.deepEqual(nullCustom.snapshot, { ...snapshot, metadata: { ...snapshot.metadata, custom: null }, files: [] });
  const removedCustom = await prepareArtifactEdit({ read: async () => document }, { artifactId: 'artifact-one', requestId: 'remove-custom-request', changes: { metadata: { custom: undefined } } });
  assert.deepEqual(removedCustom.snapshot.metadata, { title: 'Saved title', description: 'Saved description' });
  assert.deepEqual(JSON.parse(JSON.stringify(removedCustom)).snapshot.metadata, { title: 'Saved title', description: 'Saved description' });
});

test('preparation rejects a returned non-head, another artifact and invalid snapshots', async () => {
  const input = { artifactId: document.artifactId, requestId: 'prepare-validation', changes: {} };
  await assert.rejects(prepareArtifactEdit({ read: async () => ({ ...document, headRevisionId: 'newer-revision' }) }, input), { code: 'conflict' });
  await assert.rejects(prepareArtifactEdit({ read: async () => ({ ...document, artifactId: 'another-artifact' }) }, input), /different artifact/);
  await assert.rejects(prepareArtifactEdit({ read: async () => ({ ...document, revision: { ...revision, snapshot: { ...snapshot, files: [{ ...snapshot.files[0], path: '../escape' }] } } }) }, input), /normalized relative file path/);
  await assert.rejects(prepareArtifactEdit({ read: async () => document }, { ...input, changes: { content: { text: '\ud800' } } }), /well-formed Unicode/);
  await assert.rejects(prepareArtifactEdit({ read: async () => document }, { ...input, changes: { content: { text: 'x'.repeat(1_048_576) } } }), /1 MiB/);
});

test('persisted prepared edits replay an uncertain committed write and reject a stale head', async () => {
  const app = await workflowFixture();
  const directory = await mkdtemp(join(tmpdir(), 'prepared-artifact-'));
  try {
    const first = await app.store.create(app.actor, { requestId: randomUUID(), snapshot });
    const client = { read: (input: { artifactId: string }) => app.store.read(app.actor, input) };
    const command = await prepareArtifactEdit(client, { artifactId: first.artifactId, requestId: randomUUID(), changes: { metadata: { title: 'Prepared title' }, content: { text: 'Prepared content' } } });
    const path = join(directory, 'command.json');
    await writeFile(path, JSON.stringify(command));
    await assert.rejects((async () => {
      await app.store.update(app.actor, command);
      throw new Error('Connection lost after commit');
    })(), /Connection lost after commit/);
    const restored: UpdateInput = JSON.parse(await readFile(path, 'utf8'));
    const replayed = await app.store.update(app.actor, restored);
    assert.equal(replayed.revision.sequence, 2);
    assert.deepEqual(replayed.revision.snapshot, { ...snapshot, metadata: { ...snapshot.metadata, title: 'Prepared title' }, content: { kind: 'html', text: 'Prepared content' } });
    assert.deepEqual((await app.store.history(app.actor, { artifactId: first.artifactId })).items.map((item) => item.sequence), [2, 1]);
    const stale = await prepareArtifactEdit(client, { artifactId: first.artifactId, requestId: randomUUID(), changes: { content: { text: 'Stale content' } } });
    const winner = await app.store.update(app.actor, { requestId: randomUUID(), artifactId: first.artifactId, expectedRevisionId: replayed.revision.id, snapshot: { ...snapshot, content: { kind: 'text', text: 'Concurrent content' } } });
    await assert.rejects(app.store.update(app.actor, stale), { code: 'conflict', details: { currentRevisionId: winner.revision.id } });
    assert.equal((await app.store.read(app.actor, { artifactId: first.artifactId })).revision.snapshot.content.text, 'Concurrent content');
    assert.deepEqual((await app.store.history(app.actor, { artifactId: first.artifactId })).items.map((item) => item.sequence), [3, 2, 1]);
    assert.deepEqual(await app.store.update(app.actor, restored), replayed);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('optional response schemas preserve absent fields and accept only their operation modes', () => {
  const created = createSchema.parse({ requestId: 'schema-create', snapshot });
  assert.deepEqual(created, { requestId: 'schema-create', snapshot });
  assert.equal(Object.hasOwn(created, 'response'), false);
  assert.deepEqual(readSchema.parse({ artifactId: 'artifact-one', response: 'compact' }), { artifactId: 'artifact-one', response: 'compact' });
  assert.deepEqual(historySchema.parse({ artifactId: 'artifact-one', response: 'summary' }), { artifactId: 'artifact-one', limit: 5, response: 'summary' });
  assert.equal(historySchema.safeParse({ artifactId: 'artifact-one', response: 'compact' }).success, false);
  assert.equal(readSchema.safeParse({ artifactId: 'artifact-one', response: 'summary' }).success, false);
  assert.equal(Object.hasOwn(updateSchema.parse({ requestId: 'schema-update', artifactId: 'artifact-one', expectedRevisionId: 'revision-one', snapshot }), 'response'), false);
});

test('literal legacy create and update receipt hashes replay after response mode extension', async () => {
  const app = await workflowFixture();
  try {
    const legacySnapshot: Snapshot = { metadata: { title: 'Legacy', description: '' }, content: { kind: 'text', text: 'Legacy payload' }, files: [] };
    const legacyResult: ArtifactRead = {
      artifactId: 'legacy-artifact', ownerId: app.ownerId, headRevisionId: 'legacy-revision-one', publication: null,
      revision: { id: 'legacy-revision-one', parentRevisionId: null, sequence: 1, authorUserId: app.ownerId, authorClientId: 'legacy-client', createdAt: '2026-01-01T00:00:00.000Z', sha256: '1'.repeat(64), snapshot: legacySnapshot },
    };
    const updatedResult: ArtifactRead = { ...legacyResult, headRevisionId: 'legacy-revision-two', revision: { ...legacyResult.revision, id: 'legacy-revision-two', parentRevisionId: 'legacy-revision-one', sequence: 2 } };
    await app.db.insert(artifactCommand).values([
      { ownerId: app.ownerId, requestId: 'legacy-create-request', payloadHash: 'cf00e97db6e580c4143fb3df098d97f68dfb7ba83657833203b9a2a74c53cf5b', result: JSON.stringify(legacyResult), createdAt: new Date('2026-01-01T00:00:00.000Z') },
      { ownerId: app.ownerId, requestId: 'legacy-update-request', payloadHash: '744a6c846f7753b74a479baf0ad651898c598447c6d29369baad007c70f83e2d', result: JSON.stringify(updatedResult), createdAt: new Date('2026-01-01T00:00:00.000Z') },
    ]);
    const create = { requestId: 'legacy-create-request', snapshot: legacySnapshot };
    const update = { requestId: 'legacy-update-request', artifactId: 'legacy-artifact', expectedRevisionId: 'legacy-revision-one', snapshot: legacySnapshot };
    assert.deepEqual(await app.store.create(app.actor, create), legacyResult);
    assert.deepEqual(await app.store.update(app.actor, update), updatedResult);
    for (const response of ['full', 'compact'] as const) {
      await assert.rejects(app.store.create(app.actor, { ...create, response }), { code: 'request_conflict' });
      await assert.rejects(app.store.update(app.actor, { ...update, response }), { code: 'request_conflict' });
    }
    await assert.rejects(app.store.create({ ...app.actor, scopes: [] }, create), { code: 'forbidden' });
    await app.db.delete(session).where(eq(session.id, app.actor.sessionId));
    await assert.rejects(app.store.update(app.actor, update), { code: 'forbidden' });
  } finally { await app.close(); }
});

type ToolResult<T> = { content: { type: 'text'; text: string }[]; structuredContent: T; isError?: boolean };

test('MCP compact modes project full receipts, preserve exact retries and bound summary history', async () => {
  const app = await workflowFixture();
  try {
    const tokens = await grant(app, 'openid profile artifacts:read artifacts:write artifacts:publish');
    async function tool<T>(name: string, input: unknown, token = tokens.access_token): Promise<ToolResult<T>> {
      const response = await fetch(app.config.resource, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } }) });
      assert.equal(response.status, 200);
      const body = await response.text();
      const payload = body.startsWith('event:') ? body.split('\n').find((line) => line.startsWith('data:'))!.slice(5) : body;
      const result: ToolResult<T> = JSON.parse(payload).result;
      assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
      return result;
    }
    const full = (await tool<ArtifactRead>('artifacts_create', { requestId: randomUUID(), snapshot })).structuredContent;
    assert.deepEqual(full.revision.snapshot, snapshot);
    assert.deepEqual((await tool<ArtifactRead>('artifacts_read', { artifactId: full.artifactId })).structuredContent, full);
    assert.deepEqual((await tool<ArtifactRead>('artifacts_read', { artifactId: full.artifactId, response: 'full' })).structuredContent, full);
    const defaultUpdate = (await tool<ArtifactRead>('artifacts_update', { requestId: randomUUID(), artifactId: full.artifactId, expectedRevisionId: full.revision.id, snapshot })).structuredContent;
    assert.deepEqual(defaultUpdate.revision.snapshot, snapshot);
    const defaultHistory = (await tool<{ items: Revision[]; nextBeforeSequence: number | null }>('artifacts_history', { artifactId: full.artifactId })).structuredContent;
    assert.deepEqual(defaultHistory, { items: [defaultUpdate.revision, full.revision], nextBeforeSequence: null });
    assert.deepEqual((await tool('artifacts_history', { artifactId: full.artifactId, response: 'full' })).structuredContent, defaultHistory);

    const create = { requestId: randomUUID(), snapshot, response: 'compact' };
    const firstResult = await tool<CompactArtifactRead>('artifacts_create', create);
    const first = firstResult.structuredContent;
    assert.deepEqual(first.revision.metadata, { title: 'Saved title', description: 'Saved description' });
    assert.deepEqual(first.revision.content, { kind: 'html', utf8Bytes: 37 });
    assert.deepEqual(first.revision.files, [binarySummary, textSummary]);
    assert.equal(first.revision.sequence, 1);
    assert.equal(first.publication, null);
    assert.doesNotMatch(JSON.stringify(firstResult), /private-content-payload|private-custom-payload|AAH\+\/w==|"data"|"snapshot"/);
    const storedFirst = await app.store.read(app.actor, { artifactId: first.artifactId, response: 'compact' });
    assert.deepEqual(storedFirst.revision.snapshot, snapshot);
    const [createReceipt] = await app.db.select().from(artifactCommand).where(eq(artifactCommand.requestId, create.requestId));
    assert.deepEqual(JSON.parse(createReceipt.result), storedFirst);
    assert.deepEqual((await tool<CompactArtifactRead>('artifacts_read', { artifactId: first.artifactId, response: 'compact' })).structuredContent, first);
    await app.store.publish(app.actor, { requestId: randomUUID(), artifactId: first.artifactId, revisionId: first.revision.id, expectedPublicationVersion: 0 });
    const update = { requestId: randomUUID(), artifactId: first.artifactId, expectedRevisionId: first.revision.id, snapshot: { ...snapshot, content: { kind: 'text', text: 'next-private-content-payload' } }, response: 'compact' };
    const secondResult = await tool<CompactArtifactRead>('artifacts_update', update);
    const second = secondResult.structuredContent;
    assert.equal(second.revision.sequence, 2);
    assert.equal(second.publication?.revisionId, first.revision.id);
    assert.deepEqual(second.revision.content, { kind: 'text', utf8Bytes: 28 });
    assert.doesNotMatch(JSON.stringify(secondResult), /next-private-content-payload|private-custom-payload|AAH\+\/w==|"data"|"snapshot"/);
    const [updateReceipt] = await app.db.select().from(artifactCommand).where(eq(artifactCommand.requestId, update.requestId));
    assert.equal(JSON.parse(updateReceipt.result).revision.snapshot.content.text, 'next-private-content-payload');
    await app.store.publish(app.actor, { requestId: randomUUID(), artifactId: first.artifactId, revisionId: second.revision.id, expectedPublicationVersion: 1 });
    const third = await app.store.update(app.actor, { requestId: randomUUID(), artifactId: first.artifactId, expectedRevisionId: second.revision.id, snapshot });
    assert.deepEqual(await tool('artifacts_create', create), firstResult);
    assert.deepEqual(await tool('artifacts_update', update), secondResult);
    for (const response of ['full', undefined]) {
      assert.equal((await tool<{ error: string }>('artifacts_create', { ...create, response })).structuredContent.error, 'request_conflict');
      assert.equal((await tool<{ error: string }>('artifacts_update', { ...update, response })).structuredContent.error, 'request_conflict');
    }
    const readOnly = await grant(app);
    assert.equal((await tool<{ error: string }>('artifacts_create', create, readOnly.access_token)).structuredContent.error, 'forbidden');
    const retained = (await tool<CompactArtifactRead>('artifacts_read', { artifactId: first.artifactId, revisionId: first.revision.id, response: 'compact' })).structuredContent;
    assert.equal(retained.revision.id, first.revision.id);
    assert.equal(retained.headRevisionId, third.revision.id);
    assert.equal(retained.publication?.revisionId, second.revision.id);
    type HistorySummary = { items: RevisionSummary[]; nextBeforeSequence: number | null };
    const page = await tool<HistorySummary>('artifacts_history', { artifactId: first.artifactId, limit: 1, response: 'summary' });
    assert.deepEqual(page.structuredContent.items.map((item) => item.sequence), [3]);
    assert.equal(page.structuredContent.nextBeforeSequence, 3);
    const older = await tool<HistorySummary>('artifacts_history', { artifactId: first.artifactId, limit: 2, beforeSequence: 3, response: 'summary' });
    assert.deepEqual(older.structuredContent.items.map((item) => item.sequence), [2, 1]);
    assert.equal(older.structuredContent.nextBeforeSequence, null);
    assert.doesNotMatch(JSON.stringify([page, older]), /private-content-payload|private-custom-payload|AAH\+\/w==|"data"|"snapshot"/);
    const storedHistory = await app.store.history(app.actor, { artifactId: first.artifactId, response: 'summary' });
    assert.equal(storedHistory.items[0].snapshot.content.text, snapshot.content.text);
  } finally { await app.close(); }
});
