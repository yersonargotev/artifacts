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

  await login(page);
  await page.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
  for (const title of ['Karpathy', 'RAG', 'Agents']) assert.equal(await page.locator('.artifact-card').filter({ has: page.getByRole('link', { name: title, exact: true }) }).filter({ hasText: 'Mi-Wiki' }).count(), 1, `The library shows the batch page ${title}`);
  await capture(page, 'batch-library');
  await record('Open the index detail', { artifactId: index.artifactId });
  await page.goto(`${panel}/artifacts/${encodeURIComponent(index.artifactId)}`);
  const section = page.getByRole('region', { name: 'Enlaces', exact: true });
  await section.waitFor();
  assert.equal(await section.getByRole('link').count(), 3, 'The batch index links resolve to the three pages the same batch created');
  assert.equal(await section.locator('[data-link-state="broken"]').count(), 0, 'No index link is broken');
  await capture(page, 'batch-index');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await section.waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'The 390px index detail does not overflow');
  await capture(page, 'batch-index-390');

  checks.push('Source CLI batch over REST creates three pages and updates the index, the log, and a page created earlier in the batch', 'HTTP MCP reads show the batch heads and sequences, without publication', 'CLI retry replays the batch receipt', 'A stale batch exits 1 with conflict at its index and commits nothing', 'HTTP MCP and CLI search find batch text and not replaced text', 'The panel library shows the batch pages, and the index links resolve to them at desktop and 390px');
}
