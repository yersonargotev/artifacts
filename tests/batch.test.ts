import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { artifactCommand } from '../packages/db/src/schema.ts';
import { batchSchema, createArtifactStore, type Actor, type BatchInput, type Snapshot } from '../packages/artifacts/src/index.ts';
import { canonicalJson, sha256 } from '../packages/artifacts/src/serialization.ts';
import { fixture } from './helpers.ts';

const page = (title: string, text: string): Snapshot => ({ metadata: { title, description: '' }, content: { kind: 'markdown', text }, files: [] });

async function batchFixture() {
  const app = await fixture({ allowGuests: true });
  const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
  assert(signedIn);
  const actor: Actor = { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'batch-author', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
  const options = { access: app.config.access, publishOrigin: 'https://published.example.test' };
  const store = createArtifactStore(app.db, options);
  const index = await store.create(actor, { requestId: randomUUID(), snapshot: page('Index', 'Catálogo inicial'), project: 'Wiki', slug: 'index' });
  const log = await store.create(actor, { requestId: randomUUID(), snapshot: page('Log', 'Sin entradas'), project: 'Wiki', slug: 'log' });
  // A competing command commits right before the batch sends its write request, after the batch has read and planned.
  function racing(before: () => Promise<unknown>) {
    let pending = true;
    const client = new Proxy(app.db.$client, { get(target, key) {
      if (key === 'batch') return async (...args: Parameters<typeof target.batch>) => {
        if (pending) { pending = false; await before(); }
        return target.batch(...args);
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const db = new Proxy(app.db, { get(target, key) {
      if (key === '$client') return client;
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    return createArtifactStore(db, options);
  }
  return { ...app, store, actor, index, log, racing };
}

const ingest = (index: { artifactId: string; headRevisionId: string }, log: { headRevisionId: string }) => [
  ...Array.from({ length: 9 }, (_, position) => ({ op: 'create' as const, project: 'wiki', slug: `concepts/c${position}`, snapshot: page(`Concepto ${position}`, `Ingesta de Envigado ${position}`) })),
  { op: 'update', project: 'WIKI', slug: 'concepts/c0', snapshot: page('Concepto 0', 'Ingesta revisada de Sabaneta') },
  { op: 'update', artifactId: index.artifactId, expectedRevisionId: index.headRevisionId, snapshot: page('Index', 'Catálogo con nueve conceptos') },
  { op: 'update', project: 'Wiki', slug: 'log', expectedRevisionId: log.headRevisionId, snapshot: page('Log', 'Una ingesta') },
] satisfies BatchInput['operations'];

test('a batch creates and updates pages atomically under one receipt', async () => {
  const app = await batchFixture();
  try {
    const input = { requestId: randomUUID(), operations: ingest(app.index, app.log) };
    const batch = await app.store.batch(app.actor, input);
    assert.deepEqual(batch.results.map(({ index }) => index), [...Array(12).keys()]);
    assert.equal(batch.results[9]!.artifactId, batch.results[0]!.artifactId, 'an update addresses a page created earlier by its slug');
    assert.equal(batch.results[10]!.artifactId, app.index.artifactId);

    const concept = await app.store.read(app.actor, { project: 'Wiki', slug: 'concepts/c0' });
    assert.equal(concept.project, 'Wiki', 'a new create reuses the stored project spelling');
    assert.equal(concept.headRevisionId, batch.results[9]!.revisionId);
    assert.equal(concept.revision.sequence, 2);
    assert.equal(concept.revision.parentRevisionId, batch.results[0]!.revisionId);
    assert.deepEqual(concept.revision.snapshot, input.operations[9]!.snapshot);
    assert.equal(concept.revision.sha256, await sha256(canonicalJson(input.operations[9]!.snapshot)));
    assert.equal(concept.revision.authorClientId, 'batch-author');
    assert.ok(Math.abs(Date.parse(concept.revision.createdAt) - Date.now()) < 60_000, 'timestamps round-trip through the driver');
    const created = await app.store.read(app.actor, { project: 'wiki', slug: 'concepts/c8' });
    assert.equal(created.revision.sequence, 1);
    assert.equal(created.revision.parentRevisionId, null);
    assert.equal(created.publication, null, 'a batch never publishes');
    const index = await app.store.read(app.actor, { artifactId: app.index.artifactId });
    assert.equal(index.revision.sequence, 2);
    assert.equal(index.revision.parentRevisionId, app.index.headRevisionId);
    assert.equal((await app.store.history(app.actor, { artifactId: concept.artifactId })).items.length, 2);
    assert.equal((await app.store.list(app.actor, { project: 'Wiki' })).items.length, 11);

    assert.deepEqual((await app.store.search(app.actor, { query: 'sabaneta' })).items.map(({ slug }) => slug), ['concepts/c0']);
    assert.deepEqual((await app.store.search(app.actor, { query: 'envigado 0' })).items, [], 'replaced text is gone');
    assert.deepEqual((await app.store.search(app.actor, { query: 'nueve conceptos' })).items.map(({ slug }) => slug), ['index']);
    assert.deepEqual((await app.store.search(app.actor, { query: 'catalogo inicial' })).items, []);

    assert.deepEqual(await app.store.batch(app.actor, input), batch, 'an exact retry returns the original result');
    assert.equal((await app.store.list(app.actor, { project: 'Wiki' })).items.length, 11);
    await assert.rejects(app.store.batch(app.actor, { ...input, operations: input.operations.slice(0, 11) }), { code: 'request_conflict' });
  } finally { await app.close(); }
});

test('a failing operation commits nothing and names its index', async () => {
  const app = await batchFixture();
  try {
    const before = await app.store.list(app.actor);
    const operations = ingest(app.index, app.log).slice(0, 7);
    const requestId = randomUUID();
    const stale = { op: 'update' as const, artifactId: app.index.artifactId, expectedRevisionId: 'stale-revision', snapshot: page('Index', 'Nunca') };
    await assert.rejects(app.store.batch(app.actor, { requestId, operations: [...operations, stale] }), { code: 'conflict', message: 'Artifact head changed', details: { index: 7, currentRevisionId: app.index.headRevisionId } });
    assert.deepEqual(await app.store.list(app.actor), before);
    assert.deepEqual((await app.store.search(app.actor, { query: 'envigado' })).items, []);
    const fixed = await app.store.batch(app.actor, { requestId, operations: [...operations, { ...stale, expectedRevisionId: app.index.headRevisionId }] });
    assert.equal(fixed.results.length, 8, 'the failed batch left no receipt behind');

    const { headRevisionId } = await app.store.read(app.actor, { artifactId: app.index.artifactId });
    const cases: [BatchInput['operations'], Record<string, unknown>][] = [
      [[{ op: 'create', slug: 'a', snapshot: page('A', 'a') }, { op: 'create', slug: 'b', snapshot: page('B', 'b') }, { op: 'create', slug: 'a', snapshot: page('A', 'a') }], { code: 'slug_conflict', details: { index: 2, slug: 'a', project: null } }],
      [[{ op: 'create', project: 'WIKI', slug: 'index', snapshot: page('Index', 'x') }], { code: 'slug_conflict', details: { index: 0, slug: 'index', project: 'Wiki', artifactId: app.index.artifactId } }],
      [[{ op: 'create', snapshot: page('A', 'a') }, { op: 'update', artifactId: app.index.artifactId, snapshot: page('Index', 'x') }], { code: 'conflict', details: { index: 1, currentRevisionId: headRevisionId } }],
      [[{ op: 'update', project: 'Wiki', slug: 'missing', snapshot: page('X', 'x') }], { code: 'not_found', details: { index: 0 } }],
      [[{ op: 'update', artifactId: 'missing', expectedRevisionId: 'x', snapshot: page('X', 'x') }], { code: 'not_found', details: { index: 0 } }],
    ];
    const committed = await app.store.list(app.actor);
    for (const [batch, expected] of cases) await assert.rejects(app.store.batch(app.actor, { requestId: randomUUID(), operations: batch }), (error: { code: string; details: Record<string, unknown> }) => {
      assert.equal(error.code, expected.code);
      assert.deepEqual(Object.fromEntries(Object.keys(expected.details as object).map((key) => [key, error.details[key]])), expected.details);
      return true;
    });
    assert.deepEqual(await app.store.list(app.actor), committed);
  } finally { await app.close(); }
});

test('a batch is bounded by 25 operations and a 4 MiB ceiling', () => {
  const create = (text: string) => ({ op: 'create' as const, snapshot: page('Página', text) });
  assert.throws(() => batchSchema.parse({ requestId: randomUUID(), operations: [] }), { name: 'ZodError' });
  assert.equal(batchSchema.parse({ requestId: randomUUID(), operations: Array.from({ length: 25 }, () => create('x')) }).operations.length, 25);
  assert.throws(() => batchSchema.parse({ requestId: randomUUID(), operations: Array.from({ length: 26 }, () => create('x')) }), { name: 'ZodError' });
  const large = 'a'.repeat(900 * 1024);
  assert.equal(batchSchema.parse({ requestId: randomUUID(), operations: Array.from({ length: 4 }, () => create(large)) }).operations.length, 4);
  assert.throws(() => batchSchema.parse({ requestId: randomUUID(), operations: Array.from({ length: 5 }, () => create(large)) }), (error: { issues: { message: string }[] }) => error.issues.some(({ message }) => message.includes('4 MiB ceiling')));
  assert.throws(() => batchSchema.parse({ requestId: randomUUID(), operations: [create('a'.repeat(1_048_577))] }), { name: 'ZodError' });
  for (const locator of [{}, { artifactId: 'a', slug: 'b' }, { project: 'Wiki', artifactId: 'a' }]) {
    assert.throws(() => batchSchema.parse({ requestId: randomUUID(), operations: [{ op: 'update', ...locator, snapshot: page('X', 'x') }] }), (error: { issues: { path: unknown[] }[] }) => error.issues.some(({ path }) => path.join('.') === 'operations.0'));
  }
});

test('deleting an artifact scrubs it from the batch receipts that name it', async () => {
  const app = await batchFixture();
  try {
    const input = { requestId: randomUUID(), operations: [{ op: 'create' as const, snapshot: page('A', 'a') }, { op: 'update' as const, artifactId: app.log.artifactId, expectedRevisionId: app.log.headRevisionId, snapshot: page('Log', 'b') }] };
    const batch = await app.store.batch(app.actor, input);
    const created = await app.store.read(app.actor, { artifactId: batch.results[0]!.artifactId });
    await app.store.delete(app.actor, { requestId: randomUUID(), artifactId: created.artifactId, expectedRevisionId: created.headRevisionId, expectedPublicationVersion: 0 });
    const [receipt] = await app.db.select().from(artifactCommand).where(eq(artifactCommand.requestId, input.requestId));
    assert.equal(receipt!.result.includes(created.artifactId), true);
    assert.equal(JSON.parse(receipt!.result).kind, 'artifact_deleted');
    await assert.rejects(app.store.batch(app.actor, input), { code: 'not_found', message: 'Artifact deleted' });
  } finally { await app.close(); }
});

test('a write that a stale read let through re-plans into the precise error', async () => {
  const app = await batchFixture();
  try {
    const committed = await app.store.list(app.actor);
    const creates = Array.from({ length: 7 }, (_, position) => ({ op: 'create' as const, project: 'Wiki', slug: `race/${position}`, snapshot: page(`Race ${position}`, 'r') }));
    const update = { op: 'update' as const, artifactId: app.index.artifactId, expectedRevisionId: app.index.headRevisionId, snapshot: page('Index', 'batch') };

    let competitor = '';
    const updated = app.racing(async () => { competitor = (await app.store.update(app.actor, { requestId: randomUUID(), artifactId: app.index.artifactId, expectedRevisionId: app.index.headRevisionId, snapshot: page('Index', 'competitor') })).headRevisionId; });
    await assert.rejects(updated.batch(app.actor, { requestId: randomUUID(), operations: [...creates, update] }), (error: { code: string; details: Record<string, unknown> }) => {
      assert.equal(error.code, 'conflict');
      assert.deepEqual(error.details, { index: 7, currentRevisionId: competitor });
      return true;
    });
    assert.deepEqual((await app.store.list(app.actor)).items.map(({ artifactId }) => artifactId), committed.items.map(({ artifactId }) => artifactId));
    assert.equal((await app.store.read(app.actor, { artifactId: app.index.artifactId })).headRevisionId, competitor);

    const deleted = app.racing(() => app.store.delete(app.actor, { requestId: randomUUID(), artifactId: app.log.artifactId, expectedRevisionId: app.log.headRevisionId, expectedPublicationVersion: 0 }));
    await assert.rejects(deleted.batch(app.actor, { requestId: randomUUID(), operations: [...creates, { op: 'update', artifactId: app.log.artifactId, expectedRevisionId: app.log.headRevisionId, snapshot: page('Log', 'x') }] }), { code: 'not_found', details: { index: 7 } });

    let holder = '';
    const claimed = app.racing(async () => { holder = (await app.store.create(app.actor, { requestId: randomUUID(), snapshot: page('Holder', 'h'), project: 'wiki', slug: 'race/3' })).artifactId; });
    await assert.rejects(claimed.batch(app.actor, { requestId: randomUUID(), operations: creates }), (error: { code: string; details: Record<string, unknown> }) => {
      assert.equal(error.code, 'slug_conflict');
      assert.deepEqual(error.details, { index: 3, slug: 'race/3', project: 'Wiki', artifactId: holder });
      return true;
    });
    assert.deepEqual((await app.store.list(app.actor)).items.map(({ slug }) => slug).sort(), ['index', 'race/3']);

    const input = { requestId: randomUUID(), operations: creates.slice(4) };
    let first: unknown;
    const retried = app.racing(async () => { first = await app.store.batch(app.actor, input); });
    assert.deepEqual(await retried.batch(app.actor, input), first, 'a raced receipt returns the committed result');
  } finally { await app.close(); }
});

test('a batch moves pages and later operations address them by their new slug', async () => {
  const app = await batchFixture();
  try {
    const archive = await app.store.create(app.actor, { requestId: randomUUID(), snapshot: page('Archivo', 'Notas de Itagüí'), project: 'Archive', slug: 'notes' });
    const input = { requestId: randomUUID(), operations: [
      { op: 'create', project: 'Wiki', slug: 'drafts/rag', snapshot: page('RAG', 'Borrador') },
      { op: 'move', from: { project: 'wiki', slug: 'drafts/rag' }, slug: 'concepts/rag' },
      { op: 'update', project: 'Wiki', slug: 'concepts/rag', snapshot: page('RAG', 'Recuperación aumentada') },
      { op: 'move', artifactId: app.log.artifactId, slug: 'journal' },
      { op: 'create', project: 'Wiki', slug: 'log', snapshot: page('Log', 'Bitácora nueva') },
      { op: 'move', artifactId: archive.artifactId, project: 'WIKI' },
      { op: 'move', from: { project: 'Wiki', slug: 'index' }, project: null, slug: null },
      { op: 'update', artifactId: app.index.artifactId, expectedRevisionId: app.index.headRevisionId, snapshot: page('Index', 'Índice sin proyecto') },
    ] satisfies BatchInput['operations'] };
    const batch = await app.store.batch(app.actor, input);
    assert.equal(batch.results[1]!.artifactId, batch.results[0]!.artifactId, 'a move addresses a page created earlier by its slug');
    assert.equal(batch.results[2]!.artifactId, batch.results[0]!.artifactId, 'an update addresses a moved page by its new slug');
    assert.equal(batch.results[1]!.revisionId, batch.results[0]!.revisionId, 'a move reports the head it left in place');
    assert.equal(batch.results[3]!.revisionId, app.log.headRevisionId);

    const rag = await app.store.read(app.actor, { project: 'Wiki', slug: 'concepts/rag' });
    assert.equal(rag.revision.sequence, 2);
    await assert.rejects(app.store.read(app.actor, { project: 'Wiki', slug: 'drafts/rag' }), { code: 'not_found' });
    const journal = await app.store.read(app.actor, { project: 'Wiki', slug: 'journal' });
    assert.equal(journal.artifactId, app.log.artifactId);
    assert.equal(journal.revision.sequence, 1, 'a move creates no revision');
    assert.notEqual((await app.store.read(app.actor, { project: 'Wiki', slug: 'log' })).artifactId, app.log.artifactId, 'a later create takes the slug a move freed');
    const moved = await app.store.read(app.actor, { project: 'Wiki', slug: 'notes' });
    assert.equal(moved.artifactId, archive.artifactId, 'a move to another project keeps the slug');
    assert.equal(moved.project, 'Wiki', 'a move reuses the stored project spelling');
    const index = await app.store.read(app.actor, { artifactId: app.index.artifactId });
    assert.deepEqual([index.project, index.slug, index.revision.sequence], [null, null, 2]);

    const found = async (query: string, project?: string) => (await app.store.search(app.actor, { query, project })).items.map(({ project, slug }) => [project, slug]);
    assert.deepEqual(await found('itagui', 'Wiki'), [['Wiki', 'notes']]);
    assert.deepEqual(await found('itagui', 'Archive'), []);
    assert.deepEqual(await found('recuperacion'), [['Wiki', 'concepts/rag']]);
    assert.deepEqual(await found('indice sin proyecto'), [[null, null]]);
    assert.deepEqual(await app.store.batch(app.actor, input), batch, 'an exact retry returns the original result');
  } finally { await app.close(); }
});

test('a move that collides with a slug fails at its index and commits nothing', async () => {
  const app = await batchFixture();
  try {
    const other = await app.store.create(app.actor, { requestId: randomUUID(), snapshot: page('Otro', 'o'), project: 'Other', slug: 'index' });
    const committed = await app.store.list(app.actor);
    const cases: [BatchInput['operations'], Record<string, unknown>][] = [
      [[{ op: 'create', project: 'Wiki', slug: 'a', snapshot: page('A', 'a') }, { op: 'move', artifactId: app.log.artifactId, slug: 'index' }], { index: 1, slug: 'index', project: 'Wiki', artifactId: app.index.artifactId }],
      [[{ op: 'move', artifactId: other.artifactId, project: 'wiki' }], { index: 0, slug: 'index', project: 'Wiki', artifactId: app.index.artifactId }],
      [[{ op: 'create', project: 'Wiki', slug: 'b', snapshot: page('B', 'b') }, { op: 'move', from: { project: 'Wiki', slug: 'log' }, slug: 'b' }], { index: 1, slug: 'b', project: 'Wiki' }],
      [[{ op: 'move', artifactId: app.index.artifactId, slug: 'home' }, { op: 'move', artifactId: app.log.artifactId, slug: 'home' }], { index: 1, slug: 'home', project: 'Wiki', artifactId: app.index.artifactId }],
    ];
    for (const [operations, details] of cases) await assert.rejects(app.store.batch(app.actor, { requestId: randomUUID(), operations }), (error: { code: string; details: Record<string, unknown> }) => {
      assert.equal(error.code, 'slug_conflict');
      assert.deepEqual(Object.fromEntries(Object.keys(details).map((key) => [key, error.details[key]])), details);
      return true;
    });
    await assert.rejects(app.store.batch(app.actor, { requestId: randomUUID(), operations: [{ op: 'move', from: { project: 'Wiki', slug: 'missing' }, slug: 'x' }] }), { code: 'not_found', details: { index: 0 } });
    assert.deepEqual(await app.store.list(app.actor), committed);
    assert.equal((await app.store.batch(app.actor, { requestId: randomUUID(), operations: [{ op: 'move', artifactId: app.index.artifactId, slug: 'index' }] })).results[0]!.artifactId, app.index.artifactId, 'a move onto its own slug is no conflict');

    for (const operation of [{ slug: 'x' }, { artifactId: 'a', from: { slug: 'b' }, slug: 'x' }, { artifactId: 'a' }]) {
      assert.throws(() => batchSchema.parse({ requestId: randomUUID(), operations: [{ op: 'move', ...operation }] }), (error: { issues: { path: unknown[] }[] }) => error.issues.some(({ path }) => path.join('.') === 'operations.0'));
    }
  } finally { await app.close(); }
});

test('a move that a stale read let through re-plans against the current location', async () => {
  const app = await batchFixture();
  try {
    const deleted = app.racing(() => app.store.delete(app.actor, { requestId: randomUUID(), artifactId: app.log.artifactId, expectedRevisionId: app.log.headRevisionId, expectedPublicationVersion: 0 }));
    await assert.rejects(deleted.batch(app.actor, { requestId: randomUUID(), operations: [{ op: 'create', slug: 'a', snapshot: page('A', 'a') }, { op: 'move', artifactId: app.log.artifactId, slug: 'journal' }] }), { code: 'not_found', details: { index: 1 } });
    assert.deepEqual((await app.store.list(app.actor)).items.map(({ slug }) => slug), ['index']);

    const relocated = app.racing(() => app.store.move(app.actor, { requestId: randomUUID(), artifactId: app.index.artifactId, project: 'Archive' }));
    await relocated.batch(app.actor, { requestId: randomUUID(), operations: [{ op: 'move', artifactId: app.index.artifactId, slug: 'home' }] });
    const index = await app.store.read(app.actor, { artifactId: app.index.artifactId });
    assert.deepEqual([index.project, index.slug], ['Archive', 'home'], 'a move that keeps the project keeps the one a concurrent move set');

    let competitor = '';
    const updated = app.racing(async () => { competitor = (await app.store.update(app.actor, { requestId: randomUUID(), artifactId: app.index.artifactId, expectedRevisionId: app.index.headRevisionId, snapshot: page('Index', 'competitor') })).headRevisionId; });
    const result = await updated.batch(app.actor, { requestId: randomUUID(), operations: [{ op: 'move', artifactId: app.index.artifactId, slug: 'start' }] });
    assert.equal(result.results[0]!.revisionId, competitor, 'a move reports the head a concurrent update left in place');
  } finally { await app.close(); }
});
