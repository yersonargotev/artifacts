import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { chromium, type FrameLocator, type Page } from 'playwright';
import { inertPreviewPolicy, previewDocument, previewPolicy, supportsInteractiveHtml } from '../apps/publication/src/document.ts';
import { snapshotSchema, type Snapshot } from '../packages/contracts/src/index.ts';

type Board = { path: string; x: number; y: number; w: number; h: number; title?: string; page?: string; script: string };
type Report = { name: string; ran: boolean; origin: string; viewport: string; parent: string; popup: string; fetch: string; violations: string[] };

const collector = createSocket('udp4');
let packets = 0;
collector.on('message', () => { packets++; });
collector.bind(0, '127.0.0.1');
await once(collector, 'listening');
const peer = `(async () => {
  await window.peerCheckpoint('started');
  const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:${collector.address().port}' }] });
  peer.createDataChannel('canvas-proof');
  await peer.setLocalDescription(await peer.createOffer());
  await window.peerCheckpoint('described');
  setTimeout(() => peer.close(), 1500);
})();`;
const probe = (name: string) => `const report = { name: ${JSON.stringify(name)}, ran: true, origin: self.origin, viewport: innerWidth + 'x' + innerHeight, violations: [] };
addEventListener('securitypolicyviolation', (event) => report.violations.push(event.effectiveDirective));
try { report.parent = String(parent.document.title); } catch (error) { report.parent = error.name; }
try { report.popup = window.open('/beacon') === null ? 'blocked' : 'opened'; } catch (error) { report.popup = error.name; }
parent.postMessage({ type: 'zoom', scale: 9 }, '*');
fetch('/beacon').then(() => 'allowed', () => 'blocked').then((result) => {
  report.fetch = result;
  return new Promise((done) => setTimeout(done, 200));
}).then(() => {
  const output = document.createElement('output');
  output.id = 'report';
  output.textContent = JSON.stringify(report);
  document.body.append(output);
});`;
const thief = `addEventListener('keydown', (event) => { document.getElementById('keys').textContent += event.key; });
setInterval(() => { document.querySelector('input').focus(); parent.postMessage({ type: 'zoom', scale: 9 }, '*'); }, 50);`;

function design(boards: Board[], extra: object = {}): Pick<Snapshot, 'content' | 'files'> {
  return snapshotSchema.parse({
    metadata: { title: 'Canvas containment proof', description: 'Disposable browser fixture' },
    content: { kind: 'design', text: JSON.stringify({ v: 1, boards: Object.fromEntries(boards.map(({ path, script: _, ...board }) => [path, board])), order: boards.map(({ path }) => path), ...extra }) },
    files: boards.map(({ path, script }) => ({ path, mediaType: 'text/html', encoding: 'utf8', data: `<!doctype html><html lang="es"><meta charset="utf-8"><title>${path}</title><body style="margin:0;font:32px system-ui"><h1 title="&quot;quoted&quot;">${path} "</iframe></h1><input aria-label="Campo"><output id="keys"></output><script>${script}</script></body></html>` })),
  });
}
const boards: Board[] = [
  { path: 'boards/Home.html', x: 0, y: 0, w: 1440, h: 900, title: 'Inicio', page: 'desktop', script: probe('boards/Home.html') },
  { path: 'boards/Detail.html', x: 1520, y: 0, w: 1440, h: 900, page: 'desktop', script: probe('boards/Detail.html') },
  { path: 'boards/Phone.html', x: 0, y: 0, w: 390, h: 844, title: 'Móvil', page: 'phone', script: probe('boards/Phone.html') },
];
const canvases = {
  '/content': design(boards, { pages: [{ id: 'desktop', name: 'Escritorio' }, { id: 'phone', name: 'Teléfono' }], notes: { review: { x: 0, y: 980, text: 'Nota <b>sin</b> HTML' } } }),
  '/webrtc-content': design([{ path: 'boards/Peer.html', x: 0, y: 0, w: 400, h: 300, script: peer }]),
  '/theft-content': design([{ path: 'boards/Thief.html', x: 0, y: 0, w: 400, h: 300, script: thief }, { path: 'boards/Victim.html', x: 480, y: 0, w: 400, h: 300, script: '' }]),
};

