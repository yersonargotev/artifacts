import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { restCliFixture } from './rest-cli-fixture.ts';
import type { ArtifactRead } from '../packages/contracts/src/index.ts';

const app = await restCliFixture();
const directory = await mkdtemp(join(tmpdir(), 'artifacts-cli-browser-'));
const browser = await chromium.launch({ channel: 'chrome' });
const cliEnv = { PATH: process.env.PATH, ARTIFACTS_SERVER: app.config.resource, ARTIFACTS_STATE_DIR: join(directory, 'state') };
const children = new Set<ChildProcess>();
function subprocess(args: string[]) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/cli/src/index.ts', ...args], { env: cliEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  child.once('exit', () => children.delete(child));
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  const completed = once(child, 'exit').then(([code]) => ({ code, stdout, stderr }));
  return { child, completed, stderr: () => stderr };
}
async function cli(args: string[]) {
  const result = await subprocess(args).completed;
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const login = subprocess(['login', '--no-browser']);
  let authorization: string | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    authorization = login.stderr().split('\n').find((line) => line.startsWith(`${app.config.issuer}/oauth2/authorize?`));
    if (authorization) break;
    if (login.child.exitCode !== null) throw new Error(login.stderr());
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert(authorization, 'CLI prints its native authorization URL');
  await page.goto(authorization);
  await page.getByLabel('Correo electrónico').fill('owner@example.test');
  await page.getByLabel('Contraseña').fill(app.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByRole('button', { name: 'Permitir acceso', exact: true }).click();
  const signedIn = await login.completed;
  assert.equal(signedIn.code, 0, signedIn.stderr);
  assert.equal(JSON.parse(signedIn.stdout).userId, app.ownerId);
  assert.equal((await cli(['whoami'])).userId, app.ownerId);
  const snapshot = { metadata: { title: 'CLI browser artifact', description: 'Retained through CLI, REST, MCP and panel', custom: { source: 'cli-proof' } }, content: { kind: 'html', text: '<h1>CLI original revision</h1>' }, files: [{ path: 'bytes.bin', mediaType: 'application/octet-stream', encoding: 'base64', data: 'AAEC/w==' }] };
  const file = join(directory, 'snapshot.json');
  await writeFile(file, JSON.stringify(snapshot));
  const created = await cli(['create', '--snapshot', file, '--request-id', 'browser-cli-create']) as ArtifactRead;
  assert.deepEqual(created.revision.snapshot, snapshot);
  const changes = join(directory, 'changes.json');
  await writeFile(changes, JSON.stringify({ content: { text: '<h1>CLI second revision</h1>' } }));
  const updated = await cli(['edit', created.artifactId, '--changes', changes, '--request-id', 'browser-cli-edit']) as ArtifactRead;
  assert.equal(updated.revision.sequence, 2);
  const publication = await cli(['publish', created.artifactId, '--revision', created.revision.id, '--expected-version', '0', '--request-id', 'browser-cli-publish']);
  assert.equal(publication.version, 1);
  await page.goto(app.dashboard);
  await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByRole('link', { name: 'CLI browser artifact', exact: true }).click();
  await page.frameLocator('.preview').getByRole('heading', { name: 'CLI second revision', exact: true }).waitFor();
  assert.equal(await page.locator('.artifact-detail').getAttribute('data-revision-id'), updated.revision.id);
  assert.equal(await page.locator('.artifact-detail').getAttribute('data-publication-version'), '1');
  await page.getByRole('link', { name: 'Ver revisión 1', exact: true }).scrollIntoViewIfNeeded();
  await Promise.all([
    page.waitForURL((url) => url.searchParams.get('revisionId') === created.revision.id, { waitUntil: 'domcontentloaded' }),
    page.getByRole('link', { name: 'Ver revisión 1', exact: true }).click(),
  ]);
  await page.frameLocator('.preview').getByRole('heading', { name: 'CLI original revision', exact: true }).waitFor();
  assert.equal(await page.locator('.artifact-detail').getAttribute('data-revision-id'), created.revision.id);
  await page.getByRole('button', { name: 'Menú de CLI browser artifact', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Descargar revisión 1', exact: true }).click();
  const download = await downloadEvent;
  const panelZip = join(directory, 'panel.zip');
  await download.saveAs(panelZip);
  const cliZip = join(directory, 'cli.zip');
  await cli(['export', created.artifactId, '--revision', created.revision.id, '--out', cliZip]);
  assert.deepEqual(await readFile(cliZip), await readFile(panelZip));
  await mkdir('.test-artifacts', { recursive: true });
  await page.screenshot({ path: '.test-artifacts/rest-cli-panel.png', fullPage: true });
  await page.goto(publication.url);
  await page.frameLocator('iframe').getByRole('heading', { name: 'CLI original revision', exact: true }).waitFor();
  assert.equal(await page.locator('main').getAttribute('data-revision-id'), created.revision.id);
  await page.screenshot({ path: '.test-artifacts/rest-cli-publication.png', fullPage: true });
  await page.goto(`${app.dashboard}/artifacts/${created.artifactId}`);
  await page.getByRole('button', { name: 'Publicar revisión 2', exact: true }).waitFor();
  const secondPublication = await cli(['publish', created.artifactId, '--revision', updated.revision.id, '--expected-version', '1', '--request-id', 'browser-cli-publication-race']);
  assert.equal(secondPublication.version, 2);
  assert.equal(secondPublication.url, publication.url);
  const stalePost = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/publish') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Publicar revisión 2', exact: true }).click();
  assert.equal((await stalePost).status(), 409);
  assert.equal(await page.locator('[data-publication-result]').getAttribute('data-publication-result'), 'conflict');
  assert.equal((await cli(['read', created.artifactId])).publication.version, 2);
  await page.goto(`${app.config.origin}/`);
  const revoke = await context.request.post(`${app.config.origin}/revoke-all`, { headers: { origin: app.config.origin }, maxRedirects: 0 });
  assert.equal(revoke.status(), 303);
  const denied = await subprocess(['read', created.artifactId]).completed;
  assert.notEqual(denied.code, 0);
  assert.match(denied.stderr, /unauthenticated/);
  const deniedReplay = await subprocess(['retry', 'browser-cli-create']).completed;
  assert.notEqual(deniedReplay.code, 0);
  assert.match(deniedReplay.stderr, /unauthenticated/);
  await page.goto(`${app.dashboard}/artifacts/${created.artifactId}`);
  await page.getByLabel('Correo electrónico').waitFor();
  console.log('Chrome CLI native login, persisted credentials, retained revisions, panel and publication views, identical historical ZIP, stale panel publication conflict, and revocation passed');
} finally {
  await Promise.all([...children].map(async (child) => { child.kill('SIGTERM'); await once(child, 'exit'); }));
  await browser.close();
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
