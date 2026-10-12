import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { artifactReadSchema } from '../packages/artifacts/src/contracts.ts';

const phase = process.argv[2];
assert(phase === 'first' || phase === 'final', 'Choose first or final');
const directory = resolve(process.env.ARTIFACTS_PROOF_DIR ?? '.test-artifacts/artifact-e2e');
const dashboard = process.env.DASHBOARD_URL;
const auth = process.env.AUTH_URL;
assert(dashboard && auth && process.env.OWNER_EMAIL && process.env.OWNER_PASSWORD, 'Deployment origins and owner credentials are required');
const evidence = JSON.parse(await readFile(resolve(directory, phase === 'first' ? 'created.json' : 'modified.json'), 'utf8'));
const first = JSON.parse(await readFile(resolve(directory, 'created.json'), 'utf8'));
const original = artifactReadSchema.parse(first.calls.find((call: { tool: string }) => call.tool === 'artifacts_create').result);
const state = resolve(directory, 'deployed-browser-state.json');
await mkdir(directory, { recursive: true, mode: 0o700 });
const storageState = await readFile(state, 'utf8').then((data) => JSON.parse(data)).catch((error: NodeJS.ErrnoException) => {
  if (error.code !== 'ENOENT') throw error;
  return undefined;
});
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const context = await browser.newContext({ storageState, viewport: { width: 1280, height: 900 } });
const observations: Record<string, unknown> = { phase, browser: browser.version(), publicationUrl: evidence.publicationUrl };

async function settled(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  });
}

