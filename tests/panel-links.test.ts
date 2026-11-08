import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createArtifactStore, type Actor } from '../packages/artifacts/src/index.ts';
import { createPanel } from '../packages/artifacts/src/panel/index.ts';
import { pageLinks } from '../packages/artifacts/src/panel/links.ts';
import { fixture } from './helpers.ts';

const resolved = (markdown: string, from: string | null) => pageLinks(markdown, from).map(({ href, candidate }) => ({ href, candidate }));

test('relative links resolve as paths against the page slug, without .md or the fragment', () => {
  assert.deepEqual(resolved('[RAG](../concepts/rag.md) and [history](rag.md#history) and [root](/index.md?x=1) and [dot](./sub/../karpathy-notes.md)', 'sources/karpathy'), [
    { href: '../concepts/rag.md', candidate: { kind: 'slug', slug: 'concepts/rag' } },
    { href: 'rag.md#history', candidate: { kind: 'slug', slug: 'sources/rag' } },
    { href: '/index.md?x=1', candidate: { kind: 'slug', slug: 'index' } },
    { href: './sub/../karpathy-notes.md', candidate: { kind: 'slug', slug: 'sources/karpathy-notes' } },
  ]);
});

test('scheme, protocol-relative, and pure fragment links are not wiki links', () => {
  assert.deepEqual(pageLinks('[web](https://example.com/a.md) [mail](mailto:a@example.com) [net](//example.com/a.md) [top](#x) [query](?q=1)', 'index'), []);
});

test('links that leave the project, start from an unslugged page, or name no valid slug are broken', () => {
  assert.deepEqual(resolved('[up](../../x.md)', 'sources/karpathy'), [{ href: '../../x.md', candidate: { kind: 'broken', reason: 'outside' } }]);
  assert.deepEqual(resolved('[rag](concepts/rag.md) [root](/index.md)', null), [
    { href: 'concepts/rag.md', candidate: { kind: 'broken', reason: 'unslugged' } },
    { href: '/index.md', candidate: { kind: 'slug', slug: 'index' } },
  ]);
  assert.deepEqual(resolved('[caps](Concepts/RAG.md) [bad](%E0%A4%A.md)', 'index'), [
    { href: 'Concepts/RAG.md', candidate: { kind: 'broken', reason: 'missing' } },
    { href: '%E0%A4%A.md', candidate: { kind: 'broken', reason: 'missing' } },
  ]);
});

test('code, images, and raw HTML are not links; reference links are, deduplicated in document order', () => {
  const markdown = [
    'Use `[span](span.md)` and ![diagram](diagram.md) and <a href="html.md">html</a>.',
    '',
    '```md',
    '[fenced](fenced.md)',
    '```',
    '',
    'See [the **RAG** page][rag], then [again](concepts/rag.md) and [first](log.md) and [second](log.md).',
    '',
    '[rag]: concepts/rag.md',
  ].join('\n');
  assert.deepEqual(pageLinks(markdown, 'index').map(({ href, text }) => ({ href, text })), [
    { href: 'concepts/rag.md', text: 'the RAG page' },
    { href: 'log.md', text: 'first' },
  ]);
});

