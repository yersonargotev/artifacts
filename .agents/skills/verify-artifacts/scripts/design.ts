import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import type { BrowserContext, Page } from 'playwright';
import { artifactReadSchema, publishResultSchema, snapshotSchema, type CanvasIndex } from '../../../../packages/artifacts/src/contracts.ts';
import { parseRetainedVerificationConfig, verifyRetainedArtifact } from './retained.ts';

interface DesignDrive {
  page: Page;
  context: BrowserContext;
  instance: { panel: string };
  directory: string;
  checks: string[];
  call(name: string, input?: unknown): Promise<Record<string, any>>;
  login(page: Page): Promise<void>;
  capture(page: Page, label: string): Promise<void>;
  record(action: string, result: unknown): Promise<void>;
  json(path: string, value: unknown): Promise<void>;
}

export async function driveDesign({ page, context, instance, directory, checks, call, login, capture, record, json }: DesignDrive) {
  page.setDefaultTimeout(10_000);
  const index: CanvasIndex = {
    v: 1,
    boards: {
      'boards/Desktop.html': { x: 0, y: 0, w: 1440, h: 900, title: 'Desktop', page: 'overview' },
      'boards/Phone.html': { x: 1520, y: 0, w: 390, h: 844, title: 'Phone', page: 'overview' },
      'boards/Detail.html': { x: 0, y: 0, w: 1440, h: 900, title: 'Detail', page: 'detail' },
      'boards/DetailPhone.html': { x: 1520, y: 0, w: 390, h: 844, title: 'Detail phone', page: 'detail' },
    },
    order: ['boards/Desktop.html', 'boards/Phone.html', 'boards/Detail.html', 'boards/DetailPhone.html'],
    notes: { review: { x: 0, y: 1020, w: 390, text: 'Review both layouts.', page: 'overview' } },
    pages: [{ id: 'overview', name: 'Overview' }, { id: 'detail', name: 'Detail' }],
  };
  const snapshot = snapshotSchema.parse({
    metadata: { title: 'Verification design', description: 'Four retained boards across two pages.' },
    content: { kind: 'design', text: JSON.stringify(index) },
    files: index.order.map((path) => ({ path, mediaType: 'text/html', encoding: 'utf8', data: `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${index.boards[path]!.title}</title><style>:root{color-scheme:light dark;--page:#eff1f5;--text:#4c4f69;--accent:#1e66f5;--surface:#e6e9ef}@media(prefers-color-scheme:dark){:root{--page:#1e1e2e;--text:#cdd6f4;--accent:#89b4fa;--surface:#313244}}*{box-sizing:border-box}body{margin:0;padding:40px;background:var(--page);color:var(--text);font:16px/1.5 system-ui}h1{font-size:36px}button{padding:12px 20px;border:2px solid var(--accent);background:var(--surface);color:var(--text);font:inherit;border-radius:8px}button:focus-visible{outline:3px solid var(--accent);outline-offset:4px}</style><main><h1>${index.boards[path]!.title}</h1><p>A retained layout ready for review.</p><button onclick="this.textContent='Interaction verified'">Try interaction</button></main></html>` })),
  });
  const created = artifactReadSchema.parse(await call('artifacts_create', { requestId: randomUUID(), snapshot }));
  const selected = { artifactId: created.artifactId, revisionId: created.revision.id };
  const saved = artifactReadSchema.parse(await call('artifacts_read', selected));
  assert.deepEqual(saved.revision.snapshot, snapshot, 'Independent MCP read preserves the complete design snapshot');
  await json(join(directory, 'saved-read.json'), saved);
  await login(page);
  await page.getByRole('link', { name: 'Verification design', exact: true }).click();
  await page.waitForURL((url) => url.pathname === `/artifacts/${created.artifactId}`);
  const canvas = page.frameLocator('.preview');
  const openDesktop = canvas.getByRole('button', { name: 'Abrir Desktop a tamaño real', exact: true });
  await openDesktop.waitFor();
  await page.locator('.preview').scrollIntoViewIfNeeded();
  assert.equal(await canvas.locator('.board:not([hidden])').count(), 2);
  assert.equal(await canvas.locator('.board iframe').count(), 4);
  for (const title of ['Desktop', 'Phone']) await canvas.frameLocator(`iframe[title="${title}"]`).getByRole('heading', { name: title, exact: true }).waitFor();
  await capture(page, 'design-panel');
  const transform = await canvas.locator('.canvas').getAttribute('style');
  await openDesktop.click();
  const nativeSize = await canvas.locator('iframe[title="Desktop"]').evaluate((frame) => ({ width: frame.clientWidth, height: frame.clientHeight, inert: frame.hasAttribute('inert') }));
  assert.deepEqual(nativeSize, { width: 1440, height: 900, inert: false });
  await canvas.frameLocator('iframe[title="Desktop"]').getByRole('button', { name: 'Try interaction', exact: true }).click();
  await canvas.frameLocator('iframe[title="Desktop"]').getByRole('button', { name: 'Interaction verified', exact: true }).waitFor();
  await capture(page, 'design-focus');
  await canvas.getByRole('button', { name: 'Volver al lienzo', exact: true }).click();
  assert.equal(await canvas.locator('.canvas').getAttribute('style'), transform, 'Focus return restores the previous canvas transform');
  await canvas.getByRole('button', { name: 'Página Detail', exact: true }).click();
  assert.equal(await canvas.locator('.board:not([hidden])').count(), 2);
  assert.deepEqual(await canvas.locator('.board:not([hidden]) iframe').evaluateAll((frames) => frames.map((frame) => frame.getAttribute('title'))), ['Detail', 'Detail phone']);
  for (const title of ['Detail', 'Detail phone']) await canvas.frameLocator(`iframe[title="${title}"]`).getByRole('heading', { name: title, exact: true }).waitFor();
  await capture(page, 'design-pages');
  await canvas.getByRole('button', { name: 'Página Overview', exact: true }).click();
  checks.push('Real HTTP MCP design create and independent complete read', 'All four nested board documents render', 'Native-size focus enables board interaction and restores canvas transform', 'Page selection filters the declared boards');

  await page.getByRole('button', { name: 'Menú de Verification design', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Descargar revisión 1', exact: true }).click();
  const browserZip = join(directory, 'browser-design.zip');
  await (await download).saveAs(browserZip);
  const exported = await call('artifacts_export', selected);
  const bytes = Buffer.from(exported.base64, 'base64');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), exported.sha256);
  assert.deepEqual(await readFile(browserZip), bytes, 'Browser and MCP exports have identical ZIP bytes');
  await writeFile(join(directory, 'mcp-design.zip'), bytes, { mode: 0o600 });
  const members = unzipSync(bytes);
  const manifest = JSON.parse(strFromU8(members['artifact.json']!));
  const recreated = snapshotSchema.parse({
    metadata: manifest.metadata,
    content: { kind: manifest.content.kind, text: strFromU8(members[manifest.content.path]!) },
    files: saved.revision.snapshot.files.map((file) => {
      const archived = manifest.files.find((entry: { path: string }) => entry.path === file.path);
      assert(archived && archived.mediaType === file.mediaType && archived.encoding === file.encoding, `Export preserves ${file.path} metadata`);
      return { path: archived.path, mediaType: archived.mediaType, encoding: archived.encoding, data: Buffer.from(members[`files/${file.path}`]!).toString(file.encoding === 'utf8' ? 'utf8' : 'base64') };
    }),
  });
  assert.deepEqual(recreated, snapshot);
  const roundtrip = artifactReadSchema.parse(await call('artifacts_create', { requestId: randomUUID(), snapshot: recreated }));
  assert.equal(roundtrip.revision.sha256, created.revision.sha256, 'ZIP recreation retains the exact snapshot digest');
  checks.push('Selected design browser ZIP equals MCP export', 'Export reconstruction with saved file order and MCP recreation preserve the snapshot SHA-256');

  const published = publishResultSchema.parse(await call('artifacts_publish', { requestId: randomUUID(), ...selected, expectedPublicationVersion: 0 }));
  const expected = artifactReadSchema.parse(await call('artifacts_read', selected));
  assert.equal(expected.publication?.revisionId, selected.revisionId);
  await json(join(directory, 'published-read.json'), expected);
  await page.goto(published.url);
  const publicationCanvas = page.frameLocator('main > iframe');
  await publicationCanvas.getByRole('button', { name: 'Abrir Desktop a tamaño real', exact: true }).click();
  await publicationCanvas.frameLocator('iframe[title="Desktop"]').getByRole('button', { name: 'Try interaction', exact: true }).click();
  await publicationCanvas.frameLocator('iframe[title="Desktop"]').getByRole('button', { name: 'Interaction verified', exact: true }).waitFor();
  await capture(page, 'design-publication');
  await publicationCanvas.getByRole('button', { name: 'Volver al lienzo', exact: true }).click();
  const anonymous = await context.browser()!.newContext();
  try {
    const denied = await anonymous.request.get(published.url, { maxRedirects: 0 });
    assert.equal(denied.status(), 303, 'Anonymous publication request requires protected admission');
    const contentUrl = await page.locator('main > iframe').getAttribute('src');
    assert(contentUrl);
    assert.equal((await anonymous.request.get(new URL(contentUrl, published.url).href, { maxRedirects: 0 })).status(), 401, 'Anonymous design content request is denied');
  } finally { await anonymous.close(); }
  await record('Protected publication design interaction and anonymous denial', { publication: published.url });
  checks.push('Protected publication displays and interacts with the retained design', 'Anonymous wrapper admission and content denial');

  const config = parseRetainedVerificationConfig({
    expected,
    panelUrl: `${instance.panel}/artifacts/${created.artifactId}?revisionId=${created.revision.id}`,
    publicationUrl: published.url,
    viewports: [{ width: 1440, height: 900 }, { width: 390, height: 844 }],
    expectations: [{ kind: 'count', selector: '.board', count: 4 }, { kind: 'count', selector: '.board:not([hidden])', count: 2 }, { kind: 'visible', selector: '[aria-label="Página Overview"]' }],
    evidenceDirectory: join(directory, 'retained'),
  });
  await json(join(directory, 'retained-config.json'), config);
  const retained = await verifyRetainedArtifact(context, config);
  assert.equal(retained.status, 'passed', JSON.stringify(retained.errors));
  checks.push('Complete retained verification passes at desktop and mobile with protected publication');
}
