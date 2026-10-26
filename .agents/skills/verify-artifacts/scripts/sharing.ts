import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Browser, Page } from 'playwright';
import { artifactReadSchema, publishResultSchema, type Share } from '../../../../packages/artifacts/src/contracts.ts';

type Snapshot = ReturnType<typeof artifactReadSchema.parse>['revision']['snapshot'];
export type Account = { userId: string; email: string; emailVerified: boolean; accessToken: string };
interface SharingDrive {
  page: Page;
  browser: Browser;
  firstSnapshot: Snapshot;
  checks: string[];
  call(name: string, input?: unknown, allowError?: boolean, accessToken?: string): Promise<Record<string, any>>;
  control<T>(path: string, body: unknown): Promise<T>;
  account(email: string, verified: boolean): Promise<Account>;
  login(page: Page, fromPanel?: boolean, email?: string): Promise<void>;
  capture(page: Page, label: string): Promise<void>;
  record(action: string, result: unknown): Promise<void>;
}

export async function driveSharing({ page, browser, firstSnapshot, checks, call, control, account, login, capture, record }: SharingDrive) {
  const created = artifactReadSchema.parse(await call('artifacts_create', { requestId: randomUUID(), snapshot: firstSnapshot, project: 'Sharing proof' }));
  const { artifactId } = created;
  const published = publishResultSchema.parse(await call('artifacts_publish', { requestId: randomUUID(), artifactId, revisionId: created.revision.id, expectedPublicationVersion: 0 }));
  const guest = await account('guest@example.test', true);
  await record('Create disposable guest with a verified email', { userId: guest.userId, email: guest.email, emailVerified: guest.emailVerified });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const guestPage = await context.newPage();
    const viewerCookies = async () => (await context.cookies(published.url)).filter((cookie) => cookie.name.startsWith('__Host-artifacts-viewer-'));
    const admitted = async () => {
      await guestPage.frameLocator('iframe').getByRole('heading', { name: 'Verification revision 1', exact: true }).waitFor();
      assert.equal(await guestPage.locator('main').getAttribute('data-revision-id'), created.revision.id, 'Guest sees the published revision');
      assert.equal((await viewerCookies()).length, 1, 'Guest holds one viewer cookie');
    };

    await record('Open the publication as the guest before any share', { url: published.url });
    await guestPage.goto(published.url);
    const deniedResponse = guestPage.waitForResponse((response) => new URL(response.url()).pathname === '/publication/open' && response.status() !== 303);
    await login(guestPage, false, guest.email);
    const denied = await deniedResponse;
    assert.equal(denied.status(), 404, 'A guest without a share gets the panel 404 on a fresh open');
    assert.equal((await denied.body()).toString('utf8'), 'No se puede abrir este artefacto.');
    await record('Guest open without a share', { status: denied.status(), origin: new URL(denied.url()).origin });
    await capture(guestPage, 'guest-before-share');

    const share = await control<Share>('/share', { artifactId, email: 'GUEST@Example.TEST' });
    assert.equal(share.value, guest.email, 'A mixed-case share matches the lowercase account email');
    await record('Share through the store as the owner', share);
    await guestPage.goto(published.url);
    await admitted();
    assert.equal(await guestPage.locator('.project-navigation').count(), 0, 'Guest sees no owner project');
    const html = await guestPage.content();
    for (const detail of ['Sharing proof', 'Cliente autor', 'Revisión 1']) assert(!html.includes(detail), `Guest page omits ${detail}`);
    const attachment = await context.request.get(`${published.url}/r/${created.revision.id}/files/notes.txt`, { maxRedirects: 0 });
    assert.equal(attachment.status(), 200, 'Guest downloads the published attachment');
    assert.equal(await attachment.text(), firstSnapshot.files[0]!.data);
    await record('Guest views the publication and its attachment', { url: published.url, revisionId: created.revision.id, attachment: attachment.status() });
    await capture(guestPage, 'guest-view');
    await guestPage.setViewportSize({ width: 390, height: 844 });
    await guestPage.reload();
    await admitted();
    assert(await guestPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Guest page has no horizontal overflow at 390px');
    await capture(guestPage, 'guest-view-390');
    await guestPage.setViewportSize({ width: 1440, height: 900 });

    await record('Open the same publication as the owner', { url: published.url });
    await page.goto(published.url);
    await login(page, false);
    await page.waitForURL(published.url);
    await page.frameLocator('iframe').getByRole('heading', { name: 'Verification revision 1', exact: true }).waitFor();
    assert.equal(await page.locator('.project-navigation').getByText('Sharing proof', { exact: true }).count(), 1, 'Owner still sees the project');
    await capture(page, 'owner-view');

    for (const [name, input] of [['artifacts_read', { artifactId }], ['artifacts_history', { artifactId }], ['artifacts_export', { artifactId, revisionId: created.revision.id }]] as const) {
      assert.equal((await call(name, input, true, guest.accessToken)).error, 'not_found', `${name} with the guest token returns not_found`);
    }

    const [stale] = await viewerCookies();
    assert(stale, 'Guest holds a viewer cookie before revocation');
    await record('Revoke the share as the owner', await control('/unshare', { artifactId, shareId: share.shareId }));
    const revoked = await guestPage.goto(published.url);
    assert.equal(revoked?.status(), 403, 'The first request after revocation returns 403');
    assert.deepEqual(await viewerCookies(), [], 'Revocation clears the viewer cookie');
    await capture(guestPage, 'revoked');
    const replay = await fetch(published.url, { redirect: 'manual', headers: { cookie: `${stale.name}=${stale.value}` } });
    assert.equal(replay.status, 403, 'A replayed stale viewer cookie stays denied');
    assert.equal(await replay.text(), 'Tu sesión o esta publicación ya no están disponibles.');
    assert(replay.headers.getSetCookie().some((value) => value.startsWith(`${stale.name}=;`) && value.includes('Max-Age=0')), 'The denial clears the stale viewer cookie');
    await record('Guest reload and stale cookie replay after revocation', { browserStatus: revoked?.status(), replayStatus: replay.status, viewerCookies: 0 });

    await record('Share again so later lanes start from an admitted guest', await control<Share>('/share', { artifactId, email: guest.email }));
    await guestPage.goto(published.url);
    await admitted();
    await capture(guestPage, 'guest-readmitted');
    checks.push(
      'Fresh open without a share ends at the panel 404 with the fixed body',
      'Mixed-case share admits the verified guest to the published revision and attachment',
      'Guest page omits the owner project, author client and revision sequence; no overflow at 390px',
      'Owner page keeps the project navigation',
      'Guest MCP read, history and export return not_found',
      'Revocation returns 403 on the next request and clears the viewer cookie',
      'Re-share admits the guest again',
    );
  } finally { await context.close(); }
}
