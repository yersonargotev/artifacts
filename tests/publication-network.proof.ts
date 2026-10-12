import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { chromium } from 'playwright';
import { documentPolicy, inertPreviewPolicy, previewDocument, previewPolicy, publicationDocument, supportsInteractiveHtml } from '../apps/publication/src/document.ts';
import type { ArtifactRead } from '../packages/artifacts/src/contracts.ts';

const collector = createSocket('udp4');
let packets = 0;
collector.on('message', () => { packets++; });
collector.bind(0, '127.0.0.1');
await once(collector, 'listening');
const port = collector.address().port;
const artifact: ArtifactRead = {
  artifactId: 'network-proof', ownerId: 'disposable-owner', headRevisionId: 'revision-one',
  publication: { revisionId: 'revision-one', version: 1, url: 'https://publication.example.test/a/network-proof' },
  revision: { id: 'revision-one', parentRevisionId: null, sequence: 1, authorUserId: 'disposable-owner', authorClientId: 'disposable-client', createdAt: '2026-01-01T00:00:00Z', sha256: 'a'.repeat(64), snapshot: {
    metadata: { title: 'Network containment proof', description: 'Disposable browser fixture' }, files: [],
    content: { kind: 'html', text: `<h1>Interactive document</h1><button onclick="this.textContent='Interaction works'">Try interaction</button><p id="ready">pending</p><script>
      document.getElementById('ready').textContent = 'executed';
      (async () => {
        let peer;
        try {
          peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:${port}' }] });
          peer.createDataChannel('disposable-proof');
          await peer.setLocalDescription(await peer.createOffer());
        } catch {}
        setTimeout(() => peer?.close(), 1500);
      })();
    </script>` },
  } },
};
const server = serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === '/file') return new Response('download works', { headers: { 'content-disposition': 'attachment; filename="proof.txt"' } });
  if (path === '/panel') return new Response('<!doctype html><iframe title="Preview" sandbox="allow-scripts" src="/preview"></iframe>', { headers: { 'content-type': 'text/html', 'content-security-policy': "frame-src 'self'" } });
  const interactive = path !== '/fallback';
  const wrapper = path === '/publication' || path === '/fallback';
  const snapshot = wrapper ? { ...artifact, revision: { ...artifact.revision, snapshot: { ...artifact.revision.snapshot, files: [{ path: 'proof.txt', mediaType: 'text/plain', encoding: 'utf8' as const, data: 'download works' }] } } } : artifact;
  const headers: Record<string, string> = { 'content-type': 'text/html', 'content-security-policy': wrapper ? documentPolicy : interactive ? previewPolicy : inertPreviewPolicy };
  if (path !== '/control') headers['connection-allowlist'] = '()';
  return new Response(wrapper ? publicationDocument(snapshot, () => '/file', interactive) : previewDocument(snapshot, interactive), { headers });
} });
await once(server, 'listening');
const address = server.address();
assert(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ channel: 'chrome' });
const observations: object[] = [];
try {
  for (const path of ['/control', '/publication', '/panel', '/fallback']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    packets = 0;
    await page.goto(`${origin}${path}`);
    assert(supportsInteractiveHtml(await page.evaluate(() => navigator.userAgent)), 'This interactive proof requires Chrome 152 or newer');
    const document = path === '/control' ? page : page.frameLocator('iframe');
    if (path !== '/fallback') {
      await document.locator('#ready').filter({ hasText: 'executed' }).waitFor();
      await document.getByRole('button', { name: 'Try interaction', exact: true }).click();
      await document.getByRole('button', { name: 'Interaction works', exact: true }).waitFor();
    } else {
      assert.equal(await document.locator('script').count(), 0);
      assert.equal(await document.getByRole('button').count(), 0);
      assert.match(await document.locator('body').innerText(), /<script>/);
      assert.equal(await page.locator('iframe').getAttribute('sandbox'), '');
    }
    await page.waitForTimeout(2200);
    if (path === '/control') assert(packets > 0, 'Unrestricted control proves the UDP collector and browser API are active');
    else assert.equal(packets, 0, `${path} sends no UDP packets`);
    observations.push({ path, packets, javascriptInteractive: path !== '/fallback' });
    if (path === '/publication') {
      await page.locator('summary').filter({ hasText: /^Archivos \(/ }).click();
      const event = page.waitForEvent('download');
      await page.getByRole('link', { name: 'proof.txt', exact: true }).click();
      const download = await event;
      assert.equal(await download.failure(), null);
      const stream = await download.createReadStream();
      assert(stream);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      assert.equal(Buffer.concat(chunks).toString(), 'download works');
    }
    await context.close();
  }
  await mkdir('.test-artifacts', { recursive: true });
  await writeFile('.test-artifacts/publication-network.json', JSON.stringify({ browser: browser.version(), observations }, null, 2));
  console.log('Browser network proof passed: active UDP control, no WebRTC traffic from either protected surface, working interaction/download, inert fallback.');
} finally {
  await browser.close();
  await new Promise<void>((done) => server.close(() => done()));
  collector.close();
}
