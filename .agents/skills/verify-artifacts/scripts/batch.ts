import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { artifactReadSchema, batchResultSchema, searchResultSchema } from '../../../../packages/artifacts/src/contracts.ts';

type CliResult = { code: number | null; stdout: string; stderr: string };
interface BatchDrive {
  page: Page;
  panel: string;
  directory: string;
  checks: string[];
  call(name: string, input?: unknown, allowError?: boolean): Promise<Record<string, any>>;
  cli(...args: string[]): Promise<CliResult>;
  ok(...args: string[]): Promise<any>;
  login(page: Page): Promise<void>;
  capture(page: Page, label: string): Promise<void>;
  record(action: string, result: unknown): Promise<void>;
}

export async function driveBatch({ page, panel, directory, checks, call, cli, ok, login, capture, record }: BatchDrive) {
  const markdown = (title: string, text: string) => ({ metadata: { title, description: `${title} wiki page.` }, content: { kind: 'markdown' as const, text }, files: [] });
  const index = artifactReadSchema.parse(await call('artifacts_create', { requestId: randomUUID(), snapshot: markdown('Index', '# Index\n\nTodavía sin páginas.\n'), project: 'Mi-Wiki', slug: 'index' }));
  const log = artifactReadSchema.parse(await call('artifacts_create', { requestId: randomUUID(), snapshot: markdown('Log', '# Log\n'), project: 'Mi-Wiki', slug: 'log' }));

  const command = async (name: string, value: unknown) => {
    const path = join(directory, `${name}.json`);
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    return path;
  };
  const ingest = {
    requestId: randomUUID(),
    operations: [
      { op: 'create', project: 'mi-wiki', slug: 'sources/karpathy', snapshot: markdown('Karpathy', '# Karpathy\n\nNotas de la charla en Envigado.\n') },
      { op: 'create', project: 'mi-wiki', slug: 'concepts/rag', snapshot: markdown('RAG', '# RAG\n\nRetrieval-augmented generation.\n') },
      { op: 'create', project: 'mi-wiki', slug: 'concepts/agents', snapshot: markdown('Agents', '# Agents\n\nBorrador.\n') },
      { op: 'update', project: 'Mi-Wiki', slug: 'concepts/agents', snapshot: markdown('Agents', '# Agents\n\nAgentes que mantienen la wiki en Sabaneta.\n') },
      { op: 'update', artifactId: index.artifactId, expectedRevisionId: index.headRevisionId, snapshot: markdown('Index', '# Index\n\n- [Karpathy](sources/karpathy.md)\n- [RAG](concepts/rag.md)\n- [Agents](concepts/agents.md)\n') },
      { op: 'update', project: 'Mi-Wiki', slug: 'log', expectedRevisionId: log.headRevisionId, snapshot: markdown('Log', '# Log\n\n- Ingesta de la charla de Karpathy.\n') },
    ],
  };
  const ingestFile = await command('ingest', ingest);
  await record('Apply the ingest batch with the source CLI', { argv: ['batch', '--command', ingestFile], operations: ingest.operations.length });
  const applied = batchResultSchema.parse(await ok('batch', '--command', ingestFile));
  assert.deepEqual(applied.results.map(({ index }) => index), [0, 1, 2, 3, 4, 5], 'The batch returns one result per operation in order');
  assert.equal(applied.results[3]!.artifactId, applied.results[2]!.artifactId, 'An update addresses a page created earlier in the batch by its slug');
  assert.deepEqual([applied.results[4]!.artifactId, applied.results[5]!.artifactId], [index.artifactId, log.artifactId]);

  const agents = artifactReadSchema.parse(await call('artifacts_read', { project: 'mi-wiki', slug: 'concepts/agents' }));
  assert.deepEqual([agents.project, agents.headRevisionId, agents.revision.sequence, agents.revision.parentRevisionId], ['Mi-Wiki', applied.results[3]!.revisionId, 2, applied.results[2]!.revisionId], 'MCP reads the twice-written page at its batch head');
  const newIndex = artifactReadSchema.parse(await call('artifacts_read', { artifactId: index.artifactId }));
  assert.deepEqual([newIndex.headRevisionId, newIndex.revision.sequence, newIndex.publication], [applied.results[4]!.revisionId, 2, null], 'The index advanced one revision and the batch did not publish');
  assert.deepEqual(batchResultSchema.parse(await ok('retry', ingest.requestId)), applied, 'CLI retry replays the batch receipt');

  const stale = { requestId: randomUUID(), operations: [
    { op: 'create', project: 'Mi-Wiki', slug: 'sources/otra', snapshot: markdown('Otra', '# Otra\n') },
    { op: 'update', artifactId: index.artifactId, expectedRevisionId: index.headRevisionId, snapshot: markdown('Index', '# Index\n\nNunca.\n') },
  ] };
  const failed = await cli('batch', '--command', await command('stale', stale));
  assert.equal(failed.code, 1, 'A stale batch exits 1');
  assert.match(failed.stderr, /"code":"conflict".*"status":409.*"index":1/, 'The stale batch reports conflict at operation 1');
  const listed = await call('artifacts_list', { project: 'Mi-Wiki' });
  assert.equal(listed.items.length, 5, 'The failed batch committed none of its operations');

  const found = searchResultSchema.parse(await call('artifacts_search', { query: 'sabaneta', project: 'mi-wiki' }));
  assert.deepEqual(found.items.map(({ slug }) => slug), ['concepts/agents'], 'MCP search finds text written by the batch');
  assert.deepEqual(searchResultSchema.parse(await ok('search', 'sabaneta', '--project', 'mi-wiki')), found, 'CLI search over REST equals the MCP result');
  assert.deepEqual(searchResultSchema.parse(await call('artifacts_search', { query: 'borrador' })).items, [], 'Text the batch replaced no longer matches');
  assert.deepEqual(searchResultSchema.parse(await ok('search', 'todavia')).items, [], 'The old index text no longer matches');

  const collide = { requestId: randomUUID(), operations: [
    { op: 'move', from: { project: 'Mi-Wiki', slug: 'concepts/rag' }, slug: 'concepts/retrieval' },
    { op: 'move', from: { project: 'Mi-Wiki', slug: 'concepts/agents' }, slug: 'concepts/retrieval' },
  ] };
  const collided = await cli('batch', '--command', await command('collide', collide));
  assert.equal(collided.code, 1, 'A colliding move exits 1');
  assert.match(collided.stderr, /"code":"slug_conflict".*"status":409.*"index":1/, 'The colliding move reports slug_conflict at operation 1');
  assert.equal(artifactReadSchema.parse(await call('artifacts_read', { project: 'mi-wiki', slug: 'concepts/rag' })).artifactId, applied.results[1]!.artifactId, 'The colliding batch moved nothing');

  const reorganize = { requestId: randomUUID(), operations: [
    { op: 'move', from: { project: 'mi-wiki', slug: 'concepts/rag' }, slug: 'concepts/retrieval' },
    { op: 'update', project: 'Mi-Wiki', slug: 'concepts/retrieval', expectedRevisionId: applied.results[1]!.revisionId, snapshot: markdown('RAG', '# RAG\n\nRecuperación aumentada, renombrada en Itagüí.\n') },
    { op: 'update', artifactId: index.artifactId, expectedRevisionId: newIndex.headRevisionId, snapshot: markdown('Index', '# Index\n\n- [Karpathy](sources/karpathy.md)\n- [RAG](concepts/retrieval.md)\n- [Agents](concepts/agents.md)\n') },
  ] };
  const reorganizeFile = await command('reorganize', reorganize);
  await record('Reorganize the wiki with a batch move', { argv: ['batch', '--command', reorganizeFile], operations: reorganize.operations.length });
  const moved = batchResultSchema.parse(await ok('batch', '--command', reorganizeFile));
  assert.deepEqual(moved.results.map(({ artifactId }) => artifactId), [applied.results[1]!.artifactId, applied.results[1]!.artifactId, index.artifactId], 'A later operation addresses the moved page by its new slug');
  assert.equal(moved.results[0]!.revisionId, applied.results[1]!.revisionId, 'The move reports the head it left in place');
  const retrieval = artifactReadSchema.parse(await call('artifacts_read', { project: 'mi-wiki', slug: 'concepts/retrieval' }));
  assert.deepEqual([retrieval.artifactId, retrieval.slug, retrieval.revision.sequence], [applied.results[1]!.artifactId, 'concepts/retrieval', 2], 'MCP reads the moved page under its new slug with one new revision');
  const renamed = searchResultSchema.parse(await call('artifacts_search', { query: 'itagui', project: 'mi-wiki' }));
  assert.deepEqual(renamed.items.map(({ slug }) => slug), ['concepts/retrieval'], 'MCP search returns the moved page under its new slug');
  assert.deepEqual(searchResultSchema.parse(await ok('search', 'itagui', '--project', 'mi-wiki')), renamed, 'CLI search over REST equals the MCP result');

  const edit = { requestId: randomUUID(), operations: [
    { op: 'create', project: 'Mi-Wiki', slug: 'sources/sabaneta', snapshot: markdown('Sabaneta', '# Sabaneta\n\nNotas del taller.\n') },
    { op: 'edit', project: 'mi-wiki', slug: 'log', changes: { content: { text: '# Log\n\n- Ingesta de la charla de Karpathy.\n- Ingesta del taller de Sabaneta.\n' } } },
  ] };
  const editFile = await command('edit', edit);
  await record('Append to the log with a batch edit', { argv: ['batch', '--command', editFile], operations: edit.operations.length });
  const edited = batchResultSchema.parse(await ok('batch', '--command', editFile));
  assert.deepEqual(edited.results.map(({ index }) => index), [0, 1]);
  assert.equal(edited.results[1]!.artifactId, log.artifactId, 'The edit addresses the log by its slug');
  const editedLog = artifactReadSchema.parse(await call('artifacts_read', { project: 'mi-wiki', slug: 'log' }));
  assert.deepEqual([editedLog.headRevisionId, editedLog.revision.sequence, editedLog.revision.parentRevisionId], [edited.results[1]!.revisionId, 3, applied.results[5]!.revisionId], 'The edit writes one revision on the prior log head');
  assert.deepEqual(editedLog.revision.snapshot, markdown('Log', '# Log\n\n- Ingesta de la charla de Karpathy.\n- Ingesta del taller de Sabaneta.\n'), 'The edit changes the log text and keeps its title, description, and kind');

  await login(page);
  await page.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
  for (const title of ['Karpathy', 'RAG', 'Agents']) assert.equal(await page.locator('.artifact-card').filter({ has: page.getByRole('link', { name: title, exact: true }) }).filter({ hasText: 'Mi-Wiki' }).count(), 1, `The library shows the batch page ${title}`);
  await capture(page, 'batch-library');
  await record('Open the index detail', { artifactId: index.artifactId });
  await page.goto(`${panel}/artifacts/${encodeURIComponent(index.artifactId)}`);
  const preview = page.frameLocator('.preview');
  await preview.getByRole('heading', { level: 1, name: 'Index', exact: true }).waitFor();
  assert.equal(await preview.locator('a[href^="/artifacts/"][target="_top"]').count(), 3, 'The reorganized index links in the rendered preview resolve to the three batch pages, including the moved one');
  assert.equal(await preview.locator('.broken-link').count(), 0, 'No index link is broken in the preview');
  assert.equal(await page.getByRole('region', { name: 'Enlaces', exact: true }).count(), 0, 'Enlaces is absent without broken links');
  await capture(page, 'batch-index');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await preview.getByRole('heading', { level: 1, name: 'Index', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'The 390px index detail does not overflow');
  await capture(page, 'batch-index-390');

  checks.push('Source CLI batch over REST creates three pages and updates the index, the log, and a page created earlier in the batch', 'HTTP MCP reads show the batch heads and sequences, without publication', 'CLI retry replays the batch receipt', 'A stale batch exits 1 with conflict at its index and commits nothing', 'HTTP MCP and CLI search find batch text and not replaced text', 'A colliding batch move exits 1 with slug_conflict at its index and moves nothing', 'A CLI batch moves a page, updates it and the index by its new slug, and MCP and CLI search return it under that slug', 'A CLI batch edit by project and slug appends to the log beside a create, and MCP reads the merged head on the prior one', 'The panel library shows the batch pages, and the rendered index links resolve to them with no Enlaces section at desktop and 390px');
}
