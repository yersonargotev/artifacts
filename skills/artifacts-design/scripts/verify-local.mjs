#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { delimiter, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const framePolicy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const previewPolicy = `${framePolicy}; frame-ancestors 'self'; sandbox allow-scripts`;
const variants = [375, 1280].flatMap((width) => ['light', 'dark'].map((theme) => ({ width, height: 900, theme })));
const fields = { text: ['text'], count: ['count'], visible: ['visible'], visibleCount: ['count'], attribute: ['name', 'value'], click: [], press: ['key'], fill: ['value'], check: ['checked'], select: ['values'] };
const hash = (value) => createHash('sha256').update(value).digest('hex');
const message = (error) => error instanceof Error ? error.message : String(error);
const escape = (value) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const compatible = (ua) => !/Edg|OPR|SamsungBrowser|CriOS|FxiOS/.test(ua) && Number(/(?:Headless)?Chrome\/(\d+)\./.exec(ua)?.[1]) >= 152;

function object(value, required, optional, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  assert(required.every((key) => Object.hasOwn(value, key)), `${label} has missing fields`);
  assert(Object.keys(value).every((key) => required.includes(key) || optional.includes(key)), `${label} has unknown fields`);
  return value;
}

function parseExpectations(value) {
  object(value, ['expectations'], ['timeoutMs'], 'expectations document');
  assert(Array.isArray(value.expectations) && value.expectations.length <= 100, 'expectations must contain at most 100 steps');
  const timeoutMs = value.timeoutMs ?? 3000;
  assert(Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 30000, 'timeoutMs must be an integer from 100 to 30000');
  for (const step of value.expectations) {
    assert(step && Object.hasOwn(fields, step.kind), 'Unknown expectation kind');
    object(step, ['kind', 'selector', ...fields[step.kind]], ['when'], 'expectation');
    assert(typeof step.selector === 'string' && step.selector.trim() && step.selector.length <= 8192, 'selector must be a nonempty string');
    if (step.when !== undefined) {
      object(step.when, [], ['width', 'theme'], 'when');
      if (step.when.width !== undefined) assert([375, 1280].includes(step.when.width), 'when.width must be 375 or 1280');
      if (step.when.theme !== undefined) assert(['light', 'dark'].includes(step.when.theme), 'when.theme must be light or dark');
    }
    for (const key of fields[step.kind]) {
      if (['count'].includes(key)) assert(Number.isInteger(step[key]) && step[key] >= 0, 'count must be a nonnegative integer');
      else if (['visible', 'checked'].includes(key)) assert(typeof step[key] === 'boolean', `${key} must be boolean`);
      else if (key === 'values') assert(Array.isArray(step.values) && step.values.length <= 100 && step.values.every((entry) => typeof entry === 'string'), 'values must be strings');
      else if (key === 'value' && step.kind === 'attribute') assert(step.value === null || typeof step.value === 'string', 'attribute value must be a string or null');
      else assert(typeof step[key] === 'string' && (!['key', 'name'].includes(key) || step[key].trim()), `${key} must be a string`);
    }
  }
  return { expectations: value.expectations, timeoutMs };
}

function invocation(args) {
  const options = {};
  let html;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      assert(['--evidence', '--expectations', '--browser'].includes(arg), `Unknown option ${arg}`);
      assert(!Object.hasOwn(options, arg) && args[index + 1] && !args[index + 1].startsWith('--'), `Supply ${arg} once with a value`);
      options[arg] = args[++index];
    } else { assert(!html, 'Supply one HTML file'); html = arg; }
  }
  assert(html && options['--evidence'], 'Usage: verify-local.mjs HTML --evidence DIRECTORY [--expectations JSON] [--browser EXECUTABLE]');
  return { html: resolve(html), evidence: resolve(options['--evidence']), expectations: options['--expectations'] && resolve(options['--expectations']), browser: options['--browser'] && resolve(options['--browser']) };
}

