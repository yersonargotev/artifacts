import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { restCliFixture } from './rest-cli-fixture.ts';
import { grant } from './helpers.ts';
import { artifactReadSchema } from '../packages/contracts/src/index.ts';
import { verifyRetainedArtifact } from '../.agents/skills/verify-artifacts/scripts/retained.ts';

const evidence = resolve(process.env.PANEL_DETAIL_EVIDENCE ?? `.test-artifacts/panel-detail-${Date.now()}`);
await mkdir(evidence, { recursive: true, mode: 0o700 });
const app = await restCliFixture();
const temporary = await mkdtemp(join(tmpdir(), 'panel-detail-'));
const browser = await chromium.launch({ channel: 'chrome' });
const children = new Set<ChildProcess>();
const actions: { action: string; result: unknown }[] = [];
const authErrors: string[] = [];
function subprocess(args: string[]) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/cli/src/index.ts', ...args], { env: { PATH: process.env.PATH, ARTIFACTS_SERVER: app.config.resource, ARTIFACTS_STATE_DIR: join(temporary, 'state') }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  child.once('exit', () => children.delete(child));
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk; });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk; });
  return { child, stderr: () => stderr, completed: once(child, 'exit').then(([code]) => ({ code, stdout, stderr })) };
}
async function cli(args: string[]) {
  const result = await subprocess(args).completed;
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}
try {
  const setup = await browser.newContext();
  const loginPage = await setup.newPage();
  loginPage.on('response', (response) => { if (response.status() === 404 && response.url() === `${app.config.origin}/favicon.ico`) authErrors.push(response.url()); });
  const login = subprocess(['login', '--no-browser']);
  let authorization: string | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    authorization = login.stderr().split('\n').find((line) => line.startsWith(`${app.config.issuer}/oauth2/authorize?`));
    if (authorization) break;
    await new Promise((done) => setTimeout(done, 50));
  }
  assert(authorization);
  await loginPage.goto(authorization);
  await loginPage.getByLabel('Correo electrónico').fill('owner@example.test');
  await loginPage.getByLabel('Contraseña').fill(app.password);
  await loginPage.getByRole('button', { name: 'Iniciar sesión', exact: true }).press('Enter');
  await loginPage.getByRole('button', { name: 'Permitir acceso', exact: true }).press('Enter');
  assert.equal((await login.completed).code, 0);
  const documentHtml = (heading: string) => `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:24px;font:16px/1.6 system-ui;background:#eff1f5;color:#4c4f69}h1{font-size:28px;line-height:1.2}section{padding:18px;border:1px solid #ccd0da;border-radius:12px;background:white}button{padding:10px;border:0;border-radius:8px;background:#1e66f5;color:white}</style><h1>${heading}</h1><p>Documento guardado con sus notas originales.</p><section><h2>Recorridos verificados</h2><p>Selección de revisiones, comparación y descarga.</p><button onclick="this.textContent='Interacción verificada'">Probar interacción</button></section></html>`;
  const snapshot = { metadata: { title: 'Revisión de entrega', description: 'Documento de trabajo con autoría y archivos retenidos.' }, content: { kind: 'html' as const, text: documentHtml('Entrega inicial') }, files: [{ path: 'notas.txt', mediaType: 'text/plain', encoding: 'utf8' as const, data: 'Notas originales.\n' }] };
  const snapshotFile = join(temporary, 'snapshot.json');
  await writeFile(snapshotFile, JSON.stringify(snapshot));
  const created = artifactReadSchema.parse(await cli(['create', '--snapshot', snapshotFile, '--project', 'Entregas', '--request-id', randomUUID()]));
  const tokens = await grant(app, 'openid profile offline_access artifacts:read artifacts:write artifacts:publish');
  async function mcp(name: string, input: unknown) {
    const response = await fetch(app.config.resource, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${tokens.access_token}`, 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } }) });
    assert.equal(response.status, 200);
    const text = await response.text();
    const payload = JSON.parse(text.startsWith('event:') ? text.split('\n').find((line) => line.startsWith('data:'))!.slice(5) : text);
    assert(!payload.error && !payload.result.isError);
    actions.push({ action: `MCP ${name}`, result: { artifactId: payload.result.structuredContent.artifactId ?? created.artifactId } });
    return payload.result.structuredContent;
  }
  await loginPage.goto(app.dashboard);
  await loginPage.getByRole('link', { name: 'Iniciar sesión', exact: true }).press('Enter');
  await loginPage.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
  const context = await browser.newContext({ storageState: await setup.storageState(), viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'], recordVideo: { dir: join(evidence, 'videos'), size: { width: 1440, height: 900 } } });
  await setup.close();
  const page = await context.newPage();
  const video = page.video()!;
  const started = Date.now();
  const errors: string[] = [];
  const browsingRequests: string[] = [];
  let browsing = false;
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (browsing && request.method() !== 'GET') browsingRequests.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  const url = `${app.dashboard}/artifacts/${created.artifactId}`;
  async function capture(name: string) {
    if (await page.locator('.preview').count()) {
      const body = page.frameLocator('.preview').locator('body');
      await body.locator('h1').waitFor();
      await body.evaluate(async () => { await document.fonts.ready; await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))); });
      const geometry = await body.evaluate(() => ({ innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyWidth: document.body.getBoundingClientRect().width, ready: document.readyState }));
      assert(geometry.scrollWidth <= geometry.innerWidth, `${name} frame does not overflow`);
      actions.push({ action: `${name} frame geometry`, result: geometry });
      if (page.viewportSize()!.width === 390) await body.screenshot({ path: join(evidence, `${name}-frame.png`) });
    }
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))); });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} does not overflow`);
    await page.screenshot({ path: join(evidence, `${name}.png`), fullPage: true });
    actions.push({ action: name, result: { revisionId: await page.locator('.artifact-detail').getAttribute('data-revision-id'), tab: new URL(page.url()).searchParams.get('tab') ?? 'preview' } });
  }
  await page.goto(`${url}?revisionId=${created.revision.id}`);
  await page.frameLocator('.preview').getByRole('heading', { name: 'Entrega inicial', exact: true }).waitFor();
  assert.equal(await page.locator('.publication-state').innerText(), 'Este artefacto aún no está publicado.');
  await capture('unpublished-1440');
  const updated = artifactReadSchema.parse(await mcp('artifacts_update', { artifactId: created.artifactId, expectedRevisionId: created.revision.id, requestId: randomUUID(), snapshot: { ...snapshot, content: { kind: 'html', text: documentHtml('Entrega revisada') } } }));
  await mcp('artifacts_publish', { artifactId: created.artifactId, revisionId: created.revision.id, expectedPublicationVersion: 0, requestId: randomUUID() });
  await page.goto(`${url}?revisionId=${updated.revision.id}`);
  await page.frameLocator('.preview').getByRole('heading', { name: 'Entrega revisada', exact: true }).waitFor();
  assert.match(await page.locator('.revision-list').innerText(), /Artifacts CLI/);
  assert.match(await page.locator('.revision-list').innerText(), /Identity integration/);
  assert.match(await page.locator('.pending-notice').innerText(), /revisión 2.*revisión 1/s);
  assert.equal(await page.locator('.publication-card time').count(), 0);
  await capture('pending-1440');
  await page.getByRole('button', { name: 'Copiar identificador', exact: true }).press('Enter');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), created.artifactId);
  const desktopWidth = await page.locator('.preview').evaluate((frame) => frame.getBoundingClientRect().width);
  await page.getByRole('button', { name: 'Móvil', exact: true }).press('Enter');
  assert.equal(await page.locator('.preview').evaluate((frame) => frame.getBoundingClientRect().width), 390);
  assert(desktopWidth > 390);
  await capture('preview-mobile-toggle');
  await page.getByRole('button', { name: 'Abrir vista previa en pantalla completa', exact: true }).press('Enter');
  await page.waitForFunction(() => document.fullscreenElement === document.querySelector('iframe.preview'));
  await page.evaluate(() => document.exitFullscreen());
  await page.getByRole('button', { name: 'Escritorio', exact: true }).press('Enter');
  browsing = true;
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const [label, tab, selector] of [['Archivos', 'files', '#files'], ['Comparar', 'compare', '#comparison'], ['Información', 'information', '#information'], ['Vista previa', 'preview', '.preview']]) {
      await Promise.all([page.waitForURL((current) => (current.searchParams.get('tab') ?? 'preview') === tab), page.locator('.detail-tabs').getByRole('link', { name: label, exact: label !== 'Archivos' }).press('Enter')]);
      await page.locator(selector).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('revisionId'), updated.revision.id);
      assert.equal(await page.locator('.preview').count(), tab === 'preview' ? 1 : 0);
      await capture(`${tab}-${width}`);
      await page.waitForTimeout(1200);
    }
  }
  browsing = false;
  assert.deepEqual(browsingRequests, []);
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 1440, height: 900 });
  await Promise.all([page.waitForURL((current) => current.searchParams.get('revisionId') === created.revision.id), page.getByRole('link', { name: 'Ver revisión 1', exact: true }).press('Enter')]);
  await page.frameLocator('.preview').getByRole('heading', { name: 'Entrega inicial', exact: true }).waitFor();
  assert.equal(await page.locator('.preview-card .badge').innerText(), 'Publicada');
  await capture('published-selected-1440');
  await page.locator('.artifact-title-trigger').press('Enter');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Descargar revisión 1', exact: true }).press('Enter');
  const download = await downloadEvent;
  const zipPath = join(evidence, 'selected.zip');
  await download.saveAs(zipPath);
  const archive = await mcp('artifacts_export', { artifactId: created.artifactId, revisionId: created.revision.id });
  assert.deepEqual(await readFile(zipPath), Buffer.from(archive.base64, 'base64'));
  await Promise.all([page.waitForURL((current) => current.searchParams.get('revisionId') === updated.revision.id), page.getByRole('link', { name: 'Ver revisión 2', exact: true }).press('Enter')]);
  await page.getByRole('button', { name: 'Publicar revisión 2', exact: true }).press('Enter');
  await page.locator('[data-publication-result="published"]').waitFor();
  const read = artifactReadSchema.parse(await mcp('artifacts_read', { artifactId: created.artifactId, revisionId: updated.revision.id }));
  assert.equal(read.publication?.revisionId, updated.revision.id);
  await page.goto(`${url}?revisionId=${updated.revision.id}`);
  await page.frameLocator('.preview').getByRole('heading', { name: 'Entrega revisada', exact: true }).waitFor();
  await capture('published-current-1440');
  const remaining = 32_000 - (Date.now() - started);
  if (remaining > 0) await page.waitForTimeout(remaining);
  const storageState = await context.storageState();
  await context.close();
  await video.saveAs(join(evidence, 'review.webm'));
  const noScript = await browser.newContext({ storageState, javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const native = await noScript.newPage();
  await native.goto(`${url}?revisionId=${updated.revision.id}`);
  await native.locator('.detail-tabs').getByRole('link', { name: 'Archivos', exact: false }).press('Enter');
  await native.locator('#files').waitFor();
  assert.equal(new URL(native.url()).searchParams.get('revisionId'), updated.revision.id);
  assert.equal(await native.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await native.getByLabel('Revisión seleccionada', { exact: true }).selectOption(created.revision.id);
  await Promise.all([native.waitForURL((current) => current.searchParams.get('revisionId') === created.revision.id), native.getByRole('button', { name: 'Ver revisión', exact: true }).press('Enter')]);
  assert.equal(new URL(native.url()).searchParams.get('tab'), 'files');
  const nativeDownload = native.waitForEvent('download');
  await native.getByRole('link', { name: 'Exportar', exact: true }).press('Enter');
  const nativeZip = join(evidence, 'no-js-selected.zip');
  await (await nativeDownload).saveAs(nativeZip);
  assert.deepEqual(await readFile(nativeZip), Buffer.from(archive.base64, 'base64'));
  await Promise.all([native.waitForURL(`${app.dashboard}/move?artifactId=${created.artifactId}`), native.getByRole('link', { name: 'Mover', exact: true }).press('Enter')]);
  await native.getByRole('heading', { name: 'Mover a proyecto', exact: true }).waitFor();
  await noScript.close();
  const retained = await browser.newContext({ storageState });
  const admission = await retained.newPage();
  await admission.goto(read.publication!.url);
  await admission.frameLocator('iframe').getByRole('heading', { name: 'Entrega revisada', exact: true }).waitFor();
  await admission.close();
  const report = await verifyRetainedArtifact(retained, { expected: read, panelUrl: `${url}?revisionId=${updated.revision.id}`, publicationUrl: read.publication!.url, viewports: [{ width: 1440, height: 900 }, { width: 390, height: 844 }], expectations: [{ kind: 'text', selector: 'h1', text: 'Entrega revisada' }], evidenceDirectory: join(evidence, 'retained') });
  assert.equal(report.status, 'passed', JSON.stringify(report.errors));
  await retained.close();
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ status: 'passed', browser: browser.version(), checks: ['real CLI and HTTP MCP author names', 'all publication states', 'keyboard GET tabs and pinned revisions', 'no-JS tabs, revision form, selected export, and move link', 'copy clipboard', 'CSS preview sizes', 'iframe fullscreen', '1440 and 390 overflow', 'selected ZIP equals MCP bytes', 'no non-GET browsing requests', 'no panel console errors', 'retained verifier'], authFavicon404: authErrors, actions, errors, browsingRequests }, null, 2));
  console.log(JSON.stringify({ status: 'passed', evidence }));
} catch (error) {
  await writeFile(join(evidence, 'failure.json'), JSON.stringify({ status: 'failed', error: String(error), actions, authFavicon404: authErrors }, null, 2));
  throw error;
} finally {
  for (const child of children) if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  await browser.close();
  await app.close();
  await rm(temporary, { recursive: true, force: true });
  await writeFile(join(evidence, 'cleanup.json'), JSON.stringify({ status: 'stopped', temporaryRemoved: true }));
}