let beacons = 0;
const server = serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === '/beacon') {
    beacons++;
    return new Response('reached');
  }
  if (!path.endsWith('content')) return new Response(`<!doctype html><style>body{margin:0}iframe{display:block;width:1200px;height:760px;border:0}${path === '/precision' ? 'iframe{position:absolute;left:323px;top:152.796875px;width:690px;height:700px}' : ''}</style><iframe title="Vista previa" sandbox="allow-scripts" src="${path}-content"></iframe>`, { headers: { 'content-type': 'text/html', 'content-security-policy': "frame-src 'self'" } });
  const interactive = path !== '/inert-content';
  const snapshot = canvases[path === '/control-content' ? '/webrtc-content' : path === '/webrtc-content' || path === '/theft-content' ? path : '/content'];
  const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': interactive ? previewPolicy : inertPreviewPolicy, 'cross-origin-opener-policy': 'same-origin' };
  if (path !== '/control-content') headers['connection-allowlist'] = '()';
  return new Response(previewDocument({ revision: { snapshot } }, interactive), { headers });
} });
await once(server, 'listening');
const address = server.address();
assert(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`;

const reports = async (page: Page) => Promise.all(page.frames().filter((frame) => frame.url() === 'about:srcdoc').map(async (frame) => {
  await frame.locator('#report').waitFor({ state: 'attached' });
  return JSON.parse(await frame.locator('#report').textContent() ?? '') as Report;
}));
const transform = (content: FrameLocator) => content.locator('.world').evaluate((world) => getComputedStyle(world).transform);
const box = async (content: FrameLocator, selector: string) => {
  const found = await content.locator(selector).boundingBox();
  assert(found, `${selector} has a layout box`);
  return found;
};

const browser = await chromium.launch({ channel: 'chrome' });
const observations: Record<string, unknown> = { browser: browser.version() };
try {
  for (const path of ['/control', '/webrtc']) {
    const page = await browser.newPage();
    const observation: { phase: 'not-started' | 'started' | 'described'; crashed: boolean; packets: number } = { phase: 'not-started', crashed: false, packets: 0 };
    const errors: string[] = [];
    let startedAt = 0;
    let signalStart: () => void = () => {};
    const started = new Promise<void>((resolve) => { signalStart = resolve; });
    page.on('crash', () => { observation.crashed = true; });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.exposeFunction('peerCheckpoint', (phase: unknown) => {
      assert(phase === 'started' && observation.phase === 'not-started' || phase === 'described' && observation.phase === 'started', 'Peer checkpoints occur in order');
      observation.phase = phase;
      if (phase === 'started') {
        startedAt = Date.now();
        signalStart();
      }
    });
    packets = 0;
    await page.goto(`${origin}${path}`).catch((error: Error) => { if (!observation.crashed) throw error; });
    await Promise.race([started, new Promise<void>((resolve) => setTimeout(resolve, 2500))]);
    assert.notEqual(observation.phase, 'not-started', 'The board reached the WebRTC construction checkpoint');
    await new Promise((done) => setTimeout(done, Math.max(0, 2500 - (Date.now() - startedAt))));
    observation.packets = packets;
    assert.deepEqual(errors, [], 'The WebRTC board has no script errors');
    if (path === '/control') {
      assert.equal(observation.crashed, false, 'The control renderer stays alive');
      assert.equal(observation.phase, 'described', 'The control sets a local WebRTC description');
      assert(observation.packets > 0, 'The nested control proves the UDP collector and WebRTC are active');
    } else {
      assert.equal(observation.packets, 0, 'A board that opens a WebRTC connection sends no packets');
      if (!observation.crashed) assert.equal(observation.phase, 'described', 'The protected board sets a local WebRTC description when its renderer stays alive');
    }
    observations[path] = observation;
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && message.location().url !== 'about:srcdoc') errors.push(`${message.location().url}: ${message.text()}`); });
  beacons = 0;
  await page.goto(`${origin}/panel`);
  assert(supportsInteractiveHtml(await page.evaluate(() => navigator.userAgent)), 'This proof requires Chrome 152 or newer');
  const content = page.frameLocator('iframe');
  const boardReports = await reports(page);
  assert.equal(boardReports.length, boards.length, 'Every board renders as its own srcdoc frame, including boards on hidden pages');
  for (const report of boardReports) {
    assert.equal(report.ran, true, `${report.name} script runs`);
    assert.equal(report.origin, 'null', `${report.name} has an opaque origin`);
    const declared = boards.find(({ path }) => path === report.name)!;
    assert.equal(report.viewport, `${declared.w}x${declared.h}`, `${report.name} loads at its declared size, even on a hidden page`);
    assert.equal(report.parent, 'SecurityError', `${report.name} cannot read parent.document`);
    assert.equal(report.fetch, 'blocked', `${report.name} fetch is blocked`);
    assert(report.violations.includes('connect-src'), `${report.name} fetch violates connect-src 'none'`);
    assert.equal(report.popup, 'blocked', `${report.name} cannot open a popup`);
  }
  assert.equal(page.context().pages().length, 1, 'No popup page opened');
  assert.equal(beacons, 0, 'No board request reached the server');
  observations.boards = boardReports;

  const zoomControls = content.getByRole('group', { name: 'Zoom del lienzo', exact: true });
  for (const name of ['Acercar', 'Alejar', 'Ajustar a la vista']) assert.equal(await zoomControls.getByRole('button', { name, exact: true }).count(), 1, `${name} has its accessible name in the zoom group`);
  const fittedView = await transform(content);
  await zoomControls.getByRole('button', { name: 'Alejar', exact: true }).click();
  const smaller = await box(content, 'iframe[title="Inicio"]');
  await zoomControls.getByRole('button', { name: 'Ajustar a la vista', exact: true }).click();
  const initial = await box(content, 'iframe[title="Inicio"]');
  assert(smaller.width < initial.width, 'Alejar decreases the board scale');
  assert.equal(await transform(content), fittedView, 'Ajustar restores the fitted view after zooming out');
  const viewport = await box(content, '.canvas');
  for (const title of ['Inicio', 'boards/Detail.html']) {
    const frame = await box(content, `iframe[title="${title}"]`);
    assert(frame.x >= viewport.x && frame.y >= viewport.y && frame.x + frame.width <= viewport.x + viewport.width && frame.y + frame.height <= viewport.y + viewport.height, `${title} is fitted inside the viewport`);
  }
  assert(await content.getByRole('button', { name: 'Abrir boards/Detail.html a tamaño real' }).isVisible(), 'A board without a title is labeled with its path');
  assert(!await content.getByRole('button', { name: 'Abrir Móvil a tamaño real' }).isVisible(), 'Boards on another page are hidden');
  assert.equal(await content.locator('.note').textContent(), 'Nota <b>sin</b> HTML', 'Note text renders as text');
  const start = await box(content, 'iframe[title="Inicio"]');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 - 120, start.y + start.height / 2 + 40, { steps: 4 });
  await page.mouse.up();
  const panned = await box(content, 'iframe[title="Inicio"]');
  assert(Math.abs(panned.x - (start.x - 120)) < 1 && Math.abs(panned.y - (start.y + 40)) < 1, 'Drag pans the canvas');
  const corner = { x: panned.x + panned.width, y: panned.y + panned.height };
  const level = await content.locator('.zoom-level').textContent() ?? '';
  await page.mouse.move(corner.x, corner.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -40);
  await page.keyboard.up('Control');
  await content.locator('.zoom-level').filter({ hasNotText: level }).waitFor();
  const zoomed = await box(content, 'iframe[title="Inicio"]');
  const drift = Math.hypot(zoomed.x + zoomed.width - corner.x, zoomed.y + zoomed.height - corner.y);
  assert(zoomed.width > panned.width, 'Ctrl and wheel zooms in');
  assert(drift <= 2, `The corner under the cursor stays within 2 px, drift ${drift}`);
  observations.zoomAnchorDrift = drift;
  await zoomControls.getByRole('button', { name: 'Ajustar a la vista', exact: true }).click();
  assert.equal(await transform(content), fittedView, 'Ajustar restores the fitted view after drag and wheel zoom');

  const open = content.getByRole('button', { name: 'Abrir Inicio a tamaño real' });
  const back = content.getByRole('button', { name: 'Volver al lienzo' });
  const label = await box(content, '.board-name >> nth=0');
  const middle = await box(content, 'iframe[title="Inicio"]');
  await page.mouse.move(middle.x + middle.width / 2, middle.y + middle.height / 2);
  await page.mouse.down();
  await page.mouse.move(middle.x + middle.width / 2 + 420 - label.x, middle.y + middle.height / 2 + 24 - label.y, { steps: 4 });
  await page.mouse.up();
  const nearEdge = await transform(content);
  await open.click();
  await back.waitFor();
  await page.keyboard.press('Escape');
  await content.locator('.zoom').waitFor();
  assert.equal(await transform(content), nearEdge, 'Escape after a mouse open restores the view even when the board name sits under the controls row');

  await open.focus();
  const before = await transform(content);
  await open.press('Enter');
  await back.waitFor();
  assert.equal(await back.evaluate((button) => button === document.activeElement), true, 'Focus moves to Volver al lienzo');
  const native = await box(content, 'iframe[title="Inicio"]');
  assert.deepEqual([native.width, native.height], [1440, 900], 'Focus view shows the board at its declared size');
  await content.frameLocator('iframe[title="Inicio"]').getByRole('textbox', { name: 'Campo' }).click();
  await page.keyboard.press('Escape');
  assert.equal(await content.locator('body[data-focus]').count(), 1, 'Escape typed inside the focused board belongs to the board');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await back.evaluate((button) => button === document.activeElement), true, 'Shift+Tab leads from the board back to Volver al lienzo');
  await page.keyboard.press('Escape');
  await content.locator('.zoom').waitFor();
  assert.equal(await transform(content), before, 'Escape restores the prior transform');
  assert.equal(await open.evaluate((button) => button === document.activeElement), true, 'Focus returns to the board name');

  await content.getByRole('button', { name: 'Página Teléfono' }).click();
  assert(await content.getByRole('button', { name: 'Abrir Móvil a tamaño real' }).isVisible(), 'The selected page shows its boards');
  assert(!await content.getByRole('button', { name: 'Abrir Inicio a tamaño real' }).isVisible(), 'The selected page hides other boards');
  assert(!await content.locator('.note').isVisible(), 'A note without a page belongs to the first page');
  assert.equal(await content.getByRole('button', { name: 'Página Teléfono' }).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(errors, [], 'The canvas host logs no errors');
  await page.close();

  const precision = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await precision.goto(`${origin}/precision`);
  const preciseContent = precision.frameLocator('iframe');
  const frameBox = await precision.locator('iframe').boundingBox();
  assert(frameBox);
  for (const [name, pivot] of [['Without a pointer sample', { x: 400, y: 350 }], ['With a mismatched pointer sample', { x: 420, y: 370 }]] as const) {
    if (name !== 'Without a pointer sample') await precision.mouse.move(frameBox.x + 180.5, frameBox.y + 350.5);
    const before = await box(preciseContent, 'iframe[title="boards/Detail.html"]');
    await preciseContent.locator('.canvas').dispatchEvent('wheel', { clientX: pivot.x, clientY: pivot.y, deltaY: -40, ctrlKey: true });
    const after = await box(preciseContent, 'iframe[title="boards/Detail.html"]');
    const ratio = after.width / before.width;
    const expected = { x: frameBox.x + pivot.x + (before.x - frameBox.x - pivot.x) * ratio, y: frameBox.y + pivot.y + (before.y - frameBox.y - pivot.y) * ratio };
    assert(after.width > before.width, `${name}, wheel zoom increases scale`);
    assert(Math.hypot(after.x - expected.x, after.y - expected.y) <= 0.1, `${name}, zoom uses the wheel pivot`);
  }
  await preciseContent.getByRole('button', { name: 'Ajustar a la vista', exact: true }).click();
  const anchorBefore = await box(preciseContent, 'iframe[title="boards/Detail.html"]');
  await precision.mouse.move(anchorBefore.x, anchorBefore.y);
  await precision.keyboard.down('Control');
  for (let step = 0; step < 6; step++) {
    await precision.mouse.wheel(0, -100);
    await precision.waitForTimeout(40);
  }
  await precision.keyboard.up('Control');
  const anchorAfter = await box(preciseContent, 'iframe[title="boards/Detail.html"]');
  const repeatedDrift = Math.hypot(anchorAfter.x - anchorBefore.x, anchorAfter.y - anchorBefore.y);
  assert(anchorAfter.width > anchorBefore.width, 'Repeated ctrl-wheel zoom increases the board scale at DPR 2');
  assert(repeatedDrift <= 2, `Six ctrl-wheel notches preserve a fractional iframe anchor within 2 px at DPR 2, drift ${repeatedDrift}`);
  observations.repeatedZoomAnchorDrift = repeatedDrift;
  await precision.close();

  const inert = await browser.newPage();
  await inert.goto(`${origin}/inert`);
  const listing = inert.frameLocator('iframe');
  await listing.locator('pre').first().waitFor();
  assert.equal(await listing.locator('iframe').count(), 0, 'The inert listing has no board frames');
  assert.equal(await listing.locator('pre').count(), boards.length + 1, 'The inert listing shows every board source and the note');
  assert.match(await listing.locator('pre').first().innerText(), /<script>/, 'Board source is shown as text');
  await inert.close();

  const theft = await browser.newPage({ viewport: { width: 1200, height: 760 } });
  await theft.goto(`${origin}/theft`);
  const host = theft.frameLocator('iframe');
  await host.locator('.controls button:focus').waitFor();
  const initialZoom = await host.locator('.zoom-level').textContent() ?? '';
  await theft.keyboard.press('Enter');
  await host.locator('.zoom-level').filter({ hasNotText: initialZoom }).waitFor();
  const zoomIn = host.getByRole('button', { name: 'Acercar' });
  await zoomIn.focus();
  const untouched = await transform(host);
  await theft.waitForTimeout(300);
  assert.equal(await zoomIn.evaluate((button) => button === document.activeElement), true, 'An inert board that keeps calling focus() cannot take focus from a canvas control');
  assert.equal(await transform(host), untouched, 'Board messages to the parent do not change the canvas');
  const zoomLevel = await host.locator('.zoom-level').textContent() ?? '';
  await theft.keyboard.press('Enter');
  await host.locator('.zoom-level').filter({ hasNotText: zoomLevel }).waitFor();
  await host.getByRole('button', { name: 'Abrir boards/Victim.html a tamaño real' }).click();
  await theft.waitForTimeout(300);
  await theft.keyboard.press('Escape');
  await host.locator('.zoom').waitFor();
  assert.equal(await host.frameLocator('iframe[title="boards/Thief.html"]').locator('#keys').textContent(), '', 'No keystroke reached the focus-stealing board');
  await theft.close();

  await mkdir('.test-artifacts', { recursive: true });
  await writeFile('.test-artifacts/design-canvas.json', JSON.stringify(observations, null, 2));
  console.log('Design canvas proof passed: boards run scripts in opaque srcdoc frames under the unchanged preview policy without fetch, popups, parent access, WebRTC packets; focus recovery, pan, zoom, focus, pages, and the inert listing work.');
} finally {
  await browser.close();
  await new Promise<void>((done) => server.close(() => done()));
  collector.close();
}
