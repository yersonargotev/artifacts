import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createArtifactHttpClient } from '../packages/client/src/index.ts';
import { authConfig } from '../packages/config/src/index.ts';
import { createAuthApp } from '../apps/auth/src/http.ts';
import { fixture } from './helpers.ts';

const execute = promisify(execFile);
const helper = '.agents/skills/verify-artifacts/scripts/control.ts';
const args = process.argv.slice(2);
const headed = args.includes('--headed');
const passwordOnly = args.includes('--password-only');
const providedRun = args.includes('--run');
const run = resolve(providedRun ? args[args.indexOf('--run') + 1]! : `.test-artifacts/verify-artifacts/sign-in-code-${randomUUID()}`);
const directory = join(run, 'sign-in-code');
const review = resolve('.test-artifacts/review');
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const records: Array<{ lane: number | string; status: 'PASS'; result: string }> = [];
const children: ChildProcess[] = [];
const contexts: BrowserContext[] = [];
const control = (command: string[]) => execute(process.execPath, ['--import', 'tsx', helper, ...command], { maxBuffer: 1024 * 1024 });
if (!providedRun) await control(['launch', '--allow-guests', ...(passwordOnly ? [] : ['--email-code']), '--run', run]);
await mkdir(directory, { recursive: true });
await mkdir(review, { recursive: true });
const instance = JSON.parse(await readFile(join(run, 'instance.json'), 'utf8')) as { auth: string; api: string; mcp: string; panel: string; ownerId: string };
const credentials = JSON.parse(await readFile(join(run, 'runtime/credentials.json'), 'utf8')) as { accessToken: string; restAccessToken: string; password: string };
let browser: Browser | undefined;
const errors: string[] = [];
let status = 'ISSUES';
async function page(width = 1440, video = false) {
  assert(browser);
  const context = await browser.newContext({ viewport: { width, height: 900 }, ...(video ? { recordVideo: { dir: join(directory, 'video'), size: { width: 1440, height: 900 } } } : {}) });
  contexts.push(context);
  const current = await context.newPage();
  current.on('pageerror', (error) => errors.push(error.message));
  return current;
}
async function capture(current: Page, name: string, reviewSlug?: string) {
  const path = join(directory, `${name}.png`);
  await current.screenshot({ path, fullPage: true });
  await writeFile(join(directory, `${name}.aria.yml`), await current.locator('body').ariaSnapshot());
  if (reviewSlug) await copyFile(path, join(review, `S7-review-${reviewSlug}.png`));
}
function pass(lane: number | string, result: string) { records.push({ lane, status: 'PASS', result }); console.log(JSON.stringify({ lane, status: 'PASS', result })); }
async function openSignIn(current: Page) {
  await current.goto(instance.panel);
  await current.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  await current.getByLabel('Correo electrónico', { exact: true }).waitFor();
}
async function sent(current: Page, email: string) {
  await current.getByLabel('Correo electrónico', { exact: true }).fill(email);
  await current.getByRole('button', { name: 'Recibir código', exact: true }).click();
  await current.getByText('Te enviamos un código', { exact: true }).waitFor();
  assert.equal(await current.locator('#otp').evaluate((element) => element === document.activeElement), true);
  assert.equal(await current.locator('#password').isVisible(), false);
  assert.equal(await current.locator('#password').isDisabled(), true);
}
async function code(email: string) {
  const sink = JSON.parse(await readFile(join(run, 'runtime/email-code.json'), 'utf8')) as { path: string };
  for (let attempt = 0; attempt < 150; attempt++) {
    const messages = (await readFile(sink.path, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error; })).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { to: string; text: string });
    const otp = messages.filter((message) => message.to === email).at(-1)?.text.match(/\b\d{6}\b/)?.[0];
    if (otp) return otp;
    await delay(20);
  }
  throw new Error('Disposable file delivery did not finish');
}
async function redeem(current: Page, email: string) {
  await current.getByLabel('Código de acceso', { exact: true }).fill(await code(email));
  await current.locator('#email-code').getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
}
async function continuationFailure(current: Page) {
  let calls = 0;
  let redemptions = 0;
  let rawQuery = '';
  current.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/auth/sign-in/email-otp' && response.status() === 200) redemptions++;
  });
  await current.route('**/api/auth/oauth2/continue', async (route) => {
    calls++;
    assert.equal(route.request().postDataJSON().oauth_query, rawQuery);
    if (calls === 1) await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    else await route.continue();
  });
  return {
    rememberQuery() { rawQuery = new URL(current.url()).search.slice(1); assert(rawQuery); },
    async recover() {
      const retry = current.getByRole('button', { name: 'Continuar', exact: true });
      await retry.waitFor();
      assert.equal(await retry.evaluate((element) => element === document.activeElement), true);
      assert.equal(await current.locator('#otp').inputValue(), '');
      assert.equal(await current.locator('#otp').isDisabled(), true);
      const continued = current.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/oauth2/continue');
      await retry.press('Enter');
      await continued;
      assert.equal(calls, 2);
      assert.equal(redemptions, 1);
    },
  };
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: !headed });
  const password = await page();
  await openSignIn(password);
  await password.getByLabel('Correo electrónico', { exact: true }).fill('owner@example.test');
  await password.getByLabel('Contraseña', { exact: true }).fill(credentials.password);
  await password.locator('#signin').getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await password.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
  await capture(password, passwordOnly ? 'password-trunk' : 'password-head');
  pass(1, 'Password form reaches the actual panel library');
  if (passwordOnly) {
    const initial = await page();
    await initial.goto(`${instance.auth}/sign-in`);
    assert.equal(await initial.getByRole('button', { name: 'Recibir código', exact: true }).count(), 0);
    pass('parent', 'Verified S6 parent has no email-code form');
  } else {
    const client = createArtifactHttpClient({ resource: instance.api, accessToken: credentials.restAccessToken });
    const created = await client.create({ requestId: randomUUID(), snapshot: { metadata: { title: 'Sign-in browser proof', description: '' }, content: { kind: 'html', text: '<h1>Code sign-in invitation</h1>' }, files: [] } });
    const invite = async (email: string) => client.share({ requestId: randomUUID(), artifactId: created.artifactId, email });
    const email = 'ana@example.com';
    await invite(email);
    const desktop = await page(1440, headed);
    const video = desktop.video();
    const recovery = await continuationFailure(desktop);
    await openSignIn(desktop);
    recovery.rememberQuery();
    assert.equal(await desktop.getByRole('button', { name: 'Recibir código', exact: true }).count(), 1, 'Enabled sign-in exposes a real code request form');
    assert.equal(await desktop.locator('input[type=email]').count(), 1);
    assert.equal(await desktop.locator('#signin').getAttribute('method'), 'post');
    assert.equal(await desktop.locator('#signin').getAttribute('action'), '/api/auth/sign-in/email');
    assert.equal(await desktop.locator('#email-code').getAttribute('method'), 'post');
    assert.equal(await desktop.locator('#email-code').getAttribute('action'), '/api/auth/sign-in/email-otp');
    if (headed) await delay(9500);
    await desktop.getByLabel('Contraseña', { exact: true }).fill('discarded-secret');
    let sends = 0;
    let releaseSend!: () => void;
    const sendingGate = new Promise<void>((done) => { releaseSend = done; });
    await desktop.route('**/api/auth/email-otp/send-verification-otp', async (route) => { sends++; await sendingGate; await route.continue(); });
    const sending = sent(desktop, email);
    await desktop.waitForFunction(() => document.querySelector<HTMLInputElement>('#email')!.disabled);
    assert.equal(await desktop.locator('#password').isDisabled(), true);
    assert.equal(await desktop.locator('#request-code').isDisabled(), true);
    await desktop.locator('#email-code').evaluate((form: HTMLFormElement) => form.requestSubmit());
    await delay(50);
    assert.equal(sends, 1, 'Pending code requests cannot duplicate submission');
    releaseSend();
    await sending;
    await desktop.unroute('**/api/auth/email-otp/send-verification-otp');
    pass('pending-send', 'A real delayed send disables method controls and duplicate submission does not send again');
    assert.equal(await desktop.locator('#password').inputValue(), '');
    await capture(desktop, 'code-sent', 'sent');
    pass(2, 'Invited email requests a code independently of password requiredness and focuses the active field');
    if (headed) await delay(5500);
    assert.equal(await desktop.locator('#otp').getAttribute('type'), 'text');
    assert.equal(await desktop.locator('#otp').getAttribute('inputmode'), 'numeric');
    assert.equal(await desktop.locator('#otp').getAttribute('autocomplete'), 'one-time-code');
    await desktop.locator('#otp').fill('000000');
    assert.equal(await desktop.locator('#otp').inputValue(), '000000');
    const actual = await code(email);
    await desktop.locator('#otp').fill(actual === '000000' ? '111111' : '000000');
    await desktop.locator('#email-code').getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await desktop.getByText('El código no es válido o ha vencido. Revisa el código o solicita otro.', { exact: true }).waitFor();
    assert.equal(await desktop.locator('#otp').getAttribute('aria-invalid'), 'true');
    assert.equal(await desktop.locator('#otp').getAttribute('aria-describedby'), 'code-hint code-error');
    assert.equal(await desktop.locator('#otp').evaluate((element) => element === document.activeElement), true);
    const errorBounds = await desktop.locator('#code-error').boundingBox();
    const inputBounds = await desktop.locator('#otp').boundingBox();
    const fieldsetBounds = await desktop.locator('#code-fields').boundingBox();
    assert(errorBounds && inputBounds && fieldsetBounds);
    assert(errorBounds.x >= inputBounds.x && errorBounds.x + errorBounds.width <= inputBounds.x + inputBounds.width + 1);
    await writeFile(join(directory, 'error-bounds.json'), JSON.stringify({ desktop: { error: errorBounds, input: inputBounds, fieldset: fieldsetBounds } }, null, 2));
    await capture(desktop, 'wrong-code', 'wrong-code');
    pass(5, 'Wrong code has an inline Spanish error, accessible association and field focus; leading zeroes survive');
    if (headed) await delay(8500);
    await desktop.locator('#otp').fill(actual);
    let releaseRedeem!: () => void;
    let redeemRequests = 0;
    const redeemGate = new Promise<void>((done) => { releaseRedeem = done; });
    await desktop.route('**/api/auth/sign-in/email-otp', async (route) => { redeemRequests++; await redeemGate; await route.continue(); });
    await desktop.locator('#email-code').getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    assert.equal(await desktop.locator('#back-password').isDisabled(), true);
    assert.equal(await desktop.locator('#otp').isDisabled(), true);
    await desktop.locator('#email-code').evaluate((form: HTMLFormElement) => form.requestSubmit());
    await delay(50);
    assert.equal(redeemRequests, 1);
    releaseRedeem();
    pass('pending-redeem', 'A real delayed redemption disables Back and duplicate submission does not redeem again');
    await desktop.getByRole('button', { name: 'Continuar', exact: true }).waitFor();
    if (headed) await delay(4500);
    await recovery.recover();
    await desktop.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
    await capture(desktop, 'code-landed', 'landed');
    await capture(desktop, 'code-head');
    pass(3, 'Guest reaches actual panel library after one failed OAuth continuation and continuation-only recovery');
    pass('continuation-dashboard', 'Raw OAuth query bytes survive both continuation requests; one code redemption succeeds');
    if (headed) {
      await delay(6500);
      await desktop.context().close();
      assert(video);
      await video.saveAs(join(directory, 'headed-sign-in.webm'));
      await execute('/opt/homebrew/bin/ffmpeg', ['-y', '-i', join(directory, 'headed-sign-in.webm'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(review, 'S7-review.mp4')]);
      const metadata = await execute('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(review, 'S7-review.mp4')]);
      const duration = Number(metadata.stdout.trim());
      assert(duration >= 30 && duration <= 60, `Real recording duration ${duration}s`);
      pass('recording', `Actual headed browser sequence ${duration.toFixed(2)} seconds, unretimed`);
      console.log(JSON.stringify({ media: join(review, 'S7-review.mp4'), duration }));
    }
    const uninvited = await page();
    await uninvited.goto(`${instance.auth}/sign-in`);
    await sent(uninvited, 'uninvited@example.com');
    assert.equal(await uninvited.locator('#code-status').textContent(), 'Te enviamos un código');
    await capture(uninvited, 'uninvited-form');
    pass(6, 'Uninvited email receives the same confirmation and active form');
    const back = uninvited.getByRole('button', { name: 'Volver a la contraseña', exact: true });
    await uninvited.locator('#otp').fill('000123');
    await back.click();
    assert.equal(await uninvited.locator('#email').inputValue(), 'uninvited@example.com');
    assert.equal(await uninvited.locator('#password').inputValue(), '');
    assert.equal(await uninvited.locator('#otp').inputValue(), '');
    assert.equal(await uninvited.locator('#otp').isDisabled(), true);
    assert.equal(await uninvited.locator('#password').evaluate((element) => element === document.activeElement), true);
    await capture(uninvited, 'back');
    pass(10, 'Back preserves email, clears both secrets and disables the hidden code field');
    const mobileEmail = 'mobile@example.com';
    await invite(mobileEmail);
    const mobile = await page(390);
    await openSignIn(mobile);
    await sent(mobile, mobileEmail);
    assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await mobile.locator('main').evaluate((element) => getComputedStyle(element).paddingLeft), '24px');
    await capture(mobile, 'mobile', 'mobile');
    const mobileOtp = await code(mobileEmail);
    await mobile.locator('#otp').fill(mobileOtp === '000000' ? '111111' : '000000');
    await mobile.locator('#email-code').getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await mobile.locator('#code-error').getByText('El código no es válido o ha vencido. Revisa el código o solicita otro.', { exact: true }).waitFor();
    const mobileError = await mobile.locator('#code-error').boundingBox();
    const mobileInput = await mobile.locator('#otp').boundingBox();
    assert(mobileError && mobileInput);
    assert(mobileError.x + mobileError.width <= mobileInput.x + mobileInput.width + 1);
    assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture(mobile, 'mobile-wrong-code', 'mobile-wrong-code');
    await writeFile(join(directory, 'mobile-error-bounds.json'), JSON.stringify({ error: mobileError, input: mobileInput }, null, 2));
    await redeem(mobile, mobileEmail);
    await mobile.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
    assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture(mobile, 'mobile-landed');
    pass(7, '390px code request and library arrival have no overflow and retain 24px auth gutters');
    const keyboardEmail = 'keyboard@example.com';
    await invite(keyboardEmail);
    const keyboard = await page();
    await openSignIn(keyboard);
    await keyboard.keyboard.press('Tab');
    assert.equal(await keyboard.locator('#email').evaluate((element) => element === document.activeElement), true);
    await keyboard.keyboard.type(keyboardEmail);
    await keyboard.keyboard.press('Tab');
    assert.equal(await keyboard.locator('#password').evaluate((element) => element === document.activeElement), true);
    await keyboard.keyboard.press('Tab');
    assert.equal(await keyboard.locator('#signin button').evaluate((element) => element === document.activeElement), true);
    await keyboard.keyboard.press('Tab');
    assert.equal(await keyboard.locator('#request-code').evaluate((element) => element === document.activeElement), true);
    assert.equal(await keyboard.locator('#request-code').evaluate((element) => getComputedStyle(element).outlineStyle), 'solid');
    await capture(keyboard, 'keyboard');
    await keyboard.keyboard.press('Enter');
    await keyboard.locator('#otp').waitFor({ state: 'visible' });
    assert.equal(await keyboard.locator('#otp').evaluate((element) => element === document.activeElement), true);
    await keyboard.keyboard.type(await code(keyboardEmail));
    await keyboard.keyboard.press('Enter');
    await keyboard.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
    pass(8, 'Keyboard-only Tab and Enter flow reaches the library with visible focus');
    const cliEmail = 'cli@example.com';
    await invite(cliEmail);
    const cliState = join(run, 'runtime/cli-state');
    const cliEnv = { PATH: process.env.PATH, ARTIFACTS_SERVER: instance.api, ARTIFACTS_STATE_DIR: cliState };
    const login = spawn('pnpm', ['artifacts', 'login', '--no-browser'], { env: cliEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(login);
    let stderr = '';
    login.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    const completed = new Promise<number | null>((done) => login.once('exit', done));
    let authorization: string | undefined;
    for (let attempt = 0; attempt < 200; attempt++) {
      authorization = stderr.split('\n').find((line) => line.startsWith(`${instance.auth}/api/auth/oauth2/authorize?`));
      if (authorization) break;
      assert.equal(login.exitCode, null, 'CLI waits for authorization');
      await delay(30);
    }
    assert(authorization, 'Actual CLI outputs its authorization URL');
    const cliPage = await page();
    const cliRecovery = await continuationFailure(cliPage);
    await cliPage.goto(authorization);
    await cliPage.getByLabel('Correo electrónico', { exact: true }).waitFor();
    cliRecovery.rememberQuery();
    await sent(cliPage, cliEmail);
    await redeem(cliPage, cliEmail);
    await cliRecovery.recover();
    await cliPage.getByRole('button', { name: 'Permitir acceso', exact: true }).waitFor();
    await capture(cliPage, 'cli-login');
    await cliPage.getByRole('button', { name: 'Permitir acceso', exact: true }).click();
    assert.equal(await completed, 0);
    const whoami = await execute('pnpm', ['--silent', 'artifacts', 'whoami'], { env: cliEnv });
    const identity = JSON.parse(whoami.stdout) as { userId: string };
    assert(identity.userId && identity.userId !== instance.ownerId);
    assert.equal((await cliPage.context().request.get(`${instance.auth}/api/auth/get-session`)).status(), 200);
    const session = await (await cliPage.context().request.get(`${instance.auth}/api/auth/get-session`)).json();
    assert.equal(identity.userId, session.user.id);
    assert.equal(session.user.email, cliEmail);
    await writeFile(join(directory, 'cli-whoami.json'), JSON.stringify({ status: 'PASS', userId: identity.userId, email: session.user.email }));
    await rm(cliState, { recursive: true, force: true });
    pass(4, 'Actual pnpm artifacts login and whoami return the invited guest after continuation-only recovery and consent');
    const limited = await page();
    await limited.goto(`${instance.auth}/sign-in`);
    await limited.locator('#email').fill('limit@example.com');
    await limited.getByRole('button', { name: 'Recibir código', exact: true }).click();
    await limited.getByText('Te enviamos un código', { exact: true }).waitFor();
    for (let attempt = 0; attempt < 2; attempt++) {
      const accepted = limited.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/send-verification-otp'));
      await limited.getByRole('button', { name: 'Recibir otro código', exact: true }).click();
      assert.equal((await accepted).status(), 200);
      await limited.getByRole('button', { name: 'Recibir otro código', exact: true }).waitFor({ state: 'visible' });
    }
    const rate = limited.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/send-verification-otp'));
    await limited.getByRole('button', { name: 'Recibir otro código', exact: true }).click();
    const denied = await rate;
    assert.equal(denied.status(), 429);
    assert(Number(denied.headers()['x-retry-after']) > 0);
    await limited.getByText('Has hecho demasiados intentos. Espera un momento y vuelve a intentarlo.', { exact: true }).waitFor();
    assert.equal(await limited.locator('#resend-code').isDisabled(), true);
    assert.equal(await limited.locator('#back-password').isEnabled(), true);
    await limited.locator('#back-password').click();
    assert.equal(await limited.locator('#email').inputValue(), 'limit@example.com');
    assert.equal(await limited.locator('#request-code').isDisabled(), true);
    await delay(300);
    assert.equal(await limited.locator('#request-code').isDisabled(), true);
    await capture(limited, 'limited');
    await limited.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#request-code')!.disabled, undefined, { timeout: 65_000 });
    const resumed = limited.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/send-verification-otp'));
    await limited.locator('#request-code').click();
    assert.equal((await resumed).status(), 200);
    pass(9, 'Actual fourth per-email request returns 429 with X-Retry-After; back remains available, early retry is blocked and retry succeeds after the real wait');
    const direct = await page();
    await direct.goto(`${instance.auth}/sign-in`);
    await sent(direct, 'owner@example.test');
    await redeem(direct, 'owner@example.test');
    await direct.waitForURL(`${instance.panel}/`);
    const directSession = await (await direct.context().request.get(`${instance.auth}/api/auth/get-session`)).json();
    assert.equal(directSession.user.id, instance.ownerId);
    pass('direct', 'Code sign-in with no OAuth query reaches the dashboard with the owner session');
    const metadata = await page();
    await metadata.goto(`${instance.auth}/sign-in`);
    let faults = 0;
    await metadata.route('**/api/auth/email-otp/send-verification-otp', async (route) => {
      faults++;
      await route.fulfill({ status: 429, headers: { 'X-Retry-After': 'invalid', 'Retry-After': faults === 1 ? '1' : new Date(Date.now() + 2500).toUTCString() }, contentType: 'text/plain', body: 'Controlled non-JSON response' });
    });
    await metadata.locator('#email').fill('metadata@example.com');
    for (let attempt = 0; attempt < 2; attempt++) {
      await metadata.locator('#request-code').click();
      await metadata.getByText('Has hecho demasiados intentos. Espera un momento y vuelve a intentarlo.', { exact: true }).waitFor();
      assert.equal(await metadata.locator('#request-code').isDisabled(), true);
      await metadata.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#request-code')!.disabled);
    }
    assert.equal(faults, 2);
    pass('retry-metadata-control', 'Labeled UI fault control preserves non-JSON429 metadata and honors numeric and HTTP-date Retry-After despite an invalid X-Retry-After');
    for (const explicit of [false, true]) {
      const disabled = await fixture();
      try {
        if (explicit) {
          const config = authConfig({ OWNER_EMAIL: 'owner@example.test', AUTH_URL: disabled.config.origin, BETTER_AUTH_SECRET: disabled.config.secret, MCP_URL: disabled.config.resource, DASHBOARD_URL: instance.panel });
          assert.equal(config.email?.transport, 'disabled');
          disabled.setAuthHandler(createAuthApp(disabled.db, config));
        }
        const disabledPage = await page();
        await disabledPage.goto(`${disabled.config.origin}/sign-in`);
        assert.equal(await disabledPage.getByRole('button', { name: 'Recibir código', exact: true }).count(), 0);
        assert.equal(await disabledPage.locator('#email-code, #otp').count(), 0);
      } finally { await disabled.close(); }
    }
    pass('disabled', 'Missing email config and actual authConfig disabled transport emit password-only HTML');
    const native = await browser.newContext({ javaScriptEnabled: false });
    contexts.push(native);
    const nativePage = await native.newPage();
    await nativePage.goto(`${instance.auth}/sign-in`);
    await nativePage.locator('#email').fill('native@example.com');
    await nativePage.locator('#password').fill('native-private-password');
    const nativeRequest = nativePage.waitForRequest((request) => request.method() === 'POST');
    await nativePage.locator('#signin button').click();
    const request = await nativeRequest;
    assert.equal(request.url(), `${instance.auth}/api/auth/sign-in/email`);
    assert(!nativePage.url().includes('native-private-password'));
    assert(request.postData()?.includes('native-private-password'));
    pass('native', 'Without JavaScript the password submits POST to the fixed endpoint without URL secrets');
    assert.deepEqual(errors, [], 'No browser page errors');
  }
  status = 'PASS';
} catch (error) {
  for (const [index, context] of contexts.entries()) for (const current of context.pages()) await capture(current, `failure-${index}`).catch(() => undefined);
  throw error;
} finally {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  for (const context of contexts) await context.close().catch(() => undefined);
  await browser?.close();
  await writeFile(join(directory, passwordOnly ? 'password-result.json' : 'result.json'), JSON.stringify({ status, browser: browser?.version(), records, errors, scope: 'Disposable local Node services, actual built panel, Chrome and CLI OAuth; no deployed email' }, null, 2));
  if (!providedRun) await control(['cleanup', '--run', run]);
}
console.log(JSON.stringify({ status, lanes: records.length, directory }));
