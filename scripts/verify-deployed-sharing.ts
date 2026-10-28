import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { shareCommandResultSchema, shareSchema, type Share } from '../packages/contracts/src/index.ts';
import { serviceUrl } from '../packages/config/src/index.ts';

export type SharingVerification = {
  authOrigin: string;
  panelOrigin: string;
  publicationOrigin: string;
  ownerId: string;
  guestId: string;
  guestEmail: string;
  artifactId: string;
  revisionId: string;
  sha256: string;
  publicationVersion: number;
  disposable: true;
  evidenceDirectory: string;
};

function validate(config: SharingVerification) {
  assert.equal(config.disposable, true, 'Use a dedicated disposable publication and guest pair');
  for (const key of ['ownerId', 'guestId', 'artifactId', 'revisionId'] as const) assert.equal(typeof config[key], 'string');
  assert.notEqual(config.ownerId, config.guestId, 'Owner and guest must be distinct');
  assert.equal(shareSchema.shape.email.parse(config.guestEmail), config.guestEmail, 'Guest email must be normalized');
  assert.match(config.sha256, /^[a-f0-9]{64}$/);
  assert(Number.isSafeInteger(config.publicationVersion) && config.publicationVersion > 0);
  assert.equal(serviceUrl('AUTH_URL', { AUTH_URL: config.authOrigin }), config.authOrigin);
  assert.equal(serviceUrl('DASHBOARD_URL', { DASHBOARD_URL: config.panelOrigin }), config.panelOrigin);
  assert.equal(serviceUrl('PUBLISH_URL', { PUBLISH_URL: config.publicationOrigin }), config.publicationOrigin);
  assert.equal(new Set([config.authOrigin, config.panelOrigin, config.publicationOrigin].map((url) => new URL(url).hostname)).size, 3, 'Origins require distinct cookie hosts');
}

async function markers(page: Page, config: SharingVerification) {
  const marker = page.locator('[data-artifact-id][data-revision-id][data-revision-sha256][data-publication-version]');
  assert.equal(await marker.count(), 1, 'One exact publication marker is required');
  assert.deepEqual(await marker.evaluate((element) => ['data-artifact-id', 'data-revision-id', 'data-revision-sha256', 'data-publication-version'].map((name) => element.getAttribute(name))), [config.artifactId, config.revisionId, config.sha256, String(config.publicationVersion)], 'The selected publication differs from the expected revision');
}