function playwright() {
  for (const base of [join(process.cwd(), 'package.json'), import.meta.url]) {
    const require = createRequire(base);
    for (const name of ['playwright', 'playwright-core']) {
      try { return require(name).chromium; }
      catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
    }
  }
  throw new Error('No Playwright runtime found. Provide an existing playwright or playwright-core package in the working directory project, then rerun. The helper does not install packages or browsers.');
}

async function cachedExecutables(chromium) {
  const expected = chromium.executablePath();
  const browserDirectory = /[\\/](?:chromium|chromium_headless_shell)-\d+[\\/]/.exec(expected);
  const roots = new Set([browserDirectory && expected.slice(0, browserDirectory.index), process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0' && resolve(process.env.PLAYWRIGHT_BROWSERS_PATH)].filter(Boolean));
  const executables = [];
  for (const root of roots) {
    let entries;
    try { entries = await readdir(root, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const entry of entries.filter((item) => item.isDirectory() && /^(?:chromium|chromium_headless_shell)-\d+$/.test(item.name)).sort((a, b) => b.name.localeCompare(a.name, 'en', { numeric: true })).slice(0, 50)) {
      const directory = join(root, entry.name);
      for (const relative of [
        'chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-linux/headless_shell', 'chrome-headless-shell-linux64/chrome-headless-shell',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell',
        'chrome-win/chrome.exe', 'chrome-win64/chrome.exe', 'chrome-headless-shell-win64/chrome-headless-shell.exe',
      ]) {
        const candidate = join(directory, relative);
        try { await access(candidate, constants.X_OK); executables.push(candidate); } catch {}
      }
    }
  }
  return executables;
}

async function chooseBrowser(chromium, explicit, diagnostics) {
  const candidates = explicit ? [explicit] : [
    chromium.executablePath(), ...await cachedExecutables(chromium),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    ...['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'].filter((key) => process.env[key]).flatMap((key) => [join(process.env[key], 'Google/Chrome/Application/chrome.exe'), join(process.env[key], 'Chromium/Application/chrome.exe')]),
    ...(process.env.PATH ?? '').split(delimiter).flatMap((directory) => ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome'].map((name) => join(directory, name))),
  ];
  for (const candidate of new Set(candidates)) {
    let browser;
    try {
      await access(candidate, constants.X_OK);
      const executable = await realpath(candidate);
      const { stdout, stderr } = await execute(executable, ['--version'], { timeout: 5000, maxBuffer: 65536 });
      const version = `${stdout} ${stderr}`.trim();
      assert(/Chrom(?:e|ium)/i.test(version) && Number(/(\d+)\./.exec(version)?.[1]) >= 152, `Incompatible version ${version}. Chrome or Chromium 152+ is required`);
      browser = await chromium.launch({ executablePath: executable, headless: true, chromiumSandbox: true, timeout: 15000 });
      const page = await browser.newPage();
      const userAgent = await page.evaluate(() => navigator.userAgent);
      assert(compatible(userAgent), `Unsupported launched user agent ${userAgent}`);
      await page.close();
      return { browser, identity: { executable, selectedPath: candidate, version: browser.version(), probeVersion: version, userAgent } };
    } catch (error) {
      await browser?.close();
      diagnostics.push({ executable: candidate, reason: message(error) });
    }
  }
  throw new Error('No compatible browser could launch. Use --browser /absolute/path/to/an/existing/Chrome-or-Chromium-152+ executable. Check browserDiagnostics in report.json. No software was installed and browser sandboxing was not disabled.');
}

async function poll(read, expected, timeout) {
  const deadline = Date.now() + timeout;
  let actual;
  do {
    actual = await read();
    try { assert.deepEqual(actual, expected); return; } catch {}
    await new Promise((done) => setTimeout(done, 50));
  } while (Date.now() < deadline);
  assert.deepEqual(actual, expected);
}

async function expectation(frame, step, timeout) {
  const locator = frame.locator(step.selector);
  const actions = {
    click: () => locator.click(), press: () => locator.press(step.key), fill: () => locator.fill(step.value),
    check: () => locator.setChecked(step.checked), select: () => locator.selectOption(step.values),
  };
  if (Object.hasOwn(actions, step.kind)) { await actions[step.kind](); return; }
  if (step.kind === 'count') return poll(() => locator.count(), step.count, timeout);
  if (step.kind === 'visibleCount') return poll(async () => {
    const items = await locator.all();
    const visible = await Promise.all(items.map((item) => item.isVisible()));
    return visible.filter(Boolean).length;
  }, step.count, timeout);
  if (step.kind === 'visible') return poll(async () => {
    const count = await locator.count();
    return { count, visible: count === 1 ? await locator.isVisible() : null };
  }, { count: 1, visible: step.visible }, timeout);
  if (step.kind === 'text') return poll(() => locator.innerText(), step.text, timeout);
  return poll(() => locator.getAttribute(step.name), step.value, timeout);
}

async function dimensions(frame) {
  return frame.evaluate(() => ({ viewportWidth: innerWidth, documentWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0), documentHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0), viewportHeight: innerHeight }));
}

async function capture(page, frame, result, directory, phase) {
  const size = await dimensions(frame);
  const maximum = Math.max(0, size.documentHeight - size.viewportHeight);
  const offsets = [0];
  while (offsets.at(-1) < maximum && offsets.length < 12) offsets.push(Math.min(maximum, offsets.at(-1) + size.viewportHeight));
  const actualOffsets = [];
  for (const offset of offsets) {
    const actual = await frame.evaluate((top) => { scrollTo({ top, left: 0, behavior: 'instant' }); return scrollY; }, offset);
    actualOffsets.push(actual);
    await page.waitForTimeout(50);
    const path = `${result.variant.width}-${result.variant.theme}-${phase}-${offset}.png`;
    await page.screenshot({ path: join(directory, path), timeout: 5000 });
    result.screenshots.push({ path, phase, scrollY: actual, width: result.variant.width, height: result.variant.height });
  }
  const finalSize = await dimensions(frame);
  const capturedThrough = Math.min(finalSize.documentHeight, Math.max(...actualOffsets) + size.viewportHeight);
  const reachedOffsets = actualOffsets.every((actual, index) => Math.abs(actual - offsets[index]) <= 1);
  result.captureCoverage.push({ phase, documentHeight: finalSize.documentHeight, capturedThrough, truncated: !reachedOffsets || capturedThrough < finalSize.documentHeight });
  await frame.evaluate(() => scrollTo({ top: 0, left: 0, behavior: 'instant' }));
}

async function runVariant(browser, origin, config, variant, directory) {
  const deadline = { timeoutMs: Math.min(60000, Math.max(10000, config.timeoutMs * (config.expectations.length + 1))), exceeded: false };
  const result = { variant, status: 'passed', deadline, checks: [], screenshots: [], captureCoverage: [], consoleErrors: [], runtimeErrors: [], externalAttempts: [], errors: [] };
  const context = await browser.newContext({ viewport: { width: variant.width, height: variant.height }, colorScheme: variant.theme, serviceWorkers: 'block' });
  context.setDefaultTimeout(config.timeoutMs);
  let closing;
  const close = () => closing ??= context.close().catch((error) => { result.errors.push(`Browser context cleanup failed. ${message(error)}`); });
  const watchdog = setTimeout(() => {
    deadline.exceeded = true;
    result.errors.push(`Variant deadline exceeded after ${deadline.timeoutMs} ms. Remaining checks, CSP observations, and captures are incomplete.`);
    void close();
  }, deadline.timeoutMs);
  let frame;
  const overflow = async (phase) => {
    const size = await dimensions(frame);
    const passed = size.documentWidth <= size.viewportWidth + 1;
    result.checks.push({ kind: 'overflow', phase, status: passed ? 'passed' : 'failed', ...size });
  };
  try {
    const page = await context.newPage();
    page.on('console', (entry) => { if (entry.type() === 'error') result.consoleErrors.push(entry.text()); });
    page.on('pageerror', (error) => result.runtimeErrors.push(message(error)));
    await context.route('**/*', async (route) => {
      const request = route.request();
      if ([`${origin}/`, `${origin}/content`].includes(request.url()) && request.method() === 'GET' && request.resourceType() === 'document') await route.continue();
      else { result.externalAttempts.push({ source: 'request', url: request.url(), resourceType: request.resourceType() }); await route.abort('blockedbyclient'); }
    });
    await context.addInitScript(() => {
      globalThis.__artifactsLocalViolations = [];
      addEventListener('securitypolicyviolation', (event) => globalThis.__artifactsLocalViolations.push({ source: 'csp', url: event.blockedURI, directive: event.effectiveDirective }));
    });
    const responsePromise = page.waitForResponse((response) => response.url() === `${origin}/content`);
    const [, response] = await Promise.all([page.goto(`${origin}/`, { waitUntil: 'load', timeout: 10000 }), responsePromise]);
    const headers = response.headers();
    result.sandbox = { csp: headers['content-security-policy'], connectionAllowlist: headers['connection-allowlist'], dnsPrefetchControl: headers['x-dns-prefetch-control'], iframeSandbox: await page.locator('iframe').getAttribute('sandbox'), contentSha256: hash(await response.body()) };
    assert.equal(result.sandbox.csp, previewPolicy);
    assert.equal(result.sandbox.connectionAllowlist, '()');
    assert.equal(result.sandbox.dnsPrefetchControl, 'off');
    assert.equal(result.sandbox.iframeSandbox, 'allow-scripts');
    frame = page.frames().find((item) => item.url() === `${origin}/content`);
    assert(frame, 'The local sandboxed content frame must load');
    await frame.evaluate(async (timeout) => {
      await Promise.race([document.fonts.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Fonts readiness timed out')), timeout))]);
    }, config.timeoutMs);
    await page.waitForTimeout(200);
    await overflow('initial');
    await capture(page, frame, result, directory, 'initial');
    for (const [index, step] of config.expectations.entries()) {
      if (step.when && ((step.when.width !== undefined && step.when.width !== variant.width) || (step.when.theme !== undefined && step.when.theme !== variant.theme))) continue;
      try {
        await expectation(frame, step, config.timeoutMs);
        result.checks.push({ kind: step.kind, step: index, status: 'passed' });
      } catch (error) { result.checks.push({ kind: step.kind, step: index, status: 'failed', message: message(error) }); break; }
    }
    assert.equal(page.url(), `${origin}/`, 'The document must not navigate the wrapper');
    assert.equal(frame.url(), `${origin}/content`, 'The document must not replace its content frame');
    await page.waitForTimeout(200);
    await overflow('final');
    await capture(page, frame, result, directory, 'final');
  } catch (error) { result.errors.push(message(error)); }
  finally {
    if (!deadline.exceeded && frame && !frame.isDetached()) {
      try { result.externalAttempts.push(...await frame.evaluate(() => globalThis.__artifactsLocalViolations ?? [])); }
      catch (error) { result.errors.push(`CSP evidence unavailable. ${message(error)}`); }
    }
    await close();
    clearTimeout(watchdog);
  }
  if (result.checks.some((item) => item.status === 'failed') || result.errors.length || result.consoleErrors.length || result.runtimeErrors.length || result.externalAttempts.length) result.status = 'failed';
  return result;
}

async function main() {
  const report = {
    schemaVersion: 1, evidenceKind: 'renderizado local', authenticatedPublication: 'not-verified', status: 'blocked',
    visualReview: { status: 'required', checks: ['Content fidelity and reading order', 'Composition, alignment, legibility, and focus visibility at both widths and themes', 'Inspect screenshot tiles and any truncated capture coverage'] },
    input: null, browser: null, browserDiagnostics: [],
    sandbox: { csp: previewPolicy, iframeSandbox: 'allow-scripts', connectionAllowlist: '()', dnsPrefetchControl: 'off', referrerPolicy: 'no-referrer', chromiumSandbox: true },
    observation: 'Each fresh variant waits for load and fonts, observes 200 ms before and after its scenario, and captures bounded viewport tiles. Delayed behavior beyond this run requires additional review.',
    variants: [], errors: [],
  };
  let directory;
  let server;
  let browser;
  let config;
  try {
    config = invocation(process.argv.slice(2));
    for (const input of [config.html, config.expectations].filter(Boolean)) assert(config.evidence !== input && !config.evidence.startsWith(`${input}${sep}`), 'Evidence destination must not overwrite an input file');
    await mkdir(config.evidence, { recursive: true });
    directory = await mkdtemp(join(config.evidence, 'local-'));
    report.evidenceDirectory = directory;
    const bytes = await readFile(config.html);
    report.input = { path: await realpath(config.html), sha256: hash(bytes), bytes: bytes.length };
    const checks = config.expectations ? parseExpectations(JSON.parse(await readFile(config.expectations, 'utf8'))) : { expectations: [], timeoutMs: 3000 };
    const content = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escape(framePolicy)}"><meta name="referrer" content="no-referrer"></head><body>${bytes.toString('utf8')}</body></html>`;
    report.sandbox.contentSha256 = hash(content);
    const chosen = await chooseBrowser(playwright(), config.browser, report.browserDiagnostics);
    browser = chosen.browser;
    report.browser = chosen.identity;
    server = createServer((request, response) => {
      if (request.method !== 'GET' || !['/', '/content'].includes(request.url)) { response.writeHead(404).end(); return; }
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');
      response.setHeader('referrer-policy', 'no-referrer');
      response.setHeader('x-dns-prefetch-control', 'off');
      if (request.url === '/content') response.setHeader('connection-allowlist', '()');
      response.setHeader('content-security-policy', request.url === '/content' ? previewPolicy : "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; base-uri 'none'; form-action 'none'");
      response.end(request.url === '/content' ? content : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%}</style><iframe title="Local artifact" sandbox="allow-scripts" referrerpolicy="no-referrer" src="/content"></iframe>');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const variant of variants) report.variants.push(await runVariant(browser, origin, checks, variant, directory));
    report.status = report.variants.every((item) => item.status === 'passed') ? 'passed' : 'failed';
  } catch (error) { report.errors.push(message(error)); }
  finally {
    try { await browser?.close(); } catch (error) { report.errors.push(`Browser cleanup failed. ${message(error)}`); }
    if (server) {
      try { await new Promise((done, reject) => server.close((error) => error ? reject(error) : done())); }
      catch (error) { report.errors.push(`Local server cleanup failed. ${message(error)}`); }
    }
    if (report.errors.length && report.status === 'passed') report.status = 'failed';
    if (report.input) {
      try {
        report.input.sha256After = hash(await readFile(config.html));
        assert.equal(report.input.sha256After, report.input.sha256, 'Input HTML changed during verification');
      } catch (error) { report.status = 'failed'; report.errors.push(message(error)); }
    }
    if (directory) {
      await writeFile(join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
      const links = report.variants.flatMap((item) => item.screenshots.map((capture) => `- [${capture.path}](${capture.path}). Frame scroll offset ${capture.scrollY} px.`));
      await writeFile(join(directory, 'index.md'), `# Local rendering evidence\n\nEvidence kind is renderizado local. Authenticated publication is not verified.\n\nAutomatic checks ${report.status}. Visual review remains required.\n\n${links.join('\n')}\n`);
    }
    console.log(JSON.stringify(report));
    process.exitCode = report.status === 'passed' ? 0 : report.status === 'failed' ? 1 : 2;
  }
}

await main();