test('the panel detail resolves Markdown links to pages of the same project at their current slugs', async () => {
  const app = await fixture();
  try {
    const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
    assert(signedIn);
    const actor: Actor = { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'panel-links-test', scopes: ['artifacts:read', 'artifacts:write'] };
    const options = { access: { ownerEmail: 'owner@example.test', allowGuests: false }, publishOrigin: 'https://published.example.test' };
    const store = createArtifactStore(app.db, options);
    const panel = createPanel(app.db, options);
    const page = (title: string, text: string, project: string | undefined, slug: string | undefined, kind: 'markdown' | 'text' = 'markdown') =>
      store.create(actor, { requestId: randomUUID(), snapshot: { metadata: { title, description: '' }, content: { kind, text }, files: [] }, project, slug });
    const rag = await page('Retrieval', '# RAG', 'Wiki', 'concepts/rag');
    await page('Elsewhere', '# Other', 'Other', 'concepts/other');
    const source = await page('Karpathy', '[RAG](../concepts/rag.md#intro) [gone](../concepts/missing.md) [up](../../x.md) [other](../concepts/other.md) [web](https://example.com)', 'Wiki', 'sources/karpathy');
    const plain = await page('Plain', '[RAG](../concepts/rag.md)', 'Wiki', 'notes', 'text');

    const { detail } = await panel.artifact(actor, { artifactId: source.artifactId, includeComparison: false });
    assert.deepEqual(detail.links, [
      { href: '../concepts/rag.md#intro', text: 'RAG', target: { state: 'resolved', artifactId: rag.artifactId, slug: 'concepts/rag', title: 'Retrieval' } },
      { href: '../concepts/missing.md', text: 'gone', target: { state: 'broken', reason: 'missing' } },
      { href: '../../x.md', text: 'up', target: { state: 'broken', reason: 'outside' } },
      { href: '../concepts/other.md', text: 'other', target: { state: 'broken', reason: 'missing' } },
    ]);
    assert.equal((await panel.artifact(actor, { artifactId: plain.artifactId, includeComparison: false })).detail.links, null);

    await store.update(actor, { requestId: randomUUID(), artifactId: source.artifactId, expectedRevisionId: source.headRevisionId, snapshot: { metadata: { title: 'Karpathy', description: '' }, content: { kind: 'markdown', text: 'No links now.' }, files: [] } });
    await store.move(actor, { requestId: randomUUID(), artifactId: rag.artifactId, slug: 'concepts/retrieval' });
    const older = await panel.artifact(actor, { artifactId: source.artifactId, revisionId: source.headRevisionId, includeComparison: false });
    assert.deepEqual(older.detail.links?.[0]?.target, { state: 'broken', reason: 'missing' }, 'an older revision resolves against current slugs');
    assert.deepEqual((await panel.artifact(actor, { artifactId: source.artifactId, includeComparison: false })).detail.links, []);
  } finally { await app.close(); }
});

test('the panel preview reads the selected revision with the same links as the detail', async () => {
  const app = await fixture();
  try {
    const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
    assert(signedIn);
    const actor: Actor = { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'panel-links-test', scopes: ['artifacts:read', 'artifacts:write'] };
    const options = { access: { ownerEmail: 'owner@example.test', allowGuests: false }, publishOrigin: 'https://published.example.test' };
    const store = createArtifactStore(app.db, options);
    const panel = createPanel(app.db, options);
    const page = (title: string, text: string, slug: string, kind: 'markdown' | 'text' = 'markdown') =>
      store.create(actor, { requestId: randomUUID(), snapshot: { metadata: { title, description: '' }, content: { kind, text }, files: [] }, project: 'Wiki', slug });
    await page('Retrieval', '# RAG', 'concepts/rag');
    const source = await page('Karpathy', '[RAG](../concepts/rag.md) [gone](../concepts/missing.md)', 'sources/karpathy');
    const updated = await store.update(actor, { requestId: randomUUID(), artifactId: source.artifactId, expectedRevisionId: source.headRevisionId, snapshot: { metadata: { title: 'Karpathy', description: '' }, content: { kind: 'markdown', text: 'Now [RAG](../concepts/rag.md) only.' }, files: [] } });
    const notes = await page('Notes', '[RAG](../concepts/rag.md)', 'notes', 'text');

    for (const revisionId of [source.headRevisionId, updated.headRevisionId]) {
      const preview = await panel.preview(actor, { artifactId: source.artifactId, revisionId });
      const { detail } = await panel.artifact(actor, { artifactId: source.artifactId, revisionId, includeComparison: false });
      assert.equal(preview.revision.id, revisionId);
      assert.deepEqual(preview.revision, detail.selected.revision);
      assert.deepEqual(preview.links, detail.links);
    }
    assert.equal((await panel.preview(actor, { artifactId: source.artifactId, revisionId: source.headRevisionId })).links?.length, 2);
    assert.equal((await panel.preview(actor, { artifactId: notes.artifactId, revisionId: notes.headRevisionId })).links, null);

    await assert.rejects(panel.preview(actor, { artifactId: source.artifactId, revisionId: notes.headRevisionId }), { code: 'not_found' }, 'a revision of another artifact is not found');
    await assert.rejects(panel.preview({ ...actor, userId: 'someone-else' }, { artifactId: source.artifactId, revisionId: source.headRevisionId }), 'another user cannot read the preview');
    await assert.rejects(panel.preview({ ...actor, scopes: ['artifacts:write'] }, { artifactId: source.artifactId, revisionId: source.headRevisionId }), { code: 'forbidden' });
  } finally { await app.close(); }
});
