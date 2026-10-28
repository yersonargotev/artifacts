import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page, type Route } from 'playwright';
import { createArtifactHttpClient } from '../packages/client/src/index.ts';
import { artifactReadSchema } from '../packages/contracts/src/index.ts';

const execute = promisify(execFile);
const args = process.argv.slice(2);
const parent = args.includes('--parent');
const headed = args.includes('--headed');
const providedRun = args.includes('--run');
const sharedMode = args.includes('--shared-with-me');
const sharedParent = args.includes('--s9-parent');
const run = resolve(providedRun ? args[args.indexOf('--run') + 1]! : `.test-artifacts/verify-artifacts/panel-share-${randomUUID()}`);
const control = (command: string[]) => execute(process.execPath, ['--import', 'tsx', '.agents/skills/verify-artifacts/scripts/control.ts', ...command]);
if (!providedRun) await control(['launch', '--allow-guests', '--run', run]);
const directory = join(run, 'panel-share');
const review = resolve('.test-artifacts/review');
await mkdir(directory, { recursive: true });
await mkdir(review, { recursive: true });
const instance = JSON.parse(await readFile(join(run, 'instance.json'), 'utf8')) as { panel: string; mcp: string };
const credentials = JSON.parse(await readFile(join(run, 'runtime/credentials.json'), 'utf8')) as { password: string; accessToken: string };
const client = createArtifactHttpClient({ resource: instance.mcp, accessToken: credentials.accessToken });
const browser = await chromium.launch({ channel: 'chrome', headless: !headed });
const results: { lane: number | string; status: string; observed: unknown }[] = [];
const contexts: BrowserContext[] = [];
const errors: string[] = [];
const segments: { source: string; start: number; duration: number; action: string }[] = [];
const posts: string[] = [];
let status = 'ISSUES';
let active: Page | undefined;
const pass = (lane: number | string, observed: unknown) => { const result = { lane, status: 'PASS', observed }; results.push(result); console.log(JSON.stringify(result)); };
async function create(title: string, accessToken = credentials.accessToken) {
  const input = { requestId: randomUUID(), snapshot: { metadata: { title, description: 'Public share route proof' }, content: { kind: 'text', text: `Published ${title}` }, files: [] } };
  const response = await fetch(instance.mcp, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${accessToken}`, 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'artifacts_create', arguments: input } }) });
  assert.equal(response.status, 200);
  const text = await response.text();
  const payload = JSON.parse(text.startsWith('event:') ? text.split('\n').find((line) => line.startsWith('data:'))!.slice(5) : text);
  assert(!payload.error && !payload.result.isError);
  return artifactReadSchema.parse(payload.result.structuredContent);
}
async function context(options: Parameters<typeof browser.newContext>[0] = {}) {
  const value = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  contexts.push(value);
  value.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  return value;
}
async function login(page: Page, email = 'owner@example.test') {
  await page.goto(instance.panel);
  await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
}
async function capture(page: Page, name: string, reviewSlug?: string) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} has no overflow`);
  if (await page.getByRole('dialog').isVisible()) assert.equal(await page.getByRole('dialog').evaluate((element) => { const box = element.getBoundingClientRect(); return box.x >= 0 && box.y >= 0 && box.right <= innerWidth && box.bottom <= innerHeight && element.scrollWidth <= element.clientWidth; }), true, `${name} dialog fits the viewport`);
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: false });
  await writeFile(join(directory, `${name}.aria.yml`), await page.locator('body').ariaSnapshot());
  if (reviewSlug) await copyFile(join(directory, `${name}.png`), join(review, `S8-review-${reviewSlug}.png`));
}
const sharePath = (id: string) => `/artifacts/${id}/share`;
const dialog = (page: Page) => page.getByRole('dialog');
const rows = (page: Page) => dialog(page).locator('.share-list li');
async function ready(page: Page) { await page.locator('astro-island[component-url*="ShareDialog"]:not([ssr])').waitFor({ state: 'attached' }); }
async function opened(page: Page) { await dialog(page).getByLabel('Correo electrónico', { exact: true }).waitFor(); await dialog(page).locator('.share-list').waitFor({ state: 'attached' }); }
async function openHeader(page: Page, id: string) {
  await page.goto(`${instance.panel}/artifacts/${id}`);
  await ready(page);
  await page.getByRole('link', { name: 'Compartir', exact: true }).click();
  await opened(page);
}
async function close(page: Page) { await dialog(page).getByRole('button', { name: 'Cerrar', exact: true }).click(); await dialog(page).waitFor({ state: 'hidden' }); }
async function add(page: Page, email: string) {
  await dialog(page).getByLabel('Correo electrónico', { exact: true }).fill(email);
  await dialog(page).getByRole('button', { name: 'Dar acceso', exact: true }).click();
  await dialog(page).getByText(email.trim().toLowerCase(), { exact: true }).waitFor();
}
async function current(id: string) { return (await client.listShares({ artifactId: id })).items; }
async function clear(id: string) { for (const share of await current(id)) await client.unshare({ artifactId: id, shareId: share.shareId, requestId: randomUUID() }); }
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
async function sharedWithMe() {
  const title = 'Plan compartido para la próxima entrega y sus decisiones de producto';
  const artifact = await create(title);
  const unpublished = await create('Invitación pendiente de publicación');
  const published = await client.publish({ requestId: randomUUID(), artifactId: artifact.artifactId, revisionId: artifact.revision.id, expectedPublicationVersion: 0 });
  await client.update({ requestId: randomUUID(), artifactId: artifact.artifactId, expectedRevisionId: artifact.revision.id, snapshot: { metadata: { title: 'Private draft title', description: '' }, content: { kind: 'text', text: 'Private draft content' }, files: [] } });
  let shared = await client.share({ requestId: randomUUID(), artifactId: artifact.artifactId, email: 'GUEST@Example.TEST' });
  await control(['account', '--email', 'guest@example.test', '--run', run]);
  await control(['account', '--email', 'empty@example.test', '--run', run]);
  const owner = await context();
  const ownerPage = await owner.newPage(); active = ownerPage;
  await login(ownerPage);
  assert.equal(await ownerPage.locator('#shared-with-me').count(), 0);
  await capture(ownerPage, sharedParent ? 's9-library-trunk' : 's9-library-head');
  pass('S9-7', 'Owner library has no shared section and retains its owned collection');
  const guestSetup = await context();
  await login(await guestSetup.newPage(), 'guest@example.test');
  const guest = await context({ storageState: await guestSetup.storageState(), javaScriptEnabled: false, ...(headed ? { recordVideo: { dir: join(directory, 's9-video'), size: { width: 1440, height: 900 } } } : {}) });
  const page = await guest.newPage(); active = page;
  const video = page.video();
  const videoStart = Date.now();
  const sharedSection = page.locator('#shared-with-me');
  const checkLibrary = async (count: number) => {
    const response = await page.goto(instance.panel);
    assert.equal(response?.status(), 200);
    assert.equal(new URL(page.url()).pathname, '/');
    assert.equal(await sharedSection.locator('li').count(), count);
    const html = await response!.text();
    for (const value of ['Private draft title', 'Private draft content', artifact.ownerId, 'owner@example.test', 'Private project']) assert(!html.includes(value), value);
    return html;
  };
  const shot = async (slug: string, reviewSlug?: string) => {
    await capture(page, `s9-${slug}`);
    if (reviewSlug) await copyFile(join(directory, `s9-${slug}.png`), join(review, `S9-review-${reviewSlug}.png`));
  };
  const record = async (action: string, perform: () => Promise<void>) => {
    const started = Date.now();
    if (headed) await page.bringToFront();
    await perform();
    if (headed) {
      await page.waitForTimeout(Math.max(0, 8500 - (Date.now() - started)));
      segments.push({ source: 's9-guest.webm', start: (started - videoStart) / 1000, duration: (Date.now() - started) / 1000, action });
    }
  };
  await record('Read the actual guest library with JavaScript disabled', async () => {
    await checkLibrary(1);
    assert.equal(await sharedSection.getByRole('heading', { name: 'Compartidos conmigo', exact: true }).count(), 1);
    assert.equal(await sharedSection.getByRole('link', { name: title, exact: true }).getAttribute('href'), published.url);
    assert.equal(await sharedSection.getByText('Compartido por Test owner', { exact: true }).count(), 1);
    assert.equal(await sharedSection.locator('button,input,form,[role="menu"]').count(), 0);
    assert.equal(await page.locator('.library-controls,.library-collection').count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Conectar herramientas', exact: true }).count(), 1);
    await shot('shared-section', 'shared-section');
    pass('S9-2', 'Verified guest sees the published title, owner name, and native publication link without owner controls');
    pass('S9-1', 'Owner collection remains separate; guest discovery uses the current published title');
  });
  await record('Open the publication through its native shared card and read attribution', async () => {
    const response = page.waitForResponse((response) => response.url() === published.url && response.status() === 200 && response.request().isNavigationRequest());
    await sharedSection.getByRole('link', { name: title, exact: true }).click();
    assert.equal((await response).status(), 200);
    await page.frameLocator('iframe').getByText(`Published ${title}`, { exact: true }).waitFor();
    assert.equal(await page.getByText('Compartido por Test owner', { exact: true }).count(), 1);
    assert.equal(await page.getByRole('link', { name: 'Volver a la biblioteca', exact: true }).getAttribute('href'), `${instance.panel}/#shared-with-me`);
    const html = await page.content();
    for (const value of ['Private draft title', artifact.ownerId, 'owner@example.test', 'Private project', 'Cliente autor', 'Compartir', 'Eliminar', 'Exportar']) assert(!html.includes(value), value);
    await shot('header', 'header');
    pass('S9-3', 'The guest opens the actual protected publication without JavaScript');
    pass('S9-4', 'Publication header shows the owner display name and returns to the shared section');
  });
  await record('Return to the real shared library on mobile', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('link', { name: 'Volver a la biblioteca', exact: true }).click();
    assert.equal(new URL(page.url()).hash, '#shared-with-me');
    assert.equal(await sharedSection.locator('li').count(), 1);
    const link = sharedSection.getByRole('link', { name: title, exact: true });
    await link.focus();
    const box = await link.boundingBox();
    assert(box && box.height >= 44 && box.x >= 0 && box.x + box.width <= 390);
    assert.equal(await link.evaluate((element) => getComputedStyle(element).outlineStyle), 'solid');
    await shot('mobile-library', 'mobile-library');
  });
  await record('Read actual mobile publication attribution', async () => {
    await sharedSection.getByRole('link', { name: title, exact: true }).click();
    await page.getByText('Compartido por Test owner', { exact: true }).waitFor();
    await shot('mobile-header', 'mobile-header');
    pass('S9-9', 'Guest library and publication fit 390px with a visible focus outline and at least 44px publication target');
  });
  await client.unshare({ requestId: randomUUID(), artifactId: artifact.artifactId, shareId: shared.shareId });
  assert.equal((await page.reload())?.status(), 403);
  await checkLibrary(0); await shot('revoked-library');
  pass('S9-5', 'Revocation denies the established viewer and removes the card on the next library load');
  shared = await client.share({ requestId: randomUUID(), artifactId: artifact.artifactId, email: 'guest@example.test' });
  await client.share({ requestId: randomUUID(), artifactId: unpublished.artifactId, email: 'guest@example.test' });
  await checkLibrary(1); await shot('unpublished-library');
  await client.publish({ requestId: randomUUID(), artifactId: unpublished.artifactId, revisionId: unpublished.revision.id, expectedPublicationVersion: 0 });
  await checkLibrary(2);
  assert.equal(await sharedSection.getByRole('link', { name: 'Invitación pendiente de publicación', exact: true }).count(), 1);
  pass('S9-6', 'An unpublished invitation is hidden until the actual publication exists');
  for (const suffix of ['?q=Plan', '?status=published', '?unfiled=1', '?project=Missing']) {
    assert.equal((await page.goto(`${instance.panel}/${suffix}`))?.status(), 200);
    assert.equal(await sharedSection.count(), 0);
  }
  await checkLibrary(2);
  await sharedSection.getByRole('link', { name: title, exact: true }).click();
  await control(['account', '--email', 'guest@example.test', '--unverified', '--run', run]);
  assert.equal((await page.reload())?.status(), 403);
  await checkLibrary(0);
  await control(['account', '--email', 'guest@example.test', '--run', run]);
  await checkLibrary(2);
  pass('S9-current-verification', 'Revoking email verification stops both listing and established publication viewing; verification restores discovery');
  const empty = await context();
  const emptyPage = await empty.newPage(); active = emptyPage;
  await login(emptyPage, 'empty@example.test');
  assert.equal(await emptyPage.locator('#shared-with-me').count(), 0);
  await emptyPage.getByRole('heading', { name: 'Tu próximo proyecto empieza aquí', exact: true }).waitFor();
  await capture(emptyPage, 's9-empty');
  await copyFile(join(directory, 's9-empty.png'), join(review, 'S9-review-empty.png'));
  pass('S9-8', 'An account without shares retains the exact owned welcome state');
  const guestCredentials = JSON.parse(await readFile(join(run, 'runtime/accounts/guest@example.test.json'), 'utf8')) as { userId: string; accessToken: string };
  assert.notEqual(guestCredentials.userId, artifact.ownerId);
  const guestOwn = await create('Guest authored through HTTP MCP', guestCredentials.accessToken);
  assert.equal(guestOwn.ownerId, guestCredentials.userId);
  active = page;
  await checkLibrary(2);
  assert.equal(await sharedSection.getByRole('link', { name: 'Guest authored through HTTP MCP', exact: true }).count(), 0);
  assert.equal(await page.locator('.artifact-card').filter({ has: page.getByRole('heading', { name: 'Guest authored through HTTP MCP', exact: true }) }).count(), 1);
  await shot('guest-own');
  pass('S9-10', { transport: 'Actual public HTTP MCP artifacts_create using the guest-issued access token', owner: 'Guest ownership matches the separately issued account', sharedCards: 2, ownedCards: 1 });
  await client.unshare({ requestId: randomUUID(), artifactId: artifact.artifactId, shareId: shared.shareId });
  if (headed) {
    await guest.close();
    assert(video);
    await video.saveAs(join(directory, 's9-guest.webm'));
    const cuts = segments.filter(({ source }) => source === 's9-guest.webm');
    await writeFile(join(directory, 's9-video-segments.json'), JSON.stringify({ method: 'Chronological cuts of one actual headed guest run at original speed', segments: cuts }, null, 2));
    for (const [index, item] of cuts.entries()) await execute('ffmpeg', ['-y', '-ss', String(item.start), '-i', join(directory, item.source), '-t', String(item.duration), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(directory, `s9-segment-${index}.mp4`)]);
    await writeFile(join(directory, 's9-concat.txt'), cuts.map((_, index) => `file 's9-segment-${index}.mp4'`).join('\n'));
    await execute('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', join(directory, 's9-concat.txt'), '-c', 'copy', '-movflags', '+faststart', join(review, 'S9-review.mp4')]);
    pass('S9-media', { durationSeconds: cuts.reduce((total, item) => total + item.duration, 0), method: 'Actual chronological cuts at original speed', provenance: directory });
  }
}
try {
  await control(['doctor', '--run', run]);
  if (sharedMode) {
    await sharedWithMe();
    assert.deepEqual(errors, []);
    status = 'PASS';
  } else {
  const artifact = await create('Sharing proof');
  const unpublished = await create('Unpublished sharing proof');
  const published = await client.publish({ artifactId: artifact.artifactId, revisionId: artifact.headRevisionId, expectedPublicationVersion: 0, requestId: randomUUID() });
  const setup = await context();
  const setupPage = await setup.newPage(); active = setupPage;
  await login(setupPage);
  const ownerState = await setup.storageState();
  const path = sharePath(artifact.artifactId);
  await setupPage.goto(`${instance.panel}/artifacts/${artifact.artifactId}`);
  const count = await setupPage.getByRole('link', { name: 'Compartir', exact: true }).count();
  const response = await setup.request.get(`${instance.panel}${path}`, { headers: { accept: 'application/json' } });
  if (parent) {
    assert.equal(count, 0);
    assert.equal(response.status(), 404);
    await capture(setupPage, 'detail-trunk');
    await setupPage.locator('astro-island[component-url*="MoveDialog"]:not([ssr])').waitFor({ state: 'attached' });
    await setupPage.getByRole('link', { name: 'Mover', exact: true }).click();
    await dialog(setupPage).getByLabel('Proyecto', { exact: true }).waitFor();
    await dialog(setupPage).getByRole('button', { name: 'Cancelar', exact: true }).click();
    pass('parent-negative', { shareLinkCount: count, shareRouteStatus: response.status(), moveDialog: 'PASS', pureHelpers: 'Absent on parent. Missing imports are not counted as behavioral red.' });
    status = 'PASS';
  } else {
    assert.equal(count, 1);
    assert.equal(response.status(), 200);
    assert.deepEqual((await response.json()).shares, { kind: 'ready', items: [] });
    await control(['account', '--email', 'guest@example.test', '--run', run]);
    const guestSetup = await context();
    const guestSetupPage = await guestSetup.newPage();
    await login(guestSetupPage, 'guest@example.test');
    const guestState = await guestSetup.storageState();
    const owner = await context({ storageState: ownerState, ...(headed ? { recordVideo: { dir: join(directory, 'video'), size: { width: 1440, height: 900 } } } : {}) });
    const ownerVideoStart = Date.now();
    const page = await owner.newPage(); active = page;
    const ownerVideo = page.video();
    const guest = await context({ storageState: guestState, ...(headed ? { recordVideo: { dir: join(directory, 'video'), size: { width: 1440, height: 900 } } } : {}) });
    const guestVideoStart = Date.now();
    const guestPage = await guest.newPage();
    const guestVideo = guestPage.video();
    const segment = async (source: 'owner' | 'guest', action: string, duration: number, perform: () => Promise<void>) => {
      const started = Date.now();
      const target = source === 'owner' ? page : guestPage;
      if (headed) await target.bringToFront();
      await perform();
      if (headed) {
        await target.waitForTimeout(Math.max(0, duration * 1000 - (Date.now() - started)));
        segments.push({ source: `${source}.webm`, start: (started - (source === 'owner' ? ownerVideoStart : guestVideoStart)) / 1000, duration: (Date.now() - started) / 1000, action });
      }
    };
    page.on('request', (request) => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/share')) posts.push(request.postData()!); });
    await page.goto(`${instance.panel}/artifacts/${artifact.artifactId}`);
    await capture(page, 'detail-head');
    await page.locator('astro-island[component-url*="MoveDialog"]:not([ssr])').waitFor({ state: 'attached' });
    await page.getByRole('link', { name: 'Mover', exact: true }).click();
    await dialog(page).getByLabel('Proyecto', { exact: true }).waitFor();
    await dialog(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.goto(instance.panel);
    await ready(page);
    await page.getByRole('button', { name: 'Menú de Sharing proof', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Compartir', exact: true }).click();
    await opened(page);
    assert.equal(await dialog(page).getByLabel('Correo electrónico', { exact: true }).evaluate((element) => element === document.activeElement), true);
    await capture(page, 'menu-open', 'menu');
    pass(2, 'Library menu opens the share dialog and focuses the email field');
    await close(page);
    await openHeader(page, artifact.artifactId);
    await capture(page, 'header-open');
    pass(3, 'Detail header opens the same dialog');
    await segment('owner', 'Grant guest access through the actual panel form', 8, async () => {
      await add(page, ' GUEST@Example.TEST ');
      assert.deepEqual((await current(artifact.artifactId)).map(({ value }) => value), ['guest@example.test']);
      await capture(page, 'added', 'added');
      pass(4, 'Mixed-case email is stored and shown in lowercase');
    });
    await segment('guest', 'Open the published revision in the independent guest context', 10, async () => {
      const opened = await guestPage.goto(published.url);
      assert.equal(opened?.status(), 200);
      await guestPage.frameLocator('iframe').getByText('Published Sharing proof', { exact: true }).waitFor();
      await capture(guestPage, 'guest-open');
      pass(5, 'Second browser context reads the actual published revision');
      pass(1, 'Detail and move dialog retain behavior; sharing grants actual guest publication admission');
    });
    await segment('owner', 'Revoke guest access through Quitar', 8, async () => {
      await dialog(page).getByRole('button', { name: 'Quitar acceso a guest@example.test', exact: true }).click();
      await dialog(page).getByText('Todavía no has dado acceso a otras personas.', { exact: true }).waitFor();
      assert.deepEqual(await current(artifact.artifactId), []);
      await capture(page, 'revoked', 'revoked');
    });
    await segment('guest', 'Reload the established guest viewer and observe actual HTTP 403', 9, async () => {
      const revoked = await guestPage.reload();
      assert.equal(revoked?.status(), 403);
      await capture(guestPage, 'guest-denied');
      pass(6, 'Revocation removes the share and the established guest viewer reload returns HTTP 403');
    });
    if (headed) {
      await owner.close();
      await guest.close();
      assert(ownerVideo && guestVideo);
      await ownerVideo.saveAs(join(directory, 'owner.webm'));
      await guestVideo.saveAs(join(directory, 'guest.webm'));
      await writeFile(join(directory, 'video-segments.json'), JSON.stringify({ method: 'Chronological cuts of actual owner and guest pages from one headed run, original speed', segments }, null, 2));
      for (const [index, item] of segments.entries()) await execute('ffmpeg', ['-y', '-ss', String(item.start), '-i', join(directory, item.source), '-t', String(item.duration), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(directory, `segment-${index}.mp4`)]);
      await writeFile(join(directory, 'concat.txt'), segments.map((_, index) => `file 'segment-${index}.mp4'`).join('\n'));
      await execute('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', join(directory, 'concat.txt'), '-c', 'copy', '-movflags', '+faststart', join(review, 'S8-review.mp4')]);
      pass('media', { segments: segments.length, durationSeconds: segments.reduce((total, item) => total + item.duration, 0), provenance: directory });
    }
    const live = headed ? await context({ storageState: ownerState }) : owner;
    const currentPage = headed ? await live.newPage() : page; active = currentPage;
    await openHeader(currentPage, unpublished.artifactId);
    await dialog(currentPage).getByText('Las personas invitadas podrán verlo cuando lo publiques.', { exact: true }).waitFor();
    await capture(currentPage, 'unpublished', 'unpublished');
    pass(7, 'Unpublished notice matches the specified text');
    await dialog(currentPage).getByLabel('Correo electrónico', { exact: true }).fill('nope');
    await dialog(currentPage).getByRole('button', { name: 'Dar acceso', exact: true }).click();
    await dialog(currentPage).getByText('Escribe un correo electrónico válido.', { exact: true }).waitFor();
    assert.equal(await dialog(currentPage).getByLabel('Correo electrónico', { exact: true }).evaluate((element) => element === document.activeElement), true);
    assert.deepEqual(await current(unpublished.artifactId), []);
    await capture(currentPage, 'invalid');
    pass(8, 'Invalid email produces focused Spanish inline validation and no write');
    await close(currentPage);
    await currentPage.setViewportSize({ width: 390, height: 844 });
    await currentPage.goto(instance.panel);
    await ready(currentPage);
    await currentPage.getByRole('button', { name: 'Menú de Sharing proof', exact: true }).click();
    await currentPage.getByRole('menuitem', { name: 'Compartir', exact: true }).click();
    await opened(currentPage);
    const longEmail = `${'long'.repeat(15)}@${'domain'.repeat(9)}.example.test`;
    await add(currentPage, longEmail);
    assert.equal(await dialog(currentPage).evaluate((element) => element.scrollWidth <= element.clientWidth), true);
    const removeBox = await dialog(currentPage).getByRole('button', { name: `Quitar acceso a ${longEmail}`, exact: true }).boundingBox();
    assert(removeBox && removeBox.x >= 0 && removeBox.x + removeBox.width <= 390);
    const mobileFocus = await dialog(currentPage).evaluate((element) => ({ inside: element.contains(document.activeElement), active: document.activeElement?.outerHTML.slice(0, 180), box: element.getBoundingClientRect().toJSON(), scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
    console.log(JSON.stringify({ mobileFocus }));
    assert.equal(mobileFocus.inside, true);
    await capture(currentPage, 'mobile', 'mobile');
    pass(9, '390px card entry, long email, and Quitar remain visible without horizontal overflow');
    await currentPage.keyboard.press('Escape');
    await dialog(currentPage).waitFor({ state: 'hidden' });
    assert.equal(await currentPage.getByRole('button', { name: 'Menú de Sharing proof', exact: true }).evaluate((element) => element === document.activeElement), true);
    await capture(currentPage, 'escape');
    await clear(artifact.artifactId);
    const native = await context({ storageState: ownerState, javaScriptEnabled: false });
    const nativePage = await native.newPage(); active = nativePage;
    await nativePage.goto(instance.panel);
    await nativePage.locator('.artifact-card').filter({ has: nativePage.getByRole('heading', { name: 'Sharing proof', exact: true }) }).getByRole('link', { name: 'Compartir', exact: true }).click();
    assert.equal(new URL(nativePage.url()).pathname, path);
    await nativePage.getByLabel('Correo electrónico', { exact: true }).fill('nope');
    let nativePost = nativePage.waitForResponse((response) => response.request().method() === 'POST');
    await nativePage.getByRole('button', { name: 'Dar acceso', exact: true }).click();
    assert.equal((await nativePost).status(), 400);
    await nativePage.getByText('Escribe un correo electrónico válido.', { exact: true }).waitFor();
    await nativePage.getByLabel('Correo electrónico', { exact: true }).fill('NATIVE@Example.TEST');
    nativePost = nativePage.waitForResponse((response) => response.request().method() === 'POST');
    await nativePage.getByRole('button', { name: 'Dar acceso', exact: true }).click();
    assert.equal((await nativePost).status(), 303);
    await nativePage.getByText('native@example.test', { exact: true }).waitFor();
    await capture(nativePage, 'no-js');
    nativePost = nativePage.waitForResponse((response) => response.request().method() === 'POST');
    await nativePage.getByRole('button', { name: 'Quitar acceso a native@example.test', exact: true }).click();
    assert.equal((await nativePost).status(), 303);
    await nativePage.getByText('Todavía no has dado acceso a otras personas.', { exact: true }).waitFor();
    pass(10, 'Escape returns to the menu trigger and no-JavaScript navigation, invalid email, add, current list, and revoke work');
    active = currentPage;
    const headers = { origin: instance.panel, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
    const body = new URLSearchParams({ intent: 'share', requestId: randomUUID(), email: 'boundary@example.test' }).toString();
    const invalidBodies = [`${body}&artifactId=${unpublished.artifactId}`, `${body}&email=other@example.test`, `${body}&ownerId=foreign`, body.replace('boundary', '%ZZ'), body.replace('boundary', 'x'.repeat(4096)), body.replace('intent=share', 'intent=archive'), body.replace(/requestId=[^&]+/, 'requestId=x')];
    for (const data of invalidBodies) assert.equal((await live.request.post(`${instance.panel}${path}`, { headers, data })).status(), 400);
    assert.equal((await live.request.post(`${instance.panel}${path}`, { headers: { ...headers, 'content-type': 'application/json' }, data: body })).status(), 400);
    assert.equal((await live.request.put(`${instance.panel}${path}`, { headers, data: body })).status(), 405);
    assert.equal((await live.request.post(`${instance.panel}${path}`, { headers: { ...headers, origin: 'https://foreign.example.test' }, data: body })).status(), 403);
    const guestRequests = guestSetup.request;
    const denied = await guestRequests.post(`${instance.panel}${path}`, { headers, data: new URLSearchParams({ intent: 'share', requestId: randomUUID(), email: 'nope' }).toString() });
    const missing = await guestRequests.post(`${instance.panel}/artifacts/missing-artifact/share`, { headers, data: new URLSearchParams({ intent: 'share', requestId: randomUUID(), email: 'nope' }).toString() });
    assert.equal(denied.status(), 404); assert.equal(missing.status(), 404); assert.equal(await denied.text(), await missing.text());
    assert.equal((await guestRequests.get(`${instance.panel}${path}`, { headers: { accept: 'application/json' } })).status(), 404);
    const anonymous = await context();
    assert.equal((await anonymous.request.get(`${instance.panel}${path}`)).status(), 401);
    assert.deepEqual(await current(artifact.artifactId), []);
    pass('HTTP-boundary', { malformedCases: invalidBodies.length + 1, method: 405, csrf: 403, nonowner: 404, missing: 404, anonymous: 401 });
    await currentPage.setViewportSize({ width: 1440, height: 900 });
    await openHeader(currentPage, artifact.artifactId);
    const removedTrigger = currentPage.locator('.detail-actions [data-share-trigger]');
    await removedTrigger.evaluate((element) => element.remove());
    await currentPage.keyboard.press('Escape');
    await dialog(currentPage).waitFor({ state: 'hidden' });
    await currentPage.waitForFunction(() => document.activeElement?.matches('#main-content h1'));
    assert.equal(await currentPage.locator('#main-content h1').evaluate((element) => element === document.activeElement), true);
    pass('removed-trigger', 'Escape focuses the main heading when the original trigger was removed');
    await currentPage.goto(`${instance.panel}/artifacts/${artifact.artifactId}`); await ready(currentPage);
    const modified = await currentPage.getByRole('link', { name: 'Compartir', exact: true }).evaluate((element) => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
      element.addEventListener('click', (value) => value.preventDefault(), { once: true });
      let preventedByCapture = false;
      element.addEventListener('click', (value) => { preventedByCapture = value.defaultPrevented; }, { capture: true, once: true });
      element.dispatchEvent(event); return preventedByCapture;
    });
    assert.equal(modified, false); assert.equal(await dialog(currentPage).count(), 0);
    pass('modified-click', 'The delegated sharing listener leaves modified clicks to native navigation');
    const delayed = await context({ storageState: ownerState });
    const hydration = deferred();
    await delayed.route('**/_astro/*.js', async (route) => { await hydration.promise; await route.continue(); });
    const draftPage = await delayed.newPage(); active = draftPage;
    await draftPage.goto(`${instance.panel}${path}`, { waitUntil: 'commit' });
    await draftPage.getByLabel('Correo electrónico', { exact: true }).fill('before-hydration@example.test');
    hydration.resolve();
    await draftPage.locator('astro-island[component-url*="ShareForm"]:not([ssr])').waitFor({ state: 'attached' });
    assert.equal(await draftPage.getByLabel('Correo electrónico', { exact: true }).inputValue(), 'before-hydration@example.test');
    assert.equal(await draftPage.getByLabel('Correo electrónico', { exact: true }).evaluate((element) => element === document.activeElement), true);
    pass('delayed-hydration', 'Native email draft and focus survive hydration');
    await delayed.close(); active = currentPage;
    await currentPage.goto(`${instance.panel}/artifacts/${artifact.artifactId}`); await ready(currentPage);
    const initialFailure = async (route: Route) => route.fulfill({ status: 503, body: 'Injected initial read failure' });
    await currentPage.route(`**${path}`, initialFailure);
    await currentPage.getByRole('link', { name: 'Compartir', exact: true }).click();
    await dialog(currentPage).getByRole('button', { name: 'Reintentar', exact: true }).waitFor();
    assert.equal(await dialog(currentPage).getByText('Todavía no has dado acceso a otras personas.', { exact: true }).count(), 0);
    await currentPage.unroute(`**${path}`, initialFailure);
    await dialog(currentPage).getByRole('button', { name: 'Reintentar', exact: true }).click(); await opened(currentPage);
    pass('initial-read-failure', 'An injected unavailable initial list is not rendered as an empty list');
    let mutationCount = 0;
    const held = deferred();
    const reached = deferred();
    const doubleHandler = async (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue();
      mutationCount++; reached.resolve(); await held.promise; await route.continue();
    };
    await currentPage.route(`**${path}`, doubleHandler);
    await dialog(currentPage).getByLabel('Correo electrónico', { exact: true }).fill('double@example.test');
    await dialog(currentPage).locator('form').first().evaluate((element) => { const form = element as HTMLFormElement; form.requestSubmit(); form.requestSubmit(); });
    await reached.promise; assert.equal(mutationCount, 1); held.resolve();
    await dialog(currentPage).getByText('double@example.test', { exact: true }).waitFor();
    assert.equal(mutationCount, 1);
    await currentPage.unroute(`**${path}`, doubleHandler);
    pass('double-submit', 'Two synchronous submit events cause exactly one actual POST');
    await clear(artifact.artifactId);
    await openHeader(currentPage, artifact.artifactId);
    const firstRead = deferred(); const releaseRead = deferred(); let getCount = 0;
    const reverse = async (route: Route) => {
      if (route.request().method() !== 'GET') return route.continue();
      if (++getCount !== 1) return route.continue();
      const snapshot = await route.fetch(); firstRead.resolve(); await releaseRead.promise; await route.fulfill({ response: snapshot });
    };
    await currentPage.route(`**${path}`, reverse);
    await close(currentPage);
    await currentPage.getByRole('link', { name: 'Compartir', exact: true }).click(); await firstRead.promise;
    await close(currentPage);
    await client.share({ artifactId: artifact.artifactId, email: 'newer@example.test', requestId: randomUUID() });
    await currentPage.getByRole('link', { name: 'Compartir', exact: true }).click(); await opened(currentPage);
    await dialog(currentPage).getByText('newer@example.test', { exact: true }).waitFor();
    releaseRead.resolve(); await currentPage.waitForTimeout(150);
    assert.equal(await rows(currentPage).count(), 1);
    await currentPage.unroute(`**${path}`, reverse);
    pass('reversed-reads', 'A delayed old GET cannot replace the current opening with stale rows');
    await clear(artifact.artifactId);
    await currentPage.goto(instance.panel); await ready(currentPage);
    const openMenu = async (title: string) => { await currentPage.getByRole('button', { name: `Menú de ${title}`, exact: true }).click(); await currentPage.getByRole('menuitem', { name: 'Compartir', exact: true }).click(); await opened(currentPage); };
    await openMenu('Sharing proof');
    const committed = deferred(); const releasePost = deferred();
    const late = async (route: Route) => { if (route.request().method() !== 'POST') return route.continue(); const result = await route.fetch(); assert.equal(result.status(), 200); committed.resolve(); await releasePost.promise; await route.fulfill({ response: result }); };
    await currentPage.route(`**${path}`, late);
    await dialog(currentPage).getByLabel('Correo electrónico', { exact: true }).fill('late-a@example.test');
    await dialog(currentPage).getByRole('button', { name: 'Dar acceso', exact: true }).click(); await committed.promise;
    await close(currentPage); await openMenu('Unpublished sharing proof');
    await add(currentPage, 'independent-b@example.test');
    assert.equal(await dialog(currentPage).getByText('late-a@example.test', { exact: true }).count(), 0);
    await close(currentPage); await openMenu('Sharing proof');
    assert.equal(await dialog(currentPage).getByRole('button', { name: 'Dar acceso', exact: true }).isDisabled(), true);
    releasePost.resolve();
    await dialog(currentPage).getByText('Acceso actualizado.', { exact: true }).waitFor();
    await dialog(currentPage).getByText('late-a@example.test', { exact: true }).waitFor();
    await currentPage.unroute(`**${path}`, late);
    await close(currentPage); await openMenu('Sharing proof');
    const committedWhileB = deferred(); const releaseWhileB = deferred();
    const lateWhileB = async (route: Route) => { if (route.request().method() !== 'POST') return route.continue(); const result = await route.fetch(); assert.equal(result.status(), 200); committedWhileB.resolve(); await releaseWhileB.promise; await route.fulfill({ response: result }); };
    await currentPage.route(`**${path}`, lateWhileB);
    await dialog(currentPage).getByLabel('Correo electrónico', { exact: true }).fill('late-while-b@example.test');
    await dialog(currentPage).getByRole('button', { name: 'Dar acceso', exact: true }).click(); await committedWhileB.promise;
    await close(currentPage); await openMenu('Unpublished sharing proof'); releaseWhileB.resolve(); await currentPage.waitForTimeout(150);
    assert.equal(await dialog(currentPage).getByText('late-while-b@example.test', { exact: true }).count(), 0);
    await dialog(currentPage).getByText('independent-b@example.test', { exact: true }).waitFor();
    await close(currentPage); await openMenu('Sharing proof');
    await dialog(currentPage).getByText('late-while-b@example.test', { exact: true }).waitFor();
    assert.equal(await dialog(currentPage).getByRole('button', { name: 'Dar acceso', exact: true }).isDisabled(), false);
    await currentPage.unroute(`**${path}`, lateWhileB);
    pass('late-A-while-B', 'Settling A while B remains open changes neither B rows nor B outcome, and A reopens current');
    pass('A-close-B-open-A-reopen', 'A actual committed delayed POST preserves its command across B mutation and reconciles reopened A');
    await clear(artifact.artifactId); await openHeader(currentPage, artifact.artifactId);
    const failedGet = async (route: Route) => route.request().method() === 'GET' ? route.fulfill({ status: 503, body: 'Injected read failure' }) : route.continue();
    await currentPage.route(`**${path}`, failedGet);
    await dialog(currentPage).getByLabel('Correo electrónico', { exact: true }).fill('confirmed@example.test');
    await dialog(currentPage).getByRole('button', { name: 'Dar acceso', exact: true }).click();
    await dialog(currentPage).getByRole('button', { name: 'Actualizar acceso', exact: true }).waitFor();
    await dialog(currentPage).getByText('Acceso actualizado.', { exact: true }).waitFor();
    assert.equal(await dialog(currentPage).getByRole('button', { name: 'Reintentar cambio', exact: true }).count(), 0);
    assert.equal((await current(artifact.artifactId)).length, 1);
    await currentPage.unroute(`**${path}`, failedGet);
    const beforeMutationRead = deferred(); const releaseBeforeMutation = deferred(); let refreshCount = 0;
    const oldRefresh = async (route: Route) => {
      if (route.request().method() !== 'GET' || ++refreshCount !== 1) return route.continue();
      const snapshot = await route.fetch(); beforeMutationRead.resolve(); await releaseBeforeMutation.promise; await route.fulfill({ response: snapshot });
    };
    await currentPage.route(`**${path}`, oldRefresh);
    await dialog(currentPage).getByRole('button', { name: 'Actualizar acceso', exact: true }).click(); await beforeMutationRead.promise;
    await add(currentPage, 'newer-mutation@example.test');
    assert.equal(await rows(currentPage).count(), 2);
    releaseBeforeMutation.resolve(); await currentPage.waitForTimeout(150);
    assert.equal(await rows(currentPage).count(), 2);
    await currentPage.unroute(`**${path}`, oldRefresh);
    pass('pre-mutation-read', 'A GET snapshot started before a new mutation cannot replace the post-mutation current list');
    pass('confirmed-read-failure', 'Injected failed GET after actual confirmed write offers only a read retry');
    await clear(artifact.artifactId); await openHeader(currentPage, artifact.artifactId);
    let lostCount = 0; const retries: string[] = [];
    const lost = async (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue();
      retries.push(route.request().postData()!);
      if (++lostCount > 1) return route.continue();
      const result = await route.fetch(); assert.equal(result.status(), 200); await route.abort('failed');
    };
    await currentPage.route(`**${path}`, lost);
    await dialog(currentPage).getByLabel('Correo electrónico', { exact: true }).fill(' Lost@Example.TEST ');
    await dialog(currentPage).getByRole('button', { name: 'Dar acceso', exact: true }).click();
    await dialog(currentPage).getByRole('button', { name: 'Reintentar cambio', exact: true }).waitFor();
    const committedShare = (await current(artifact.artifactId))[0]; assert.equal(committedShare.value, 'lost@example.test');
    await client.unshare({ artifactId: artifact.artifactId, shareId: committedShare.shareId, requestId: randomUUID() });
    await close(currentPage);
    await currentPage.getByRole('link', { name: 'Compartir', exact: true }).click(); await opened(currentPage);
    await dialog(currentPage).getByLabel('Correo electrónico', { exact: true }).evaluate((element) => { (element as HTMLInputElement).value = 'changed@example.test'; });
    await dialog(currentPage).getByRole('button', { name: 'Reintentar cambio', exact: true }).click();
    await dialog(currentPage).getByText('Acceso actualizado.', { exact: true }).waitFor(); await opened(currentPage);
    assert.equal(retries.length, 2); assert.equal(retries[0], retries[1]); assert.equal(await rows(currentPage).count(), 0);
    await currentPage.unroute(`**${path}`, lost);
    pass('lost-add-replay', 'POST reaches actual store, response is deliberately hidden, exact retry survives close/reopen and historical add replay leaves revoked list empty');
    const oldShare = await client.share({ artifactId: artifact.artifactId, email: 'regrant@example.test', requestId: randomUUID() });
    await openHeader(currentPage, artifact.artifactId); lostCount = 0; retries.length = 0;
    await currentPage.route(`**${path}`, lost);
    await dialog(currentPage).getByRole('button', { name: 'Quitar acceso a regrant@example.test', exact: true }).click();
    await dialog(currentPage).getByRole('button', { name: 'Reintentar cambio', exact: true }).waitFor();
    assert.deepEqual(await current(artifact.artifactId), []);
    const regrant = await client.share({ artifactId: artifact.artifactId, email: 'regrant@example.test', requestId: randomUUID() }); assert.notEqual(regrant.shareId, oldShare.shareId);
    await dialog(currentPage).getByRole('button', { name: 'Reintentar cambio', exact: true }).click();
    await dialog(currentPage).getByText('Acceso actualizado.', { exact: true }).waitFor(); await opened(currentPage);
    assert.equal(retries[0], retries[1]); assert.equal(await rows(currentPage).first().getAttribute('data-share-id'), regrant.shareId);
    await currentPage.unroute(`**${path}`, lost);
    pass('lost-revoke-replay', 'Actual revoke commit plus deliberately hidden response retains the exact retry and preserves the regranted shareId');
    await clear(artifact.artifactId);
    const denialContext = await context();
    const denialPage = await denialContext.newPage(); active = denialPage;
    await login(denialPage); await ready(denialPage);
    await denialPage.getByRole('button', { name: 'Menú de Sharing proof', exact: true }).click();
    await denialPage.getByRole('menuitem', { name: 'Compartir', exact: true }).click(); await opened(denialPage);
    const denialPostHeld = deferred(); const releaseDenialPost = deferred();
    const denialReadHeld = deferred(); const releaseDenialRead = deferred();
    const denialRace = async (route: Route) => {
      if (route.request().method() === 'POST') {
        denialPostHeld.resolve(); await releaseDenialPost.promise; await route.continue();
      } else {
        const snapshot = await route.fetch();
        assert.equal(snapshot.status(), 200);
        assert.deepEqual((await snapshot.json()).shares, { kind: 'ready', items: [] });
        denialReadHeld.resolve(); await releaseDenialRead.promise; await route.fulfill({ response: snapshot });
      }
    };
    await denialPage.route(`**${path}`, denialRace);
    await dialog(denialPage).getByLabel('Correo electrónico', { exact: true }).fill('denied@example.test');
    await dialog(denialPage).getByRole('button', { name: 'Dar acceso', exact: true }).click(); await denialPostHeld.promise;
    await close(denialPage);
    await denialPage.getByRole('button', { name: 'Menú de Unpublished sharing proof', exact: true }).click();
    await denialPage.getByRole('menuitem', { name: 'Compartir', exact: true }).click(); await opened(denialPage);
    await dialog(denialPage).getByText('independent-b@example.test', { exact: true }).waitFor();
    await close(denialPage);
    await denialPage.getByRole('button', { name: 'Menú de Sharing proof', exact: true }).click();
    await denialPage.getByRole('menuitem', { name: 'Compartir', exact: true }).click(); await denialReadHeld.promise;
    const logoutPage = await denialContext.newPage();
    await logoutPage.goto(instance.panel);
    await logoutPage.getByText('Mi cuenta', { exact: true }).click();
    const logoutResponse = logoutPage.waitForResponse((response) => new URL(response.url()).pathname === '/auth/logout' && response.request().method() === 'POST');
    await logoutPage.getByRole('button', { name: 'Cerrar sesión del panel', exact: true }).click();
    assert.equal((await logoutResponse).status(), 303);
    const deniedPost = denialPage.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === path);
    releaseDenialPost.resolve(); assert.equal((await deniedPost).status(), 401);
    await dialog(denialPage).getByText('No se puede abrir este artefacto.', { exact: true }).waitFor();
    const freshDeniedRead = await denialContext.request.get(`${instance.panel}${path}`, { headers: { accept: 'application/json' } });
    assert.equal(freshDeniedRead.status(), 401);
    const staleRead = denialPage.waitForResponse((response) => response.request().method() === 'GET' && new URL(response.url()).pathname === path);
    releaseDenialRead.resolve();
    const staleResponse = await staleRead;
    assert.equal(staleResponse.status(), 200); await staleResponse.finished();
    await denialPage.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const denialObserved = {
      capturedReadStatus: staleResponse.status(), postStatus: 401, freshReadStatus: freshDeniedRead.status(),
      denialCount: await dialog(denialPage).getByText('No se puede abrir este artefacto.', { exact: true }).count(),
      formCount: await dialog(denialPage).locator('form').count(),
      storedShares: await current(artifact.artifactId),
    };
    await writeFile(join(directory, 'late-denial.json'), JSON.stringify(denialObserved, null, 2));
    await capture(denialPage, 'late-denial');
    assert.equal(denialObserved.denialCount, 1, 'A pre-denial GET must not clear a terminal POST denial');
    assert.equal(denialObserved.formCount, 0, 'A pre-denial GET must not restore the sharing form');
    assert.deepEqual(denialObserved.storedShares, []);
    await denialPage.unroute(`**${path}`, denialRace);
    await logoutPage.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
    await logoutPage.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
    await close(denialPage);
    await denialPage.getByRole('button', { name: 'Menú de Sharing proof', exact: true }).click();
    await denialPage.getByRole('menuitem', { name: 'Compartir', exact: true }).click(); await opened(denialPage);
    assert.equal(await dialog(denialPage).getByRole('button', { name: 'Dar acceso', exact: true }).isDisabled(), false);
    assert.equal(await rows(denialPage).count(), 0);
    await add(denialPage, 'recovered@example.test');
    assert.deepEqual((await current(artifact.artifactId)).map(({ value }) => value), ['recovered@example.test']);
    await dialog(denialPage).getByRole('button', { name: 'Quitar acceso a recovered@example.test', exact: true }).click();
    await dialog(denialPage).getByText('Todavía no has dado acceso a otras personas.', { exact: true }).waitFor();
    assert.deepEqual(await current(artifact.artifactId), []);
    await capture(denialPage, 'late-denial-recovered');
    pass('late-denial-read', { ...denialObserved, recovery: 'A fresh opening after actual login can grant and revoke access' });
    const expired = await context({ storageState: ownerState });
    const expiredPage = await expired.newPage(); active = expiredPage;
    await expiredPage.goto(instance.panel);
    await expiredPage.getByText('Mi cuenta', { exact: true }).click();
    await expiredPage.getByRole('button', { name: 'Cerrar sesión del panel', exact: true }).click();
    assert.equal((await live.request.post(`${instance.panel}${path}`, { headers, data: body })).status(), 401);
    pass('expired-session', 'Actual panel logout invalidates the old authenticated share POST');
    await sharedWithMe();
    assert.deepEqual(errors, []);
    status = 'PASS';
  }
  }
} catch (error) {
  if (active && !active.isClosed()) await capture(active, 'failure').catch(() => {});
  throw error;
} finally {
  await writeFile(join(directory, 'result.json'), JSON.stringify({ status, parent, browser: browser.version(), results, errors, injectedFailures: ['Delayed GET/POST delivery', 'Confirmed POST followed by injected GET 503', 'Actual store committed POST response hidden by route abort'], posts }, null, 2));
  for (const item of contexts) await item.close().catch(() => {});
  await browser.close();
  await control(['cleanup', '--run', run]);
}
