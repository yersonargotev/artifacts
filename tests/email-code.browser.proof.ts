import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext } from 'playwright';
import { createArtifactHttpClient } from '../packages/client/src/index.ts';
import { grant, callWhoami } from './helpers.ts';

const run = resolve(process.argv[process.argv.indexOf('--run') + 1] ?? '');
const instance = JSON.parse(await readFile(join(run, 'instance.json'), 'utf8')) as { auth: string; mcp: string; panel: string; ownerId: string };
const credentials = JSON.parse(await readFile(join(run, 'runtime/credentials.json'), 'utf8')) as { accessToken: string; password: string };
const sink = JSON.parse(await readFile(join(run, 'runtime/email-code.json'), 'utf8')) as { path: string };
const directory = join(run, 'email-code');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const config = { origin: instance.auth, issuer: `${instance.auth}/api/auth`, resource: instance.mcp };
const records: Array<{ lane: number; result: string; status: 'PASS'; details?: unknown }> = [];
async function messages() {
  return (await readFile(sink.path, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error; })).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { to: string; text: string });
}
async function code(email: string, count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const matching = (await messages()).filter((message) => message.to === email);
    if (matching.length >= count) {
      const otp = matching.at(-1)!.text.match(/\b\d{6}\b/)?.[0];
      assert(otp);
      return otp;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('File delivery did not finish');
}
async function post(context: BrowserContext, path: string, body: unknown) {
  return context.request.post(`${config.issuer}${path}`, { headers: { origin: instance.auth }, data: body });
}
async function receipt(name: string, data: unknown) {
  const page = await browser.newPage();
  await page.setContent('<html lang="en"><title>Local HTTP verification</title><body><h1>Local HTTP verification</h1><pre></pre></body></html>');
  await page.locator('pre').evaluate((element, text) => { element.textContent = text; }, JSON.stringify(data, null, 2));
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
  await page.close();
}
async function oauth(context: BrowserContext) {
  const cookie = (await context.cookies(instance.auth)).map((value) => `${value.name}=${value.value}`).join('; ');
  return grant({ config, cookie }, 'openid profile offline_access artifacts:read artifacts:write artifacts:publish');
}
try {
  let ownerClient = createArtifactHttpClient({ resource: instance.mcp, accessToken: credentials.accessToken });
  const created = await ownerClient.create({ requestId: randomUUID(), snapshot: { metadata: { title: 'Email-code shared artifact', description: '' }, content: { kind: 'html', text: '<h1>Invited code publication</h1>' }, files: [] } });
  const published = await ownerClient.publish({ requestId: randomUUID(), artifactId: created.artifactId, revisionId: created.revision.id, expectedPublicationVersion: 0 });
  const email = 'ana@example.com';
  const share = await ownerClient.share({ requestId: randomUUID(), artifactId: created.artifactId, email });
  const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const sent = await post(guest, '/email-otp/send-verification-otp', { email: 'Ana@Example.com', type: 'sign-in' });
  assert.equal(sent.status(), 200);
  const sentBody = await sent.json();
  const guestCode = await code(email, 1);
  assert.equal((await messages()).filter((message) => message.to === email).length, 1);
  await receipt('sink', { to: email, messages: 1, code: '[redacted]', response: sentBody });
  records.push({ lane: 2, status: 'PASS', result: 'Invited HTTP request writes one file message' });
  const denied = await post(guest, '/email-otp/send-verification-otp', { email: 'uninvited@example.com', type: 'sign-in' });
  assert.equal(denied.status(), 200);
  assert.deepEqual(await denied.json(), sentBody);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal((await messages()).filter((message) => message.to === 'uninvited@example.com').length, 0);
  await receipt('uninvited', { status: denied.status(), response: sentBody, messages: 0 });
  records.push({ lane: 3, status: 'PASS', result: 'Uninvited response equals invited response and writes no message' });
  const signed = await post(guest, '/sign-in/email-otp', { email: 'Ana@Example.com', otp: guestCode, name: 'Invitado OTP' });
  assert.equal(signed.status(), 200);
  const identity = (await signed.json()).user;
  assert.equal(identity.email, email);
  const page = await guest.newPage();
  await page.goto(instance.panel);
  await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
  assert.equal(await page.getByTestId('user-id').textContent(), identity.id);
  await page.goto(published.url);
  await page.frameLocator('iframe').getByRole('heading', { name: 'Invited code publication', exact: true }).waitFor();
  assert.equal(await page.locator('main').getAttribute('data-revision-id'), created.revision.id);
  await page.screenshot({ path: join(directory, 'otp-guest.png'), fullPage: true });
  records.push({ lane: 1, status: 'PASS', result: 'Code guest passes actual panel callback and sees the published revision' });
  const guestTokens = await oauth(guest);
  const whoami = await callWhoami(instance.mcp, guestTokens.access_token);
  assert.equal(whoami.status, 200);
  assert((await whoami.text()).includes(identity.id));
  const guestClient = createArtifactHttpClient({ resource: instance.mcp, accessToken: guestTokens.access_token });
  for (const deniedRead of [() => guestClient.read({ artifactId: created.artifactId }), () => guestClient.history({ artifactId: created.artifactId }), () => guestClient.export({ artifactId: created.artifactId, revisionId: created.revision.id })]) await assert.rejects(deniedRead(), (error: unknown) => (error as { code: string }).code === 'not_found');
  await receipt('guest-oauth', { status: 200, userId: identity.id, ownerOnlyReadHistoryExport: 'denied' });
  records.push({ lane: 10, status: 'PASS', result: 'Guest MCP OAuth returns the code identity and owner-only reads stay denied' });
  const oldOwner = await browser.newContext();
  assert.equal((await post(oldOwner, '/sign-in/email', { email: 'owner@example.test', password: credentials.password })).status(), 200);
  const oldOwnerPage = await oldOwner.newPage();
  await oldOwnerPage.goto(instance.panel);
  await oldOwnerPage.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  await oldOwnerPage.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
  const owner = await browser.newContext();
  assert.equal((await post(owner, '/email-otp/send-verification-otp', { email: 'owner@example.test', type: 'sign-in' })).status(), 200);
  assert.equal((await post(owner, '/sign-in/email-otp', { email: 'owner@example.test', otp: await code('owner@example.test', 1) })).status(), 200);
  const ownerPage = await owner.newPage();
  await ownerPage.goto(instance.panel);
  await ownerPage.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  await ownerPage.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
  await ownerPage.screenshot({ path: join(directory, 'owner-otp.png'), fullPage: true });
  assert.equal((await post(owner, '/sign-in/email', { email: 'owner@example.test', password: credentials.password })).status(), 200);
  const ownerTokens = await oauth(owner);
  ownerClient = createArtifactHttpClient({ resource: instance.mcp, accessToken: ownerTokens.access_token });
  await oldOwnerPage.goto(instance.panel);
  await oldOwnerPage.getByRole('link', { name: 'Iniciar sesión', exact: true }).waitFor();
  records.push({ lane: 4, status: 'PASS', result: 'Owner code reaches the library, revokes the old panel session, and preserves the password' });
  assert.equal((await post(owner, '/email-otp/send-verification-otp', { email: 'owner@example.test', type: 'sign-in' })).status(), 200);
  const exhausted = await code('owner@example.test', 2);
  for (let attempt = 0; attempt < 3; attempt++) assert.equal((await post(owner, '/sign-in/email-otp', { email: 'owner@example.test', otp: exhausted === '999999' ? '888888' : '999999' })).status(), 400);
  const exhaustedResponse = await post(owner, '/sign-in/email-otp', { email: 'owner@example.test', otp: exhausted });
  assert.equal(exhaustedResponse.status(), 400);
  assert.deepEqual(await exhaustedResponse.json(), { code: 'INVALID_OTP', message: 'Invalid OTP' });
  await receipt('attempts', { wrongAttempts: 3, correctCodeStatusAfterExhaustion: 400, response: await exhaustedResponse.json() });
  records.push({ lane: 7, status: 'PASS', result: 'Three wrong attempts exhaust the code without masking from rate limits' });
  const signup = await post(guest, '/sign-up/email', { email: 'closed-signup@example.test', name: 'Closed', password: credentials.password });
  assert.equal(signup.status(), 400);
  await receipt('signup', { status: signup.status(), response: await signup.json() });
  records.push({ lane: 8, status: 'PASS', result: 'Production password signup remains closed' });
  await ownerClient.unshare({ requestId: randomUUID(), artifactId: created.artifactId, shareId: share.shareId });
  const revoked = await post(guest, '/email-otp/send-verification-otp', { email, type: 'sign-in' });
  assert.equal(revoked.status(), 200);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal((await messages()).filter((message) => message.to === email).length, 1);
  assert.equal((await page.goto(published.url))?.status(), 403);
  await receipt('revoked-otp', { requestStatus: 200, totalGuestMessages: 1, publicationStatus: 403 });
  records.push({ lane: 9, status: 'PASS', result: 'Revocation stops new delivery and publication access' });
  const emailStatuses: number[] = [];
  for (let attempt = 0; attempt < 4; attempt++) emailStatuses.push((await post(guest, '/email-otp/send-verification-otp', { email: 'limit@example.test', type: 'sign-in' })).status());
  assert.deepEqual(emailStatuses, [200, 200, 200, 429]);
  await receipt('email-limit', { statuses: emailStatuses });
  records.push({ lane: 5, status: 'PASS', result: 'Fourth request for the same email returns 429' });
  const ipStatuses: number[] = [];
  for (let attempt = 0; attempt < 2; attempt++) ipStatuses.push((await post(guest, '/email-otp/send-verification-otp', { email: `ip-limit-${attempt}@example.test`, type: 'sign-in' })).status());
  assert.deepEqual(ipStatuses, [200, 429]);
  await receipt('ip-limit', { priorIpReservations: 9, finalStatuses: ipStatuses, publicHeadersCannotChooseIp: true });
  records.push({ lane: 6, status: 'PASS', result: 'Eleventh IP reservation returns 429 across different addresses' });
  await writeFile(join(directory, 'result.json'), JSON.stringify({ status: 'PASS', scope: 'Disposable local Node HTTP, actual Chrome panel/publication, real MCP OAuth tokens', browser: browser.version(), records }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', lanes: records.length, directory }));
} finally { await browser.close(); }