try {
  const page = await context.newPage();
  await page.goto(evidence.publicationUrl);
  if (page.url() !== evidence.publicationUrl) {
    if (await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).count()) await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
    if (await page.getByLabel('Correo electrónico').count()) {
      await page.getByLabel('Correo electrónico').fill(process.env.OWNER_EMAIL);
      await page.getByLabel('Contraseña').fill(process.env.OWNER_PASSWORD);
      await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    }
  }
  await page.waitForURL(evidence.publicationUrl);
  const heading = phase === 'first' ? 'Created by Claude' : 'Created by Claude · Edited by Codex';
  await page.frameLocator('iframe').getByRole('heading', { name: heading, exact: true }).waitFor();
  assert.equal(page.url(), first.publicationUrl);
  assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
  const viewer = (await context.cookies(evidence.publicationUrl)).filter((cookie) => cookie.name.startsWith('__Host-artifacts-viewer-'));
  assert.equal(viewer.length, 1);
  assert(viewer[0]!.httpOnly && viewer[0]!.secure);
  observations.protectedPublicationOpened = true;
  await settled(page);
  await page.screenshot({ path: resolve(directory, `deployed-revision-${phase === 'first' ? 1 : 2}.png`), fullPage: true });
  if (phase === 'final') {
    const response = await context.request.get(evidence.publicationUrl);
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['connection-allowlist'], '()');
    await page.frameLocator('iframe').getByRole('button', { name: 'Try the artifact', exact: true }).click();
    await page.frameLocator('iframe').getByRole('button', { name: 'Interaction verified', exact: true }).waitFor();
    await page.locator('summary').filter({ hasText: /^Archivos \(/ }).click();
    const attachment = new URL((await page.getByRole('link', { name: 'notes.txt', exact: true }).getAttribute('href'))!, evidence.publicationUrl).href;
    const authenticatedFile = await context.request.get(attachment);
    assert.equal(authenticatedFile.status(), 200);
    assert.equal(await authenticatedFile.text(), original.revision.snapshot.files[0]!.data);
    const anonymousDocument = await fetch(evidence.publicationUrl, { redirect: 'manual' });
    assert.equal(anonymousDocument.status, 303);
    assert.equal(await anonymousDocument.text(), '');
    assert.equal((await fetch(attachment, { redirect: 'manual' })).status, 401);
    for (const endpoint of ['read', 'consume']) {
      for (const suffix of ['', '/']) {
        const denied: Response = await fetch(`${dashboard}/internal/publication/${endpoint}${suffix}`, { method: 'POST', headers: { origin: dashboard, 'content-type': 'application/json' }, body: '{}' });
        assert.equal(denied.status, 403);
      }
    }
    observations.anonymousDocumentAndFileDenied = true;
    observations.internalRoutesRequireServiceCredentials = true;
    const panel = await context.newPage();
    await panel.goto(dashboard);
    if (await panel.getByRole('link', { name: 'Iniciar sesión', exact: true }).count()) await panel.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
    await panel.getByRole('heading', { name: 'Tus artefactos', exact: true }).waitFor();
    await panel.locator('summary').filter({ hasText: /^Cuenta$/ }).click();
    await panel.getByTestId('user-id').waitFor();
    assert.equal(await panel.getByTestId('user-id').textContent(), original.ownerId);
    await panel.getByRole('link', { name: original.revision.snapshot.metadata.title, exact: true }).click();
    await panel.getByRole('link', { name: 'Ver revisión 1', exact: true }).waitFor();
    await panel.getByRole('link', { name: 'Ver revisión 2', exact: true }).waitFor();
    await panel.getByRole('link', { name: 'Ver revisión 1', exact: true }).scrollIntoViewIfNeeded();
    await Promise.all([panel.waitForURL((url) => url.searchParams.get('revisionId') === original.revision.id), panel.getByRole('link', { name: 'Ver revisión 1', exact: true }).click()]);
    await panel.frameLocator('iframe').getByRole('heading', { name: 'Created by Claude', exact: true }).waitFor();
    const downloadEvent = panel.waitForEvent('download');
    await panel.getByRole('link', { name: 'Descargar revisión 1', exact: true }).first().click();
    const download = await downloadEvent;
    const archivePath = resolve(directory, 'deployed-revision-1.zip');
    await download.saveAs(archivePath);
    assert.deepEqual(await readFile(archivePath), await readFile(resolve(directory, 'revision-1.zip')));
    observations.sameCanonicalOwnerAndTwoRevisions = true;
    observations.panelExportMatchesCodexExport = true;
    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(panel.url());
    await mobile.getByRole('link', { name: 'Ver revisión 2', exact: true }).waitFor();
    await mobile.frameLocator('iframe').getByRole('heading', { name: 'Created by Claude', exact: true }).waitFor();
    await mobile.locator('iframe').scrollIntoViewIfNeeded();
    await settled(mobile);
    assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await mobile.screenshot({ path: resolve(directory, 'deployed-history-mobile.png'), fullPage: true });
    const isolated = await browser.newContext();
    try {
      const revocable = await isolated.newPage();
      await revocable.goto(evidence.publicationUrl);
      await revocable.getByLabel('Correo electrónico').fill(process.env.OWNER_EMAIL);
      await revocable.getByLabel('Contraseña').fill(process.env.OWNER_PASSWORD);
      await revocable.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
      await revocable.waitForURL(evidence.publicationUrl);
      await revocable.frameLocator('iframe').getByRole('heading', { name: heading, exact: true }).waitFor();
      const retainedViewer = (await isolated.cookies(evidence.publicationUrl)).map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
      assert(retainedViewer.includes('__Host-artifacts-viewer-'));
      const signOut = await isolated.request.post(`${auth}/api/auth/sign-out`, { headers: { origin: auth }, data: {} });
      assert.equal(signOut.status(), 200);
      assert.equal((await fetch(evidence.publicationUrl, { headers: { cookie: retainedViewer }, redirect: 'manual' })).status, 403);
      assert.equal((await fetch(attachment, { headers: { cookie: retainedViewer }, redirect: 'manual' })).status, 403);
      assert.equal((await context.request.get(evidence.publicationUrl)).status(), 200);
      observations.separateSessionRevocationDeniedDocumentAndFile = true;
      observations.originalCliAndBrowserSessionPreserved = true;
    } finally { await isolated.close(); }
    await page.bringToFront();
  }
  await context.storageState({ path: state });
  await chmod(state, 0o600);
  await writeFile(resolve(directory, `deployed-browser-${phase}.json`), JSON.stringify(observations, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(observations));
} finally {
  await context.close();
  await browser.close();
}
