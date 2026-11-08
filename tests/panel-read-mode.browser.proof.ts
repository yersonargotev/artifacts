import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { artifactReadSchema } from '../packages/contracts/src/index.ts';
import { previewHref } from '../apps/dashboard/src/urls.ts';
import { grant } from './helpers.ts';
import { restCliFixture } from './rest-cli-fixture.ts';

const evidence = resolve(process.env.PANEL_READ_MODE_EVIDENCE ?? `.test-artifacts/panel-read-mode-${Date.now()}`);
await mkdir(evidence, { recursive: true, mode: 0o700 });
const app = await restCliFixture({ directory: evidence });
const browser = await chromium.launch({ channel: 'chrome' });
const tokens = await grant(app, 'openid profile offline_access artifacts:read artifacts:write artifacts:publish');
const checks: string[] = [];
const errors: string[] = [];
const record = (action: string, result: unknown) => appendFile(join(evidence, 'actions.jsonl'), `${JSON.stringify({ time: new Date().toISOString(), action, result })}\n`, { mode: 0o600 });
const json = (name: string, result: unknown) => writeFile(join(evidence, name), JSON.stringify(result, null, 2), { mode: 0o600 });
async function mcp(name: string, input: unknown = {}) {
  const response = await fetch(app.config.resource, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${tokens.access_token}`, 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } }) });
  assert.equal(response.status, 200);
  const text = await response.text();
  const payload = JSON.parse(text.startsWith('event:') ? text.split('\n').find((line) => line.startsWith('data:'))!.slice(5) : text);
  assert(!payload.error && !payload.result.isError, text);
  await record(`MCP ${name}`, { input });
  return payload.result.structuredContent;
}
const snapshot = (title: string, text: string) => ({ metadata: { title, description: `Descripción de ${title}` }, content: { kind: 'text' as const, text }, files: [] });
const create = async (title: string, project: string, text = `Cuerpo de ${title}`) => artifactReadSchema.parse(await mcp('artifacts_create', { requestId: randomUUID(), snapshot: snapshot(title, text), project }));
const capture = async (page: Page, name: string) => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} has no horizontal overflow`);
  await page.screenshot({ path: join(evidence, `${name}.png`), fullPage: true, animations: 'disabled' });
  await record('Capture actual panel', { name, url: page.url() });
};
const list = (page: Page) => page.getByRole('navigation', { name: 'Artefactos', exact: true });
const titles = (page: Page) => list(page).locator('.reader-item-title').allTextContents();
const current = (page: Page) => list(page).locator('[aria-current=page] .reader-item-title').allTextContents();
const frameSrc = (page: Page) => page.locator('iframe.reader-preview').getAttribute('src');
const artifactParam = (page: Page) => new URL(page.url()).searchParams.get('artifact');
const showsPreview = async (page: Page, read: { artifactId: string; headRevisionId: string }, text: string) => {
  await page.waitForFunction((src) => document.querySelector('iframe.reader-preview')?.getAttribute('src') === src, previewHref(read.artifactId, read.headRevisionId));
  await page.frameLocator('iframe.reader-preview').getByText(text, { exact: false }).waitFor();
};
let active: Page | undefined;
try {
  const setup = await browser.newContext();
  const login = await setup.newPage();
  await login.goto(app.dashboard);
  await login.getByRole('link', { name: 'Iniciar sesión', exact: true }).press('Enter');
  await login.getByLabel('Correo electrónico').fill('owner@example.test');
  await login.getByLabel('Contraseña').fill(app.password);
  await login.getByRole('button', { name: 'Iniciar sesión', exact: true }).press('Enter');
  await login.getByRole('heading', { level: 1, name: 'Biblioteca', exact: true }).waitFor();
  const state = await setup.storageState();
  await setup.close();

  const published = await create('Guía publicada', 'Lectura');
  const pendingFirst = await create('Borrador con cambios', 'Lectura');
  const draft = await create('Notas sin publicar', 'Lectura');
  for (const read of [published, pendingFirst]) await mcp('artifacts_publish', { requestId: randomUUID(), artifactId: read.artifactId, revisionId: read.headRevisionId, expectedPublicationVersion: 0 });
  const pending = artifactReadSchema.parse(await mcp('artifacts_update', { requestId: randomUUID(), artifactId: pendingFirst.artifactId, expectedRevisionId: pendingFirst.headRevisionId, snapshot: snapshot('Borrador con cambios', 'Contenido nuevo del borrador') }));
  await create('Otra nota', 'Otro');
  const archive = [];
  for (let index = 0; index < 26; index++) archive.push(await create(`Archivo ${String(index).padStart(2, '0')}`, 'Archivo'));

  const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 } });
  const page = active = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto(`${app.dashboard}/?project=Lectura&status=all&sort=title`);
  const entry = page.locator('.library-view-controls').getByRole('link', { name: 'Modo lectura', exact: true });
  assert.equal(await entry.getAttribute('href'), '/read?project=Lectura&sort=title');
  await page.goto(`${app.dashboard}/?project=Lectura`);
  await Promise.all([page.waitForURL(`${app.dashboard}/read?project=Lectura`), entry.click()]);
  assert.deepEqual(await titles(page), ['Borrador con cambios', 'Notas sin publicar', 'Guía publicada']);
  assert.deepEqual(await list(page).locator('.artifact-status').allTextContents(), ['Cambios pendientes', 'Sin publicar', 'Publicado']);
  assert.deepEqual(await current(page), ['Borrador con cambios']);
  await showsPreview(page, pending, 'Contenido nuevo del borrador');
  assert.equal(await page.locator('iframe.reader-preview').getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await page.getByRole('heading', { level: 2, name: 'Borrador con cambios', exact: true }).count(), 1);
  assert.equal(await page.getByRole('link', { name: 'Ver artefacto', exact: true }).getAttribute('href'), `/artifacts/${pending.artifactId}`);
  assert.equal(await page.locator('.reader-pane').getByRole('link', { name: 'Abrir publicación', exact: true }).getAttribute('href'), pending.publication!.url);
  assert.equal(await page.getByRole('link', { name: 'Otro (1)', exact: true }).getAttribute('href'), '/read?project=Otro');
  await capture(page, 'read-1440');
  checks.push('the library link opens read mode for the project, listing all its artifacts with status badges and previewing the first head revision');

  const filters = page.getByRole('navigation', { name: 'Filtrar por publicación', exact: true });
  await Promise.all([page.waitForURL(`${app.dashboard}/read?project=Lectura&status=published`), filters.getByRole('link', { name: 'Publicados (1)', exact: true }).click()]);
  assert.deepEqual(await titles(page), ['Guía publicada']);
  assert.deepEqual(await current(page), ['Guía publicada']);
  await showsPreview(page, published, 'Cuerpo de Guía publicada');
  await Promise.all([page.waitForURL(`${app.dashboard}/read?project=Lectura`), filters.getByRole('link', { name: 'Todos (3)', exact: true }).click()]);
  assert.deepEqual(await titles(page), ['Borrador con cambios', 'Notas sin publicar', 'Guía publicada']);
  checks.push('the status filter narrows the list and stays in read mode');

  await page.evaluate(() => { (window as unknown as { readerDocument: string }).readerDocument = 'first'; });
  const sameDocument = () => page.evaluate(() => (window as unknown as { readerDocument?: string }).readerDocument === 'first');
  await list(page).getByRole('link', { name: /^Notas sin publicar/ }).click();
  await showsPreview(page, draft, 'Cuerpo de Notas sin publicar');
  assert.equal(await sameDocument(), true, 'clicking a row swaps the preview without a navigation');
  assert.equal(artifactParam(page), draft.artifactId);
  assert.deepEqual(await current(page), ['Notas sin publicar']);
  assert.equal(await page.locator('#reader-title').textContent(), 'Notas sin publicar');
  assert.equal(await page.locator('[data-reader-state]').textContent(), 'Sin publicar');
  assert.equal(await page.locator('.reader-pane').getByRole('link', { name: 'Abrir publicación', exact: true }).count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Ver artefacto', exact: true }).getAttribute('href'), `/artifacts/${draft.artifactId}`);
  checks.push('clicking a row swaps the iframe to that head revision, header and aria-current in the same document and pushes the reader URL');

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('j');
  await showsPreview(page, published, 'Cuerpo de Guía publicada');
  assert.equal(artifactParam(page), published.artifactId);
  assert.deepEqual(await current(page), ['Guía publicada']);
  await page.keyboard.press('j');
  assert.equal(artifactParam(page), published.artifactId, 'j stops at the last row');
  await list(page).getByRole('link', { name: /^Guía publicada/ }).focus();
  await page.keyboard.press('ArrowUp');
  await showsPreview(page, draft, 'Cuerpo de Notas sin publicar');
  assert.equal(await page.evaluate(() => document.activeElement?.querySelector('.reader-item-title')?.textContent), 'Notas sin publicar');
  await page.getByRole('searchbox', { name: 'Buscar artefactos', exact: true }).focus();
  await page.keyboard.press('k');
  assert.equal(artifactParam(page), draft.artifactId, 'typing in the search box does not move the selection');
  assert.equal(await sameDocument(), true);
  checks.push('j and ArrowUp move the selection and URL without reloading, and typing in an input is ignored');

  await page.goBack();
  await showsPreview(page, published, 'Cuerpo de Guía publicada');
  assert.deepEqual(await current(page), ['Guía publicada']);
  await page.goBack();
  await showsPreview(page, draft, 'Cuerpo de Notas sin publicar');
  await page.goBack();
  await showsPreview(page, pending, 'Contenido nuevo del borrador');
  assert.equal(page.url(), `${app.dashboard}/read?project=Lectura`);
  assert.deepEqual(await current(page), ['Borrador con cambios']);
  assert.equal(await sameDocument(), true, 'Back restores selections in the same document');
  await page.goForward();
  await showsPreview(page, draft, 'Cuerpo de Notas sin publicar');
  checks.push('Back and Forward restore the selection, iframe and header from the URL');

  await page.goto(`${app.dashboard}/read?project=Lectura&artifact=${published.artifactId}`);
  assert.deepEqual(await current(page), ['Guía publicada']);
  await showsPreview(page, published, 'Cuerpo de Guía publicada');
  await page.goto(`${app.dashboard}/read?project=Archivo&artifact=${archive[0]!.artifactId}`);
  assert.equal(await list(page).locator('.reader-item').count(), 25);
  assert.deepEqual(await current(page), []);
  assert.equal(await page.locator('#reader-title').textContent(), 'Archivo 00');
  await showsPreview(page, archive[0]!, 'Cuerpo de Archivo 00');
  await page.keyboard.press('j');
  assert.equal(artifactParam(page), archive[25]!.artifactId);
  await page.goBack();
  await page.waitForURL(`${app.dashboard}/read?project=Archivo&artifact=${archive[0]!.artifactId}`);
  await showsPreview(page, archive[0]!, 'Cuerpo de Archivo 00');
  await Promise.all([page.waitForURL((url) => url.pathname === '/read' && url.searchParams.has('cursor')), page.getByRole('link', { name: 'Ver más artefactos', exact: true }).click()]);
  assert.deepEqual(await titles(page), ['Archivo 00']);
  assert.deepEqual(await current(page), ['Archivo 00']);
  checks.push('a direct link selects its artifact, even one on a later page, and the next link pages the list');

  await page.goto(`${app.dashboard}/artifacts/${draft.artifactId}`);
  await page.locator('.artifact-title-trigger').press('Enter');
  await Promise.all([page.waitForURL(`${app.dashboard}/read?project=Lectura&artifact=${draft.artifactId}`), page.getByRole('menuitem', { name: 'Modo lectura', exact: true }).press('Enter')]);
  assert.deepEqual(await current(page), ['Notas sin publicar']);
  await page.getByRole('searchbox', { name: 'Buscar artefactos', exact: true }).fill('Guía');
  await Promise.all([page.waitForURL(`${app.dashboard}/read?q=Gu%C3%ADa&project=Lectura`), page.getByRole('searchbox', { name: 'Buscar artefactos', exact: true }).press('Enter')]);
  assert.deepEqual(await titles(page), ['Guía publicada']);
  checks.push('the detail header opens read mode on that artifact in its project, and search stays in read mode');

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${app.dashboard}/read?project=Lectura`);
  const [listBox, paneBox] = await Promise.all(['.reader-list', '.reader-pane'].map((selector) => page.locator(selector).evaluate((element) => element.getBoundingClientRect().toJSON())));
  assert(listBox.bottom <= paneBox.top + 1, 'the list stacks above the preview on a phone');
  assert((await page.locator('iframe.reader-preview').evaluate((frame) => frame.getBoundingClientRect().height)) >= 300);
  await capture(page, 'read-375');
  checks.push('at 375 px the list stacks above a usable preview with no horizontal overflow');
  await context.close();

  const native = await browser.newContext({ storageState: state, javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
  const plain = active = await native.newPage();
  await plain.goto(`${app.dashboard}/read?project=Lectura`);
  await Promise.all([plain.waitForURL(`${app.dashboard}/read?project=Lectura&artifact=${published.artifactId}`), plain.getByRole('navigation', { name: 'Artefactos', exact: true }).getByRole('link', { name: /^Guía publicada/ }).click()]);
  assert.deepEqual(await current(plain), ['Guía publicada']);
  assert.equal(await frameSrc(plain), previewHref(published.artifactId, published.headRevisionId));
  await native.close();
  checks.push('without JavaScript each row is a link that renders its selection on the server');

  const loggedOut = await browser.newContext();
  const response = await loggedOut.request.get(`${app.dashboard}/read?project=Lectura`, { maxRedirects: 0 });
  assert.equal(response.status(), 303);
  assert.equal(new URL(response.headers().location!, app.dashboard).pathname, '/auth/login');
  await loggedOut.close();
  checks.push('a logged-out visit redirects to the login');

  assert.deepEqual(errors, []);
  await json('result.json', { status: 'passed', browser: browser.version(), checks, errors });
  console.log(JSON.stringify({ status: 'passed', evidence, checks: checks.length }));
} catch (error) {
  if (active && !active.isClosed()) await active.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
  await json('failure.json', { status: 'failed', error: String(error), checks, errors });
  throw error;
} finally {
  await browser.close();
  await app.close();
}