export async function verifyDeployedSharing(owner: BrowserContext, guest: BrowserContext, config: SharingVerification) {
  validate(config);
  const directory = resolve(config.evidenceDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const save = (name: string, value: unknown) => writeFile(resolve(directory, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  const endpoint = `${config.panelOrigin}/artifacts/${encodeURIComponent(config.artifactId)}/share`;
  const publication = `${config.publicationOrigin}/a/${encodeURIComponent(config.artifactId)}`;
  const headers = { accept: 'application/json', origin: config.panelOrigin };
  const pages: Page[] = [];
  let created: Share | undefined;
  let cleaned = false;
  let failure: unknown;
  const request = { intent: 'share', requestId: randomUUID(), email: config.guestEmail, requireNew: 'true' };
  async function currentShares(): Promise<Share[]> {
    const response = await owner.request.get(endpoint, { headers, maxRedirects: 0 });
    assert.equal(response.status(), 200, 'The owner share view is unavailable');
    const view = await response.json();
    assert.equal(view.artifactId, config.artifactId);
    assert.equal(view.shares.kind, 'ready');
    return view.shares.items;
  }
  async function revoke(shareId: string) {
    const response = await owner.request.post(endpoint, { headers, form: { intent: 'unshare', requestId: randomUUID(), shareId }, maxRedirects: 0 });
    assert.equal(response.status(), 200, 'The verifier could not revoke its own share');
    assert.deepEqual(await response.json(), { outcome: 'confirmed' });
  }
  try {
    for (const [context, expectedId, isGuest] of [[owner, config.ownerId, false], [guest, config.guestId, true]] as const) {
      const session = await context.request.get(`${config.authOrigin}/api/auth/get-session`, { maxRedirects: 0 });
      assert.equal(session.status(), 200);
      const body = await session.json();
      assert.equal(body?.user?.id, expectedId, 'The browser state has the wrong or expired identity');
      assert(new Date(body.session.expiresAt).getTime() > Date.now(), 'The central session has expired');
      if (isGuest) {
        assert.equal(body.user.email, config.guestEmail);
        assert.equal(body.user.emailVerified, true, 'The guest email must be verified');
      }
      const page = await context.newPage();
      pages.push(page);
      const response = await page.goto(config.panelOrigin);
      assert.equal(response?.status(), 200);
      assert.equal(await page.getByTestId('user-id').textContent(), expectedId, 'The panel session does not match the central identity');
    }
    const ownerPage = pages[0]!;
    const guestPage = pages[1]!;
    await ownerPage.goto(`${config.panelOrigin}/artifacts/${encodeURIComponent(config.artifactId)}?revisionId=${encodeURIComponent(config.revisionId)}`);
    await markers(ownerPage, config);
    assert.equal((await ownerPage.goto(publication))?.status(), 200);
    assert.equal(ownerPage.url(), publication);
    await markers(ownerPage, config);
    assert(!(await currentShares()).some((share) => share.kind === 'email' && share.value === config.guestEmail), 'The guest already has access; no share was changed');
    await save('captured-request.json', { artifactId: config.artifactId, ...request });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await owner.request.post(endpoint, { headers, form: request, maxRedirects: 0 });
        if (response.status() >= 400 && response.status() < 500) throw new Error(`Conditional creation refused with HTTP ${response.status()}`);
        assert.equal(response.status(), 200, 'Conditional creation did not return confirmation');
        const body = await response.json();
        assert.equal(body.outcome, 'confirmed');
        const result = shareCommandResultSchema.parse(body.result);
        assert.equal(result.artifactId, config.artifactId);
        assert.equal(result.value, config.guestEmail);
        created = result;
        await save('created-share.json', result);
        break;
      } catch (error) {
        if (attempt === 1 || error instanceof Error && error.message.startsWith('Conditional creation refused')) throw error;
      }
    }
    assert(created, 'No owned creation result was obtained');
    const opened = await guestPage.goto(publication);
    assert.equal(opened?.status(), 200);
    assert.equal(guestPage.url(), publication);
    await markers(guestPage, config);
    assert((await guest.cookies(publication)).some((cookie) => cookie.name.includes('artifacts-viewer-')), 'Keep the established viewer cookie for revocation');
    await guestPage.screenshot({ path: resolve(directory, 'deployed.png'), fullPage: true });
    await revoke(created.shareId);
    cleaned = true;
    const denied = await guestPage.goto(publication);
    assert.equal(denied?.status(), 403, 'The next request with the established viewer cookie must be denied');
    await guestPage.screenshot({ path: resolve(directory, 'revoked.png'), fullPage: true });
  } catch (error) { failure = error; }
  finally {
    try {
      if (created && !cleaned) {
        if ((await currentShares()).some((share) => share.shareId === created!.shareId)) await revoke(created.shareId);
        cleaned = true;
      }
    } catch (error) { failure ??= error; }
    await Promise.all(pages.map((page) => page.close()));
    await save('result.json', { status: failure ? 'ISSUES' : 'PASS', artifactId: config.artifactId, revisionId: config.revisionId, sha256: config.sha256, publicationVersion: config.publicationVersion, createdShareId: created?.shareId, cleaned, message: failure instanceof Error ? failure.message : undefined });
  }
  if (failure) throw failure;
  return { status: 'PASS' as const, createdShareId: created!.shareId, cleaned };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  assert.deepEqual(args.filter((_, index) => index % 2 === 0), ['--config', '--owner-state', '--guest-state'], 'Use --config FILE --owner-state FILE --guest-state FILE');
  assert.equal(args.length, 6);
  for (const path of [args[3]!, args[5]!]) assert.equal((await stat(path)).mode & 0o077, 0, 'Browser states must be private to their owner');
  const config = JSON.parse(await readFile(args[1]!, 'utf8')) as SharingVerification;
  validate(config);
  const browser = await chromium.launch({ ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : { channel: 'chrome' }), headless: true });
  try {
    const owner = await browser.newContext({ storageState: args[3] });
    const guest = await browser.newContext({ storageState: args[5] });
    console.log(JSON.stringify(await verifyDeployedSharing(owner, guest, config)));
  } finally { await browser.close(); }
}
