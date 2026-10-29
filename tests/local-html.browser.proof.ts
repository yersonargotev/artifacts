import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { previewDocument, previewPolicy, supportsInteractiveHtml } from '../apps/publication/src/document.ts';

const helper = resolve('skills/artifacts-design/scripts/verify-local.mjs');
const directory = resolve('.test-artifacts/local-html-proof');
await mkdir(directory, { recursive: true });

async function run(name: string, source: string, expectations: object[] = [], environment: NodeJS.ProcessEnv = {}, timeoutMs = 300, trackProcesses = false) {
  const html = join(directory, `${name}.html`);
  const checks = join(directory, `${name}.json`);
  await writeFile(html, source);
  await writeFile(checks, JSON.stringify({ expectations, timeoutMs }));
  const child = spawn(process.execPath, [helper, html, '--evidence', join(directory, name), '--expectations', checks], {
    cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: process.env.HOME, ...environment }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  const processes = () => execFileSync('ps', ['-axo', 'pid=,ppid=,lstart='], { encoding: 'utf8' }).trim().split('\n').map((line) => {
    const [, pid, parent, started] = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line)!;
    return { pid: Number(pid), parent: Number(parent), started };
  });
  const owned = new Map<number, string>();
  const observe = () => {
    const snapshot = processes();
    const descendants = new Set([child.pid]);
    for (let previous = -1; previous !== descendants.size;) {
      previous = descendants.size;
      for (const item of snapshot) if (descendants.has(item.parent)) { descendants.add(item.pid); owned.set(item.pid, item.started); }
    }
  };
  const observer = trackProcesses && process.platform !== 'win32' ? setInterval(observe, 100) : undefined;
  let code;
  try {
    [code] = await once(child, 'close');
    if (observer) {
      clearInterval(observer);
      const remaining = processes().filter((item) => owned.get(item.pid) === item.started);
      assert(owned.size > 0, 'Process observation includes the owned browser and its renderers');
      assert.deepEqual(remaining, [], 'The helper closes its actual browser and renderer processes without external termination');
    }
  } finally {
    clearInterval(observer);
    if (observer) for (const item of processes()) if (owned.get(item.pid) === item.started) {
      try { process.kill(item.pid, 'SIGKILL'); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
    }
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  assert.notEqual(code, null, stderr);
  const report = JSON.parse(stdout);
  assert.equal(await readFile(html, 'utf8'), source, 'The source HTML is never rewritten');
  assert.equal(report.input.sha256After, report.input.sha256);
  assert.deepEqual(report.variants.map((item: { variant: object }) => item.variant), [
    { width: 375, height: 900, theme: 'light' }, { width: 375, height: 900, theme: 'dark' },
    { width: 1280, height: 900, theme: 'light' }, { width: 1280, height: 900, theme: 'dark' },
  ]);
  return { code, report };
}

const source = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#fff;color:#111}.mobile{display:none}@media(max-width:700px){.mobile{display:block}.desktop{display:none}}@media(prefers-color-scheme:dark){body{background:#111;color:#fff}}</style></head><body><h1>Local interaction proof</h1><p class="mobile">Mobile map</p><p class="desktop">Desktop map</p><button id="change">Change total</button><output id="total">5.00</output><label>Name<input id="name" oninput="document.querySelector('#name-output').textContent=this.value"></label><output id="name-output"></output><label>Choice<select id="choice" onchange="document.querySelector('#choice-output').setAttribute('data-choice',this.value)"><option value="a">A</option><option value="b">B</option></select></label><output id="choice-output"></output><label><input id="toggle" type="checkbox" onchange="document.querySelector('#toggle-output').textContent=this.checked?'checked':'unchecked'">Toggle</label><output id="toggle-output">unchecked</output><p id="storage"></p><script>document.body.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';try{localStorage.getItem('proof');document.querySelector('#storage').textContent='available'}catch{document.querySelector('#storage').textContent='blocked'}document.querySelector('#change').onclick=()=>{const total=document.querySelector('#total');total.textContent=total.textContent==='5.00'?'28.40':'5.00'}</script></body></html>`;
const positive = await run('success', source, [
  { kind: 'visibleCount', selector: '.mobile,.desktop', count: 1 },
  { kind: 'visible', selector: '.mobile', visible: true, when: { width: 375 } },
  { kind: 'visible', selector: '.desktop', visible: false, when: { width: 375 } },
  { kind: 'visible', selector: '.desktop', visible: true, when: { width: 1280 } },
  { kind: 'visible', selector: '.mobile', visible: false, when: { width: 1280 } },
  { kind: 'attribute', selector: 'body', name: 'data-theme', value: 'light', when: { theme: 'light' } },
  { kind: 'attribute', selector: 'body', name: 'data-theme', value: 'dark', when: { theme: 'dark' } },
  { kind: 'text', selector: '#storage', text: 'blocked' },
  { kind: 'count', selector: 'button', count: 1 },
  { kind: 'text', selector: '#total', text: '5.00' },
  { kind: 'click', selector: '#change' },
  { kind: 'text', selector: '#total', text: '28.40' },
  { kind: 'press', selector: '#change', key: 'Enter' },
  { kind: 'text', selector: '#total', text: '5.00' },
  { kind: 'fill', selector: '#name', value: 'Alice' },
  { kind: 'text', selector: '#name-output', text: 'Alice' },
  { kind: 'select', selector: '#choice', values: ['b'] },
  { kind: 'attribute', selector: '#choice-output', name: 'data-choice', value: 'b' },
  { kind: 'check', selector: '#toggle', checked: true },
  { kind: 'text', selector: '#toggle-output', text: 'checked' },
]);
assert.equal(positive.code, 0, JSON.stringify(positive.report));
assert.equal(positive.report.status, 'passed');
assert.equal(positive.report.evidenceKind, 'renderizado local');
assert.equal(positive.report.authenticatedPublication, 'not-verified');
assert.equal(positive.report.visualReview.status, 'required');
assert.equal(supportsInteractiveHtml(positive.report.browser.userAgent), true);
assert.equal(positive.report.sandbox.chromiumSandbox, true);
const wrapped = previewDocument({ revision: { snapshot: { content: { kind: 'html', text: source } } } }, true);
const contentHash = createHash('sha256').update(wrapped).digest('hex');
assert.equal(positive.report.sandbox.contentSha256, contentHash, 'Local wrapping matches the actual preview');
for (const item of positive.report.variants) {
  assert.equal(item.status, 'passed');
  assert.equal(item.sandbox.csp, previewPolicy, 'Actual browser response has the production CSP');
  assert.equal(item.sandbox.connectionAllowlist, '()');
  assert.equal(item.sandbox.dnsPrefetchControl, 'off');
  assert.equal(item.sandbox.iframeSandbox, 'allow-scripts');
  assert.equal(item.sandbox.contentSha256, contentHash);
  assert.equal(item.externalAttempts.length, 0);
}

const delayedVisibility = await run('delayed-visibility', '<button id="reveal">Reveal result</button><script>document.querySelector("#reveal").onclick=()=>setTimeout(()=>{const result=document.createElement("p");result.id="result";result.textContent="Ready";document.body.append(result)},200)</script>', [
  { kind: 'click', selector: '#reveal' },
  { kind: 'visible', selector: '#result', visible: true },
  { kind: 'text', selector: '#result', text: 'Ready' },
], {}, 1000);
assert.equal(delayedVisibility.code, 0, JSON.stringify(delayedVisibility.report));

const unresponsive = await run('unresponsive-renderer', '<button id="spin" onclick="for(;;){}">Spin forever</button><script>if(innerWidth===375&&!matchMedia("(prefers-color-scheme: dark)").matches)for(;;){}</script>', [{ kind: 'click', selector: '#spin' }], {}, 300, true);
assert.equal(unresponsive.code, 1, JSON.stringify(unresponsive.report));
assert.equal(unresponsive.report.status, 'failed');
for (const item of unresponsive.report.variants) {
  assert.equal(item.status, 'failed');
  assert.equal(item.deadline.exceeded, true);
  assert(item.errors.some((error: string) => error.includes('Variant deadline exceeded')));
  assert(item.errors.some((error: string) => error.includes('incomplete')));
}
assert.equal(unresponsive.report.variants[0].checks.length, 0, 'The watchdog also closes a renderer that spins before initial load finishes');
assert(unresponsive.report.variants.slice(1).every((item: { checks: { kind: string; status: string }[] }) => item.checks.some((check) => check.kind === 'click' && check.status === 'failed')), 'The remaining variants exercise a click-triggered loop');

for (const [name, markup, visible] of [
  ['missing-visible', '<h1>No result</h1>', true],
  ['missing-hidden', '<h1>No result</h1>', false],
  ['ambiguous-visible', '<p class="result">One</p><p class="result">Two</p>', true],
] as const) {
  const invalidVisibility = await run(name, markup, [{ kind: 'visible', selector: '.result', visible }]);
  assert.equal(invalidVisibility.code, 1);
  assert(invalidVisibility.report.variants.every((item: { checks: { kind: string; status: string }[] }) => item.checks.some((check) => check.kind === 'visible' && check.status === 'failed')), 'Visibility requires exactly one matching element');
}

if (process.platform !== 'win32') {
  const cache = await mkdtemp(join(directory, 'isolated-browser-cache-'));
  const layout = process.platform === 'darwin' ? `chrome-headless-shell-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}` : 'chrome-headless-shell-linux64';
  const executableDirectory = join(cache, 'chromium_headless_shell-9999', layout);
  await mkdir(executableDirectory, { recursive: true });
  const shell = join(executableDirectory, 'chrome-headless-shell');
  await symlink(positive.report.browser.executable, shell);
  const cached = await run('cached-browser-fallback', '<h1>Existing cached browser</h1>', [], { PLAYWRIGHT_BROWSERS_PATH: cache });
  assert.equal(cached.code, 0, JSON.stringify(cached.report));
  assert.equal(cached.report.browser.selectedPath, shell, 'A compatible cached headless shell is used when the managed full executable is absent');
}

const responsive = await run('responsive-regression', source.replace('.mobile{display:none}', '.mobile{display:block}').replace('.desktop{display:none}', '.desktop{display:block}'), [
  { kind: 'visibleCount', selector: '.mobile,.desktop', count: 1 },
]);
assert.equal(responsive.code, 1);
assert(responsive.report.variants.every((item: { checks: { kind: string; status: string }[] }) => item.checks.some((check) => check.kind === 'visibleCount' && check.status === 'failed')), 'Two responsive variants visible together must fail');

const errors = await run('runtime-console-overflow', '<style>body{width:1600px}</style><h1>Failure proof</h1><script>console.error("console proof");setTimeout(()=>{throw new Error("runtime proof")},0)</script>');
assert.equal(errors.code, 1);
for (const item of errors.report.variants) {
  assert(item.consoleErrors.some((entry: string) => entry.includes('console proof')));
  assert(item.runtimeErrors.some((entry: string) => entry.includes('runtime proof')));
  assert(item.checks.some((check: { kind: string; status: string }) => check.kind === 'overflow' && check.status === 'failed'));
}

let received = 0;
const collector = createServer((_request, response) => { received++; response.end('collector'); });
collector.listen(0, '127.0.0.1');
await once(collector, 'listening');
const address = collector.address();
assert(address && typeof address === 'object');
const external = `http://127.0.0.1:${address.port}`;
try {
  await fetch(`${external}/active-control`);
  assert.equal(received, 1);
  const network = await run('external-resources', `<style>@font-face{font-family:Remote;src:url('${external}/font.woff2')}body{font-family:Remote}</style><h1>Network failure proof</h1><img src="${external}/image.png"><script>fetch('${external}/fetch').catch(()=>{})</script>`);
  assert.equal(network.code, 1);
  assert.equal(received, 1, 'Sandboxed document sends no requests to the active collector');
  for (const item of network.report.variants) {
    const directives = item.externalAttempts.filter((entry: { source: string }) => entry.source === 'csp').map((entry: { directive: string }) => entry.directive);
    assert(directives.includes('connect-src'), 'CSP-blocked fetch is recorded even without a request event');
    assert(directives.includes('img-src'), 'CSP-blocked image is recorded');
    assert(directives.includes('font-src'), 'CSP-blocked font is recorded');
  }
} finally { await new Promise<void>((done) => collector.close(() => done())); }

const tall = await run('long-document', '<style>body{margin:0}.top{height:1100px;background:white}.bottom{height:1100px;background:rgb(12,123,45)}</style><div class="top"><h1>Top of long document</h1></div><div class="bottom"><h2>Below-fold content</h2></div>');
assert.equal(tall.code, 0, JSON.stringify(tall.report));
const browser = await chromium.launch({ executablePath: tall.report.browser.executable, chromiumSandbox: true });
try {
  const page = await browser.newPage();
  for (const item of tall.report.variants) {
    const tile = item.screenshots.find((entry: { phase: string; scrollY: number }) => entry.phase === 'initial' && entry.scrollY >= 1100);
    assert(tile, 'Long document includes a below-fold tile');
    const image = await readFile(join(tall.report.evidenceDirectory, tile.path));
    const pixel = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return [...context.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data];
    }, image.toString('base64'));
    assert.deepEqual(pixel, [12, 123, 45, 255], 'Below-fold screenshot contains painted content rather than a white capture');
    assert(item.captureCoverage.every((coverage: { truncated: boolean }) => !coverage.truncated));
  }
} finally { await browser.close(); }
console.log(`Local HTML proof passed. Evidence is ${directory}.`);
