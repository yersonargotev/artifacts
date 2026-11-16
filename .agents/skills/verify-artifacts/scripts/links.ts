import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Page } from 'playwright';
import { artifactReadSchema } from '../../../../packages/contracts/src/index.ts';

interface LinksDrive {
  page: Page;
  panel: string;
  checks: string[];
  call(name: string, input?: unknown, allowError?: boolean): Promise<Record<string, any>>;
  login(page: Page): Promise<void>;
  capture(page: Page, label: string, fullPage?: boolean): Promise<void>;
  record(action: string, result: unknown): Promise<void>;
}

const hostile = '<script>parent.postMessage("script ran", "*")</script>';
const hostileImage = '<img src=x onerror="parent.postMessage(\'image ran\', \'*\')">';

export async function driveLinks({ page, panel, checks, call, login, capture, record }: LinksDrive) {
  const markdown = (title: string, text: string) => ({ metadata: { title, description: `${title} wiki page.` }, content: { kind: 'markdown' as const, text }, files: [] });
  const create = async (title: string, text: string, slug: string) => artifactReadSchema.parse(await call('artifacts_create', { requestId: randomUUID(), snapshot: markdown(title, text), project: 'Mi-Wiki', slug }));
  const rag = await create('RAG', '# RAG\n\nRetrieval-augmented generation.\n', 'concepts/rag');
  const sourceText = [
    '# Karpathy', '',
    'See [the RAG concept](../concepts/rag.md#history), the [missing page](../concepts/missing.md), and [the site](https://karpathy.ai).', '',
    '- **Talk** notes', '- *Slides* pending', '',
    '| Topic | Page |', '|---|---|', '| Retrieval | rag |', '',
    hostile, '', hostileImage, '',
    '```md', '[not a link](../concepts/rag.md)', '```', '',
  ].join('\n');
  const source = await create('Karpathy', sourceText, 'sources/karpathy');

  const messages: string[] = [];
  await page.exposeFunction('recordFrameMessage', (message: string) => { messages.push(message); });
  await page.addInitScript(() => addEventListener('message', (event) => (window as Window & { recordFrameMessage?: (message: string) => void }).recordFrameMessage?.(String(event.data))));
  await login(page);
  await page.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
  await record('Open the source page detail', { artifactId: source.artifactId });
  await page.goto(`${panel}/artifacts/${encodeURIComponent(source.artifactId)}`);
  const iframe = page.locator('iframe.preview');
  assert.equal(await iframe.getAttribute('sandbox'), 'allow-top-navigation-by-user-activation allow-popups allow-popups-to-escape-sandbox', 'The Markdown iframe adds only link navigation to its sandbox');
  const frame = page.frameLocator('.preview');
  await frame.getByRole('heading', { level: 1, name: 'Karpathy', exact: true }).waitFor();
  assert.equal(await frame.getByRole('listitem').count(), 2, 'The rendered list has two items');
  assert.equal(await frame.locator('strong').filter({ hasText: 'Talk' }).count(), 1, 'Emphasis renders');
  assert.equal(await frame.getByRole('cell', { name: 'Retrieval', exact: true }).count(), 1, 'The table renders');
  assert.equal(await frame.locator('pre code').innerText(), '[not a link](../concepts/rag.md)\n', 'Fenced code stays code');
  assert.equal(await frame.locator('script, img').count(), 0, 'Raw HTML creates no script or image element');
  assert.equal(await frame.getByText(hostile, { exact: true }).count(), 1, 'Raw script is shown as text');
  assert.equal(await frame.getByText(hostileImage, { exact: true }).count(), 1, 'Raw image is shown as text');

  const external = frame.getByRole('link', { name: 'the site', exact: true });
  assert.deepEqual([await external.getAttribute('href'), await external.getAttribute('target'), await external.getAttribute('rel')], ['https://karpathy.ai', '_blank', 'noopener noreferrer'], 'The external link opens a new tab without opener or referrer');
  const brokenInFrame = frame.locator('.broken-link');
  assert.deepEqual([await brokenInFrame.innerText(), await brokenInFrame.getAttribute('title')], ['missing page', 'No existe'], 'The broken link is marked text with its reason');
  assert.equal(await frame.getByRole('link', { name: 'missing page' }).count(), 0, 'The broken link is not a link');

  const section = page.getByRole('region', { name: 'Enlaces', exact: true });
  await section.waitFor();
  const broken = section.locator('[data-link-state="broken"]');
  assert.equal(await section.getByRole('listitem').count(), 1, 'Enlaces lists only the broken link');
  assert.equal(await section.getByRole('link').count(), 0, 'Enlaces has no navigable link');
  assert.match((await broken.innerText()).replace(/\s+/g, ' '), /missing page No existe \.\.\/concepts\/missing\.md/, 'The broken item shows its text, the No existe marker, and the raw href');
  await record('Rendered preview inside the iframe', { aria: await frame.locator('main').ariaSnapshot() });
  await capture(page, 'links-render');
  await capture(page, 'links-render-viewport', false);

  const internal = frame.getByRole('link', { name: 'the RAG concept', exact: true });
  assert.deepEqual([await internal.getAttribute('href'), await internal.getAttribute('target')], [`/artifacts/${encodeURIComponent(rag.artifactId)}`, '_top'], 'The resolved link targets the RAG detail in the main window');
  await record('Click the RAG link inside the preview', { href: await internal.getAttribute('href') });
  await internal.click();
  await page.waitForURL((url) => url.pathname === `/artifacts/${encodeURIComponent(rag.artifactId)}`);
  await page.getByRole('heading', { level: 1, name: 'RAG', exact: true }).waitFor();
  await frame.getByRole('heading', { level: 1, name: 'RAG', exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: 'Enlaces', exact: true }).count(), 0, 'The RAG page has no broken links and no Enlaces section');
  await record('Landed on the RAG detail with the panel session', { url: page.url() });
  await capture(page, 'links-target');

  await record('Go back to the source page', {});
  await page.goBack();
  await section.waitFor();
  await frame.getByRole('heading', { level: 1, name: 'Karpathy', exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await section.waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'The 390px detail with Enlaces does not overflow');
  await capture(page, 'links-section-390');

  await page.setViewportSize({ width: 1440, height: 900 });
  const { url: publication } = await call('artifacts_publish', { requestId: randomUUID(), artifactId: source.artifactId, revisionId: source.revision.id, expectedPublicationVersion: 0 });
  assert.equal(typeof publication, 'string', 'Publishing returns the publication URL');
  await record('Open the published source page', { url: publication });
  await page.goto(publication);
  const published = page.frameLocator('main > iframe');
  await published.getByRole('heading', { level: 1, name: 'Karpathy', exact: true }).waitFor();
  assert.equal(await page.locator('main > iframe').getAttribute('sandbox'), 'allow-top-navigation-by-user-activation allow-popups allow-popups-to-escape-sandbox', 'The published Markdown frame adds only link navigation to its sandbox');
  const modes = page.getByRole('navigation', { name: 'Modo de lectura', exact: true });
  assert.equal(await modes.getByRole('link', { name: 'Vista', exact: true }).getAttribute('aria-current'), 'page', 'The publication opens in Vista');
  assert.equal(await published.getByRole('cell', { name: 'Retrieval', exact: true }).count(), 1, 'The published table renders');
  assert.equal(await published.getByRole('link', { name: 'the RAG concept', exact: true }).count(), 0, 'A relative link is plain text for viewers');
  assert.equal(await published.locator('p').filter({ hasText: 'See the RAG concept, the missing page, and the site.' }).count(), 1, 'The relative link text stays visible');
  assert.equal(await published.locator('.broken-link').count(), 0, 'Viewers see no broken-link marker');
  assert.equal(await published.getByRole('link', { name: 'the site', exact: true }).getAttribute('target'), '_blank', 'The external link opens a new tab');
  assert.equal(await published.locator('script, img').count(), 0, 'Published raw HTML creates no script or image element');
  await capture(page, 'links-published-view', false);

  await record('Switch the publication to Código', {});
  await modes.getByRole('link', { name: 'Código', exact: true }).click();
  await page.waitForURL((url) => url.search === '?view=source');
  await published.getByText('# Karpathy', { exact: false }).waitFor();
  assert.equal(await published.locator('pre').innerText(), sourceText, 'Código shows the stored Markdown');
  assert.equal(await published.getByRole('heading').count(), 0, 'Código renders no heading');
  assert.equal(await modes.getByRole('link', { name: 'Código', exact: true }).getAttribute('aria-current'), 'page', 'Código is the current mode');
  await capture(page, 'links-published-source', false);

  await record('Go back to Vista', {});
  await page.goBack();
  await published.getByRole('heading', { level: 1, name: 'Karpathy', exact: true }).waitFor();
  assert.equal(new URL(page.url()).search, '', 'Back returns to the Vista URL');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await published.getByRole('heading', { level: 1, name: 'Karpathy', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'The 390px publication with the mode switch does not overflow');
  assert(await modes.getByRole('link', { name: 'Código', exact: true }).isVisible(), 'The mode switch stays visible at 390px');
  await capture(page, 'links-published-390', false);
  assert.deepEqual(messages, [], 'No raw HTML in the page ran');

  checks.push('The publication opens the Markdown rendered with relative links as text, and Código shows the stored source and survives Back', 'The 390px publication with the mode switch does not overflow');
  checks.push('HTTP MCP create of two Markdown pages with project and slug', 'The Markdown iframe sandbox adds only top navigation by user activation and popups', 'The panel preview renders headings, lists, emphasis, tables, and fenced code', 'Raw script and image HTML show as text and never run', 'The external link opens a new tab with noopener noreferrer', 'The broken link is marked text with No existe, not a link', 'Enlaces lists only the broken link', 'Clicking the resolved link inside the preview navigates the main window to the target detail with the panel session', 'The 390px detail with Enlaces does not overflow');
}
