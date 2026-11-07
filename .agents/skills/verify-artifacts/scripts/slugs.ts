import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { artifactReadSchema } from '../../../../packages/artifacts/src/contracts.ts';

type Snapshot = ReturnType<typeof artifactReadSchema.parse>['revision']['snapshot'];
type CliResult = { code: number | null; stdout: string; stderr: string };
interface SlugsDrive {
  page: Page;
  panel: string;
  directory: string;
  firstSnapshot: Snapshot;
  checks: string[];
  call(name: string, input?: unknown, allowError?: boolean): Promise<Record<string, any>>;
  cli(...args: string[]): Promise<CliResult>;
  ok(...args: string[]): Promise<any>;
  login(page: Page): Promise<void>;
  capture(page: Page, label: string): Promise<void>;
  record(action: string, result: unknown): Promise<void>;
}

export async function driveSlugs({ page, panel, directory, firstSnapshot, checks, call, cli, ok, login, capture, record }: SlugsDrive) {
  const page1 = { ...firstSnapshot, metadata: { title: 'RAG', description: 'Retrieval-augmented generation concept page.' }, content: { kind: 'markdown' as const, text: '# RAG\n\nRetrieval-augmented generation.\n' }, files: [] };
  const rag = artifactReadSchema.parse(await call('artifacts_create', { requestId: randomUUID(), snapshot: page1, project: 'Mi-Wiki', slug: 'concepts/rag' }));
  assert.deepEqual([rag.project, rag.slug], ['Mi-Wiki', 'concepts/rag'], 'MCP create returns the project and slug');

  const viaMcp = artifactReadSchema.parse(await call('artifacts_read', { project: 'mi-wiki', slug: 'concepts/rag' }));
  assert.deepEqual(viaMcp, rag, 'MCP read by { project, slug } returns the created page');
  const viaCli = artifactReadSchema.parse(await ok('read', '--project', 'mi-wiki', '--slug', 'concepts/rag'));
  assert.deepEqual(viaCli, rag, 'CLI read by --project and --slug over REST returns the created page');

  const conflict = await call('artifacts_create', { requestId: randomUUID(), snapshot: page1, project: 'MI-WIKI', slug: 'concepts/rag' }, true);
  assert.deepEqual(conflict, { error: 'slug_conflict', message: 'The slug already names an artifact in this project', slug: 'concepts/rag', project: 'Mi-Wiki', artifactId: rag.artifactId }, 'MCP create reports slug_conflict for a case-variant project');
  const snapshotFile = join(directory, 'rag-snapshot.json');
  await writeFile(snapshotFile, JSON.stringify(page1), { mode: 0o600 });
  const cliConflict = await cli('create', '--snapshot', snapshotFile, '--project', 'Mi-Wiki', '--slug', 'concepts/rag');
  assert.equal(cliConflict.code, 1, 'CLI create of a used slug exits 1');
  assert.match(cliConflict.stderr, /"code":"slug_conflict".*"status":409/, 'CLI create of a used slug reports slug_conflict with 409');
  const missing = await cli('read', '--project', 'Mi-Wiki', '--slug', 'concepts/missing');
  assert.equal(missing.code, 1, 'CLI read of an unknown slug exits 1');
  assert.match(missing.stderr, /"code":"not_found".*"status":404/, 'CLI read of an unknown slug reports not_found');
  const unfiled = artifactReadSchema.parse(await call('artifacts_create', { requestId: randomUUID(), snapshot: page1, slug: 'concepts/rag' }));
  assert.equal(artifactReadSchema.parse(await ok('read', '--slug', 'concepts/rag')).artifactId, unfiled.artifactId, 'The same slug without a project reads the unfiled page');

  await login(page);
  await page.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
  const card = page.locator('.artifact-card').filter({ has: page.getByRole('link', { name: 'RAG', exact: true }) }).filter({ hasText: 'Mi-Wiki' });
  assert.equal(await card.locator('.artifact-slug').textContent(), 'concepts/rag', 'The library card shows the slug');
  await capture(page, 'library-slug');
  await record('Open artifact detail Información', { artifactId: rag.artifactId });
  await page.goto(`${panel}/artifacts/${encodeURIComponent(rag.artifactId)}?tab=information`);
  await page.locator('#information').waitFor();
  assert.equal(await page.locator('#information dt:text-is("Proyecto") + dd').textContent(), 'Mi-Wiki');
  assert.equal(await page.locator('#information dt:text-is("Slug") + dd').textContent(), 'concepts/rag', 'The detail lists the slug under Información');
  await capture(page, 'detail-information-slug');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator('#information').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'The 390px detail does not overflow');
  await capture(page, 'detail-information-slug-390');

  checks.push('HTTP MCP create with project and slug', 'HTTP MCP read by { project, slug } with a case-variant project', 'Source CLI read --project --slug over REST equals the MCP create result', 'MCP slug_conflict for a case-variant project with the holder artifactId', 'CLI create slug_conflict with 409', 'CLI not_found for an unknown slug', 'Unfiled namespace holds the same slug', 'Library card and detail Información show the slug at 1440 and 390');
}
