import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Page } from 'playwright';
import { artifactReadSchema } from '../../../../packages/artifacts/src/contracts.ts';

interface LinksDrive {
  page: Page;
  panel: string;
  checks: string[];
  call(name: string, input?: unknown, allowError?: boolean): Promise<Record<string, any>>;
  login(page: Page): Promise<void>;
  capture(page: Page, label: string): Promise<void>;
  record(action: string, result: unknown): Promise<void>;
}

export async function driveLinks({ page, panel, checks, call, login, capture, record }: LinksDrive) {
  const markdown = (title: string, text: string) => ({ metadata: { title, description: `${title} wiki page.` }, content: { kind: 'markdown' as const, text }, files: [] });
  const create = async (title: string, text: string, slug: string) => artifactReadSchema.parse(await call('artifacts_create', { requestId: randomUUID(), snapshot: markdown(title, text), project: 'Mi-Wiki', slug }));
  const rag = await create('RAG', '# RAG\n\nRetrieval-augmented generation.\n', 'concepts/rag');
  const sourceText = '# Karpathy\n\nSee [the RAG concept](../concepts/rag.md#history), the [missing page](../concepts/missing.md), and [the site](https://karpathy.ai).\n\n```md\n[not a link](../concepts/rag.md)\n```\n';
  const source = await create('Karpathy', sourceText, 'sources/karpathy');

  await login(page);
  await page.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
  await record('Open the source page detail', { artifactId: source.artifactId });
  await page.goto(`${panel}/artifacts/${encodeURIComponent(source.artifactId)}`);
  const section = page.getByRole('region', { name: 'Enlaces', exact: true });
  await section.waitFor();
  const items = section.getByRole('listitem');
  assert.equal(await items.count(), 2, 'Enlaces lists the two relative links and skips the https link and the fenced code');
  await capture(page, 'links-section');

  const link = section.getByRole('link', { name: 'the RAG concept', exact: true });
  assert.equal(await link.getAttribute('href'), `/artifacts/${encodeURIComponent(rag.artifactId)}`, 'The resolved link points at the RAG page');
  await record('Click the RAG link in Enlaces', { href: await link.getAttribute('href') });
  await link.click();
  await page.waitForURL((url) => url.pathname === `/artifacts/${encodeURIComponent(rag.artifactId)}`);
  await page.getByRole('heading', { level: 1, name: 'RAG', exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: 'Enlaces', exact: true }).getByText('Esta página no tiene enlaces relativos.').count(), 1, 'The RAG page shows the empty Enlaces state');
  await capture(page, 'links-target');

  await record('Go back to the source page', {});
  await page.goBack();
  await section.waitFor();
  const broken = section.locator('[data-link-state="broken"]');
  assert.equal(await broken.count(), 1, 'One link is marked broken');
  assert.equal(await broken.getByRole('link').count(), 0, 'A broken link is not navigable');
  assert.match((await broken.innerText()).replace(/\s+/g, ' '), /missing page No existe \.\.\/concepts\/missing\.md/, 'The broken item shows its text, the No existe marker, and the raw href');
  await capture(page, 'links-broken');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await section.waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'The 390px detail with Enlaces does not overflow');
  await capture(page, 'links-section-390');

  checks.push('HTTP MCP create of two Markdown pages with project and slug', 'Enlaces lists relative links only, skipping https and fenced code', 'Clicking a resolved link opens the target page detail', 'A missing target is marked broken with No existe and is not a link', 'The 390px detail with Enlaces does not overflow');
}
