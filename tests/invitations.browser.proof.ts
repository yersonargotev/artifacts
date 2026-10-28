import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { createArtifactHttpClient } from '../packages/client/src/index.ts';
import { artifactReadSchema, type ShareResult } from '../packages/contracts/src/index.ts';
import { verifyDeployedSharing, type SharingVerification } from '../scripts/verify-deployed-sharing.ts';
import { restCliFixture } from './rest-cli-fixture.ts';
import { grant } from './helpers.ts';

const execute = promisify(execFile);
const record = process.argv.includes('--record');
const directory = resolve(`.test-artifacts/invitations-${randomUUID()}`);
const review = resolve('.test-artifacts/review');
const privateDirectory = await mkdtemp(join(tmpdir(), 'artifacts-invitations-proof-'));
await mkdir(directory, { recursive: true, mode: 0o700 });
await mkdir(review, { recursive: true });
const app = await restCliFixture({ allowGuests: true, emailCode: true, invitations: true });
const browser = await chromium.launch({ ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : { channel: 'chrome' }), headless: !process.argv.includes('--headed') });
const contexts: BrowserContext[] = [];
const results: { lane: number | string; status: 'PASS'; observed: unknown }[] = [];
const segments: { source: string; start: number; duration: number }[] = [];
const pass = (lane: number | string, observed: unknown) => { results.push({ lane, status: 'PASS', observed }); console.log(JSON.stringify(results.at(-1))); };
const pause = (milliseconds: number) => record ? new Promise((done) => setTimeout(done, milliseconds)) : Promise.resolve();
async function context(options: Parameters<typeof browser.newContext>[0] = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  contexts.push(context);
  return context;
}
async function capture(page: Page, name: string, reviewName?: string) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} must fit`);
  await page.screenshot({ path: join(directory, `${name}.png`) });
  if (reviewName) await copyFile(join(directory, `${name}.png`), join(review, `S10-review-${reviewName}.png`));
}
async function messages() {
  return (await readFile(app.emailSink!, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error; })).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { to: string; subject: string; text: string; html?: string });
}
const invitations = async () => (await messages()).filter((message) => message.subject === 'Un artefacto compartido contigo');
async function login(page: Page) {
  await page.goto(app.dashboard);
  await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByLabel('Correo electrónico', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Contraseña', { exact: true }).fill(app.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
}
let status = 'ISSUES';
try {
  const token = await grant(app, 'openid profile artifacts:read artifacts:write artifacts:publish');
  const client = createArtifactHttpClient({ resource: app.config.resource, accessToken: token.access_token });
  async function mcp(name: string, args: unknown) {
    const response = await fetch(app.config.resource, { method: 'POST', headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    assert.equal(response.status, 200);
    const text = await response.text();
    const body = JSON.parse(text.startsWith('event:') ? text.split('\n').find((line) => line.startsWith('data:'))!.slice(5) : text);
    assert(!body.error && !body.result.isError, JSON.stringify(body));
    return body.result.structuredContent;
  }
  const created = artifactReadSchema.parse(await mcp('artifacts_create', { requestId: randomUUID(), snapshot: { metadata: { title: 'Invitación de prueba', description: 'Publicación desechable' }, content: { kind: 'html', text: '<h1>La invitación funciona</h1><p>Esta es la revisión publicada que compartió Test owner.</p>' }, files: [] } }));
  const publication = await client.publish({ requestId: randomUUID(), artifactId: created.artifactId, revisionId: created.revision.id, expectedPublicationVersion: 0 });
  const owner = await context();
  const ownerPage = await owner.newPage();
  await login(ownerPage);
  const ownerState = await owner.storageState();
  const ownerVideo = await context({ storageState: ownerState, ...(record ? { recordVideo: { dir: join(directory, 'owner-video'), size: { width: 1440, height: 900 } } } : {}) });
  const page = await ownerVideo.newPage();
  const ownerStarted = Date.now();
  await page.goto(`${app.dashboard}/artifacts/${created.artifactId}`);
  await page.locator('astro-island[component-url*="ShareDialog"]:not([ssr])').waitFor({ state: 'attached' });
  await page.getByRole('link', { name: 'Compartir', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Correo electrónico', { exact: true }).fill('invited@example.test');
  await pause(4000);
  await dialog.getByLabel('Avisar por correo', { exact: true }).check();
  await pause(4000);
  await dialog.getByRole('button', { name: 'Dar acceso', exact: true }).click();
  await dialog.getByText('Acceso concedido. Aviso por correo solicitado.', { exact: true }).waitFor();
  assert.equal((await invitations()).length, 1);
  const originalShare = (await client.listShares({ artifactId: created.artifactId })).items[0]!;
  await capture(page, 'invite-sink', 'panel-notify');
  await pause(4000);
  if (record) segments.push({ source: 'owner.webm', start: 0, duration: (Date.now() - ownerStarted) / 1000 });
  const ownerRecording = page.video();
  await ownerVideo.close();
  if (record) await ownerRecording!.saveAs(join(directory, 'owner.webm'));
  pass(2, { invitations: 1, shareId: originalShare.shareId, screenshot: 'invite-sink.png' });

  const mail = (await invitations())[0]!;
  const link = mail.text.split('\n').find((line) => line.startsWith(app.publishOrigin));
  assert.equal(link, publication.url);
  await writeFile(join(directory, 'invitation.html'), mail.html!, { mode: 0o600 });
  const guest = await context(record ? { recordVideo: { dir: join(directory, 'guest-video'), size: { width: 1440, height: 900 } } } : {});
  const guestPage = await guest.newPage();
  const guestStarted = Date.now();
  await guestPage.goto(link!);
  if (await guestPage.getByRole('link', { name: 'Iniciar sesión', exact: true }).isVisible()) await guestPage.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  await guestPage.getByLabel('Correo electrónico', { exact: true }).fill('invited@example.test');
  await pause(5000);
  await guestPage.getByRole('button', { name: 'Recibir código', exact: true }).click();
  await guestPage.getByText('Te enviamos un código', { exact: true }).waitFor();
  await capture(guestPage, 'invite-signin', 'guest-signin');
  await pause(5000);
  let code: string | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    code = (await messages()).findLast((message) => message.to === 'invited@example.test' && message.subject === 'Tu código para Artifacts')?.text.match(/\b\d{6}\b/)?.[0];
    if (code) break;
    await new Promise((done) => setTimeout(done, 30));
  }
  assert(code);
  await guestPage.getByLabel('Código de acceso', { exact: true }).fill(code);
  await pause(4000);
  await guestPage.locator('#email-code').getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await guestPage.waitForURL(publication.url);
  await guestPage.frameLocator('iframe').getByRole('heading', { name: 'La invitación funciona', exact: true }).waitFor();
  assert.equal(await guestPage.locator('[data-revision-id]').getAttribute('data-revision-id'), created.revision.id);
  await capture(guestPage, 'invite-flow');
  await pause(6000);
  if (record) segments.push({ source: 'guest.webm', start: 0, duration: (Date.now() - guestStarted) / 1000 });
  const guestState = await guest.storageState();
  const guestRecording = guestPage.video();
  const guestIdentity = await (await guest.request.get(`${app.config.origin}/api/auth/get-session`)).json();
  await guest.close();
  if (record) await guestRecording!.saveAs(join(directory, 'guest.webm'));
  pass(3, { revisionId: created.revision.id, verifiedGuest: guestIdentity.user.emailVerified, screenshot: 'invite-signin.png' });

  const emailContext = await context();
  const emailPage = await emailContext.newPage();
  for (const width of [390, 1440]) {
    await emailPage.setViewportSize({ width, height: 900 });
    await emailPage.goto(pathToFileURL(join(directory, 'invitation.html')).href);
    await emailPage.getByText('Test owner', { exact: true }).waitFor();
    assert.equal(await emailPage.getByRole('link', { name: 'Abrir publicación', exact: true }).getAttribute('href'), publication.url);
    await capture(emailPage, `invite-${width}`, `email-${width}`);
  }
  pass(8, { widths: [390, 1440], source: 'invitation.html' });

  const mcpCommand = { requestId: randomUUID(), artifactId: created.artifactId, email: 'mcp@example.test', notify: true };
  const mcpResult = await mcp('artifacts_share', mcpCommand);
  assert.deepEqual(mcpResult.notification, { status: 'requested' });
  assert.equal((await invitations()).filter((message) => message.to === mcpCommand.email).length, 1);
  pass(5, { notification: mcpResult.notification, messages: 1 });
  await ownerPage.goto(`${app.dashboard}/artifacts/${created.artifactId}/share`);
  await capture(ownerPage, 'mcp-notify');
  assert.deepEqual(await mcp('artifacts_share', mcpCommand), mcpResult);
  assert.equal((await invitations()).filter((message) => message.to === mcpCommand.email).length, 1);
  pass(7, { exactReplay: true, messages: 1 });
  await ownerPage.reload();
  await capture(ownerPage, 'notify-retry');
  const cliEnv = { PATH: process.env.PATH, ARTIFACTS_SERVER: app.config.resource, ARTIFACTS_ACCESS_TOKEN: token.access_token, ARTIFACTS_STATE_DIR: join(privateDirectory, 'cli-state') };
  const cli = await execute(process.execPath, ['--import', 'tsx', 'apps/cli/src/index.ts', 'share', created.artifactId, '--email', 'cli@example.test', '--notify'], { env: cliEnv });
  assert.deepEqual(JSON.parse(cli.stdout).notification, { status: 'requested' });
  assert.equal((await invitations()).filter((message) => message.to === 'cli@example.test').length, 1);
  pass(6, { notification: 'requested', messages: 1 });
  await ownerPage.reload();
  await capture(ownerPage, 'cli-notify');

  const native = await context({ storageState: ownerState, javaScriptEnabled: false });
  const nativePage = await native.newPage();
  await nativePage.goto(`${app.dashboard}/artifacts/${created.artifactId}/share`);
  await nativePage.getByLabel('Correo electrónico', { exact: true }).fill('native@example.test');
  await nativePage.getByLabel('Avisar por correo', { exact: true }).check();
  const nativeResponse = nativePage.waitForResponse((response) => response.request().method() === 'POST');
  await nativePage.getByRole('button', { name: 'Dar acceso', exact: true }).click();
  assert.equal((await nativeResponse).status(), 303);
  await nativePage.getByText('Acceso concedido. Aviso por correo solicitado.', { exact: true }).waitFor();
  assert.equal(new URL(nativePage.url()).search, '?notice=requested');
  pass('native', { status: 303, notice: 'requested' });

  await ownerPage.goto(`${app.dashboard}/artifacts/${created.artifactId}`);
  await ownerPage.locator('astro-island[component-url*="ShareDialog"]:not([ssr])').waitFor({ state: 'attached' });
  await ownerPage.getByRole('link', { name: 'Compartir', exact: true }).click();
  const hiddenDialog = ownerPage.getByRole('dialog');
  await hiddenDialog.getByLabel('Correo electrónico', { exact: true }).fill('hidden@example.test');
  await hiddenDialog.getByLabel('Avisar por correo', { exact: true }).check();
  const captured: string[] = [];
  await ownerPage.route(`**/artifacts/${created.artifactId}/share`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    captured.push(route.request().postData()!);
    const response = await route.fetch();
    if (captured.length === 1) return route.abort('failed');
    return route.fulfill({ response });
  });
  await hiddenDialog.getByRole('button', { name: 'Dar acceso', exact: true }).click();
  await hiddenDialog.getByRole('button', { name: 'Reintentar cambio', exact: true }).waitFor();
  await hiddenDialog.getByLabel('Avisar por correo', { exact: true }).evaluate((element) => { (element as HTMLInputElement).checked = false; });
  await hiddenDialog.getByRole('button', { name: 'Reintentar cambio', exact: true }).click();
  await hiddenDialog.getByText('Acceso concedido. Aviso por correo solicitado.', { exact: true }).waitFor();
  assert.equal(captured.length, 2);
  assert.equal(captured[0], captured[1]);
  assert.equal(new URLSearchParams(captured[0]).get('notify'), 'true');
  assert.equal((await invitations()).filter((message) => message.to === 'hidden@example.test').length, 1);
  await ownerPage.unroute(`**/artifacts/${created.artifactId}/share`);
  pass('panel-hidden-response', { immutableNotify: true, identicalRetry: true, messages: 1 });

  for (let count = (await invitations()).length; count < 100; count++) await client.share({ requestId: randomUUID(), artifactId: created.artifactId, email: 'quota@example.test', notify: true });
  await nativePage.getByLabel('Correo electrónico', { exact: true }).fill('limited@example.test');
  await nativePage.getByLabel('Avisar por correo', { exact: true }).check();
  await nativePage.getByRole('button', { name: 'Dar acceso', exact: true }).click();
  await nativePage.getByText('Acceso concedido. Alcanzaste el límite diario de avisos. Podrás solicitar otro a partir de las 00:00 UTC.', { exact: true }).waitFor();
  assert((await client.listShares({ artifactId: created.artifactId })).items.some((share) => share.value === 'limited@example.test'));
  assert.equal((await invitations()).length, 100);
  await capture(nativePage, 'invite-limit');
  pass(4, { invitations: 100, limitedAccessGranted: true, screenshot: 'invite-limit.png' });

  const admission = await client.create({ requestId: randomUUID(), snapshot: { metadata: { title: 'Verifier guest admission', description: '' }, content: { kind: 'text', text: 'Independent unpublished invitation for the verification account.' }, files: [] } });
  await client.share({ requestId: randomUUID(), artifactId: admission.artifactId, email: 'invited@example.test' });
  await client.unshare({ requestId: randomUUID(), artifactId: created.artifactId, shareId: originalShare.shareId });
  const verificationGuest = await context({ storageState: guestState });
  const config: SharingVerification = { authOrigin: app.config.origin, panelOrigin: app.dashboard, publicationOrigin: app.publishOrigin, ownerId: app.ownerId, guestId: guestIdentity.user.id, guestEmail: 'invited@example.test', artifactId: created.artifactId, revisionId: created.revision.id, sha256: created.revision.sha256, publicationVersion: 1, disposable: true, evidenceDirectory: join(directory, 'verifier') };
  assert.equal((await verifyDeployedSharing(owner, verificationGuest, config)).status, 'PASS');
  const ownerPath = join(privateDirectory, 'owner.json');
  const guestPath = join(privateDirectory, 'guest.json');
  const configPath = join(privateDirectory, 'verification.json');
  await writeFile(ownerPath, JSON.stringify(ownerState), { mode: 0o600 });
  await writeFile(guestPath, JSON.stringify(guestState), { mode: 0o600 });
  await writeFile(configPath, JSON.stringify({ ...config, evidenceDirectory: join(directory, 'verifier-cli') }), { mode: 0o600 });
  await chmod(ownerPath, 0o600);
  await chmod(guestPath, 0o600);
  const verified = await execute(process.execPath, ['--import', 'tsx', 'scripts/verify-deployed-sharing.ts', '--config', configPath, '--owner-state', ownerPath, '--guest-state', guestPath]);
  assert.equal(JSON.parse(verified.stdout).status, 'PASS');
  for (const [name, wrong] of [['wrong-identity', { guestId: randomUUID() }], ['stale-revision', { sha256: '0'.repeat(64) }]] as const) await assert.rejects(verifyDeployedSharing(owner, verificationGuest, { ...config, ...wrong, evidenceDirectory: join(directory, name) }));
  const preexisting = await client.share({ requestId: randomUUID(), artifactId: created.artifactId, email: config.guestEmail });
  await assert.rejects(verifyDeployedSharing(owner, verificationGuest, { ...config, evidenceDirectory: join(directory, 'preexisting') }), /already has access/);
  assert((await client.listShares({ artifactId: created.artifactId })).items.some((share) => share.shareId === preexisting.shareId));
  await client.unshare({ requestId: randomUUID(), artifactId: created.artifactId, shareId: preexisting.shareId });
  const post = owner.request.post.bind(owner.request);
  let competitor: ShareResult | undefined;
  owner.request.post = async (url, options) => {
    if (options?.form && 'requireNew' in options.form) competitor = await client.share({ requestId: randomUUID(), artifactId: created.artifactId, email: config.guestEmail });
    return post(url, options);
  };
  await assert.rejects(verifyDeployedSharing(owner, verificationGuest, { ...config, evidenceDirectory: join(directory, 'concurrent') }), /Conditional creation refused/);
  owner.request.post = post;
  assert(competitor);
  assert((await client.listShares({ artifactId: created.artifactId })).items.some((share) => share.shareId === competitor!.shareId));
  await client.unshare({ requestId: randomUUID(), artifactId: created.artifactId, shareId: competitor.shareId });
  let hidden = false;
  owner.request.post = async (url, options) => {
    const response = await post(url, options);
    if (!hidden && options?.form && 'requireNew' in options.form) { hidden = true; throw new Error('Injected loss of a real committed response'); }
    return response;
  };
  assert.equal((await verifyDeployedSharing(owner, verificationGuest, { ...config, evidenceDirectory: join(directory, 'hidden-response') })).status, 'PASS');
  owner.request.post = post;
  let replaced: ShareResult | undefined;
  let historicalId: string | undefined;
  owner.request.post = async (url, options) => {
    const response = await post(url, options);
    if (!replaced && options?.form && 'requireNew' in options.form) {
      historicalId = (await response.json()).result.shareId;
      await client.unshare({ requestId: randomUUID(), artifactId: created.artifactId, shareId: historicalId! });
      replaced = await client.share({ requestId: randomUUID(), artifactId: created.artifactId, email: config.guestEmail });
      throw new Error('Injected response loss after a concurrent revoke and replacement');
    }
    return response;
  };
  await assert.rejects(verifyDeployedSharing(owner, verificationGuest, { ...config, evidenceDirectory: join(directory, 'replaced-result') }));
  owner.request.post = post;
  assert(replaced);
  assert.equal(JSON.parse(await readFile(join(directory, 'replaced-result/created-share.json'), 'utf8')).shareId, historicalId);
  assert((await client.listShares({ artifactId: created.artifactId })).items.some((share) => share.shareId === replaced!.shareId));
  await client.unshare({ requestId: randomUUID(), artifactId: created.artifactId, shareId: replaced.shareId });
  owner.request.post = async (url, options) => {
    const response = await post(url, options);
    if (options?.form && 'requireNew' in options.form) await Promise.all(verificationGuest.pages().map((page) => page.close()));
    return response;
  };
  await assert.rejects(verifyDeployedSharing(owner, verificationGuest, { ...config, evidenceDirectory: join(directory, 'cleanup-failure') }));
  owner.request.post = post;
  assert(!(await client.listShares({ artifactId: created.artifactId })).items.some((share) => share.value === config.guestEmail));
  pass('verifier-local', { callable: true, actualCli: true, wrongIdentity: 'rejected', staleRevision: 'rejected', preexisting: 'preserved', concurrent: 'preserved', hiddenResponse: 'same request recovered', replacedResult: 'original ID retained, replacement preserved', failureCleanup: true });

  if (record) {
    await writeFile(join(directory, 'video-segments.json'), JSON.stringify({ method: 'Chronological cuts from actual owner and guest browser recordings at original speed. No repeated or synthetic frames.', segments }, null, 2));
    for (const [index, segment] of segments.entries()) await execute('ffmpeg', ['-y', '-ss', String(segment.start), '-i', join(directory, segment.source), '-t', String(segment.duration), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(directory, `segment-${index}.mp4`)]);
    await writeFile(join(directory, 'concat.txt'), segments.map((_, index) => `file 'segment-${index}.mp4'`).join('\n'));
    await execute('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', join(directory, 'concat.txt'), '-c', 'copy', '-movflags', '+faststart', join(review, 'S10-review.mp4')]);
    const duration = Number((await execute('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', join(review, 'S10-review.mp4')])).stdout.trim());
    assert(duration >= 30 && duration <= 60);
    pass('media', { duration, path: join(review, 'S10-review.mp4') });
  }
  status = 'PASS';
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await app.close();
  await rm(privateDirectory, { recursive: true, force: true });
  await writeFile(join(directory, 'result.json'), JSON.stringify({ status, results, cleanup: { runtime: 'removed', browser: 'closed', states: 'removed' } }, null, 2));
  console.log(JSON.stringify({ status, evidence: directory }));
}
