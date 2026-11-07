import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { artifactReadSchema } from '../../../../packages/artifacts/src/contracts.ts';
import { waitForMoveReadiness } from './move-readiness.ts';

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

  assert.deepEqual(await ok('move', rag.artifactId, '--slug', 'concepts/retrieval'), { artifactId: rag.artifactId, project: 'Mi-Wiki' }, 'CLI move --slug renames in place');
  const renamed = artifactReadSchema.parse(await ok('read', '--project', 'Mi-Wiki', '--slug', 'concepts/retrieval'));
  assert.equal(renamed.artifactId, rag.artifactId, 'CLI read --slug finds the new slug');
  assert.equal(renamed.headRevisionId, rag.headRevisionId, 'A slug change creates no revision');
  const oldSlug = await cli('read', '--project', 'Mi-Wiki', '--slug', 'concepts/rag');
  assert.match(oldSlug.stderr, /"code":"not_found".*"status":404/, 'The old slug no longer resolves');
  const taken = await cli('move', unfiled.artifactId, '--project', 'Mi-Wiki', '--slug', 'concepts/retrieval');
  assert.equal(taken.code, 1, 'CLI move to a used slug exits 1');
  assert.match(taken.stderr, /"code":"slug_conflict".*"status":409/, 'CLI move to a used slug reports slug_conflict with 409');
  assert.equal(artifactReadSchema.parse(await call('artifacts_read', { artifactId: unfiled.artifactId })).project, null, 'A conflicting CLI move changes nothing');
  assert.deepEqual(await ok('move', rag.artifactId, '--no-slug'), { artifactId: rag.artifactId, project: 'Mi-Wiki' });
  assert.equal(artifactReadSchema.parse(await call('artifacts_read', { artifactId: rag.artifactId })).slug, null, 'CLI move --no-slug clears the slug');
  assert.equal((await ok('history', rag.artifactId)).items.length, 1, 'Slug moves leave one revision');

  const titled = (title: string) => ({ ...page1, metadata: { title, description: 'Slug conflict page.' }, content: { kind: 'markdown' as const, text: `# ${title}\n` } });
  const create = async (title: string, project: string, slug: string) => artifactReadSchema.parse(await call('artifacts_create', { requestId: randomUUID(), snapshot: titled(title), project, slug }));
  await create('Portada', 'Mi-Wiki', 'index');
  await create('Bitácora', 'Mi-Wiki', 'log');
  const drafts = [await create('Índice borrador', 'Borradores', 'index'), await create('Registro borrador', 'Borradores', 'log')];
  await page.setViewportSize({ width: 1440, height: 900 });
  await record('Open Borradores, select both drafts, and move them to Mi-Wiki', { artifactIds: drafts.map(({ artifactId }) => artifactId) });
  await page.goto(`${panel}/?project=Borradores`);
  for (const draft of drafts) await page.getByRole('checkbox', { name: `Seleccionar ${draft.revision.snapshot.metadata.title}`, exact: true }).check();
  await waitForMoveReadiness(page);
  await page.getByRole('button', { name: 'Mover a otro proyecto', exact: true }).press('Enter');
  await page.getByRole('dialog').waitFor();
  await page.getByLabel('Proyecto', { exact: true }).fill('mi-wiki');
  await page.getByLabel('Proyecto', { exact: true }).press('Tab');
  const response = page.waitForResponse((candidate) => candidate.request().method() === 'POST' && new URL(candidate.url()).pathname === '/move');
  await page.getByRole('dialog').getByRole('button', { name: 'Mover', exact: true }).press('Enter');
  assert.equal((await response).status(), 409, 'The bulk move answers 409');
  await page.getByRole('heading', { level: 1, name: 'Hay slugs en conflicto', exact: true }).waitFor();
  const alert = page.getByRole('alert');
  assert.match(await alert.innerText(), /No se movió ningún artefacto\. Estos slugs chocarían en Mi-Wiki/, 'The alert names the destination');
  const listed = (await alert.locator('.move-conflicts li').allTextContents()).map((text) => text.replace(/\s+/g, ' ').trim()).sort();
  assert.deepEqual(listed, ['Registro borrador log', 'Índice borrador index'].sort(), 'The alert lists each conflicting artifact with its slug');
  await capture(page, 'bulk-slug-conflict');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'The 390px conflict page does not overflow');
  await capture(page, 'bulk-slug-conflict-390');
  const after = await Promise.all(drafts.map(async ({ artifactId }) => artifactReadSchema.parse(await call('artifacts_read', { artifactId }))));
  assert.deepEqual(after, drafts, 'Nothing moved');

  checks.push('HTTP MCP create with project and slug', 'HTTP MCP read by { project, slug } with a case-variant project', 'Source CLI read --project --slug over REST equals the MCP create result', 'MCP slug_conflict for a case-variant project with the holder artifactId', 'CLI create slug_conflict with 409', 'CLI not_found for an unknown slug', 'Unfiled namespace holds the same slug', 'Library card and detail Información show the slug at 1440 and 390', 'CLI move --slug renames in place and read --slug finds the new slug with the same head revision', 'CLI move into a used slug reports slug_conflict with 409 and changes nothing', 'CLI move --no-slug clears the slug without a revision', 'Panel bulk move into a project that holds both slugs answers 409, lists both drafts with their slugs at 1440 and 390, and moves nothing');
}
