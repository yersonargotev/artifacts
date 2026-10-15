import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { chromium, type Browser } from 'playwright';
import { unzipSync, zipSync } from 'fflate';
import type { ArtifactRead } from '../packages/artifacts/src/contracts.ts';
import { escapeHtml, previewDocument, previewPolicy, documentPolicy, publicationDocument } from '../apps/publication/src/document.ts';
import { expectedRetainedArchive, verifyRetainedArtifact, type RetainedVerificationConfig } from '../.agents/skills/verify-artifacts/scripts/retained.ts';

const snapshot = { metadata: { title: 'Retained cost document', description: 'Exact complete snapshot', custom: { retained: true } }, content: { kind: 'html' as const, text: '<h1>Retained revision</h1><button id="change">Change cost</button><output id="total">5.00</output><script>document.querySelector("#change").onclick=()=>document.querySelector("#total").textContent="28.40"</script>' }, files: [{ path: 'nested/bytes.bin', mediaType: 'application/octet-stream', encoding: 'base64' as const, data: 'AAH/' }] };
const canonical = JSON.stringify(snapshot, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
const saved: ArtifactRead = { artifactId: 'artifact-retained', ownerId: 'owner-retained', headRevisionId: 'revision-two', publication: { revisionId: 'revision-one', version: 3, url: 'http://localhost/a/artifact-retained' }, revision: { id: 'revision-one', parentRevisionId: null, sequence: 1, authorUserId: 'owner-retained', authorClientId: 'mcp-retained', createdAt: '2026-10-11T12:00:00.000Z', sha256: createHash('sha256').update(canonical).digest('hex'), snapshot } };

function config(directory: string, origin = 'http://localhost'): RetainedVerificationConfig {
  return { expected: { ...saved, publication: { ...saved.publication!, url: `${origin}/a/artifact-retained` } }, panelUrl: `${origin}/artifacts/artifact-retained?revisionId=revision-one`, publicationUrl: `${origin}/a/artifact-retained`, viewports: [{ width: 1280, height: 900 }, { width: 390, height: 844 }], expectations: [{ kind: 'text', selector: '#total', text: '5.00' }, { kind: 'click', selector: '#change' }, { kind: 'text', selector: '#total', text: '28.40' }], evidenceDirectory: directory };
}

type Failure = 'none' | 'partial' | 'publication-partial' | 'wrong-marker' | 'sequence' | 'srcdoc' | 'content-binding' | 'content-bytes' | 'content-policy' | 'content-network' | 'preview-url' | 'archive' | 'attachment-bytes' | 'attachment-binding' | 'publication-moved' | 'console' | 'page' | 'overflow' | 'frame-overflow';
let browser: Browser;
let directory: string;
before(async () => { directory = await mkdtemp(join(tmpdir(), 'retained-contract-')); browser = await chromium.launch({ channel: 'chrome' }); });
after(async () => { await browser?.close(); await rm(directory, { recursive: true, force: true }); });

async function run(mode: 'markers' | 'legacy', failure: Failure, falseExpectation = false, transport: 'response' | 'srcdoc' = 'response') {
  let expected: ArtifactRead;
  let panelReads = 0;
  const requests: { method: string; path: string }[] = [];
  const markers = () => failure === 'partial' ? ' data-artifact-id="artifact-retained"' : mode === 'markers' ? ` data-artifact-id="artifact-retained" data-revision-id="${failure === 'wrong-marker' ? 'revision-two' : 'revision-one'}" data-revision-sha256="${expected.revision.sha256}" data-publication-version="3"` : '';
  const server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    requests.push({ method: request.method!, path: url.pathname });
    response.setHeader('cache-control', 'private, no-store');
    if (url.pathname.endsWith('/preview')) {
      assert.equal(request.headers['sec-fetch-dest'], 'iframe', 'Contract fixture only admits actual iframe requests');
      response.setHeader('content-security-policy', previewPolicy);
      response.setHeader('connection-allowlist', '()');
      response.setHeader('x-dns-prefetch-control', 'off');
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(previewDocument(expected, true));
    } else if (url.pathname.endsWith('/export')) {
      response.setHeader('content-type', 'application/zip');
      response.setHeader('content-disposition', 'attachment; filename="artifact-retained-revision-one.zip"');
      const bytes = expectedRetainedArchive(expected);
      if (failure === 'archive') {
        const members = unzipSync(bytes);
        members['content.html'] = Buffer.from('Wrong retained bytes');
        response.end(zipSync(members));
      } else response.end(bytes);
    } else if (url.pathname.startsWith('/artifacts/')) {
      panelReads++;
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.setHeader('content-security-policy', "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'; frame-src 'self'");
      const version = failure === 'publication-moved' && panelReads > 3 ? 4 : 3;
      response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}iframe{width:100%;height:430px}dd{overflow-wrap:anywhere}</style><main${markers().replace('data-publication-version="3"', `data-publication-version="${version}"`)}><section class="publication"><p>Versión ${version}.</p><a href="${expected.publication!.url}">Abrir publicación</a></section><section><h2>Revisión 1</h2><span class="badge">Publicada</span><a href="/artifacts/artifact-retained/export?revisionId=revision-one">Descargar revisión 1</a><iframe class="preview" sandbox="allow-scripts" referrerpolicy="no-referrer" src="/artifacts/artifact-retained/preview?revisionId=${failure === 'preview-url' ? 'revision-two' : 'revision-one'}"></iframe><dl><dt>Revisión</dt><dd>revision-one</dd><dt>SHA-256</dt><dd>${expected.revision.sha256}</dd></dl></section></main>`);
    } else if (url.pathname.includes('/files/')) {
      response.setHeader('content-type', 'application/octet-stream');
      response.setHeader('content-disposition', 'attachment; filename="bytes.bin"');
      response.setHeader('x-content-type-options', 'nosniff');
      response.setHeader('content-security-policy', "default-src 'none'; sandbox");
      response.end(Buffer.from(failure === 'attachment-bytes' ? [0, 1, 254] : [0, 1, 255]));
    } else if (url.pathname.endsWith('/content')) {
      assert.equal(request.headers['sec-fetch-dest'], 'iframe', 'Publication contract must load an actual iframe response');
      response.setHeader('content-security-policy', failure === 'content-policy' ? previewPolicy.replace("connect-src 'none'", "connect-src 'self'") : previewPolicy);
      if (failure !== 'content-network') response.setHeader('connection-allowlist', '()');
      response.setHeader('x-dns-prefetch-control', 'off');
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(previewDocument(failure === 'content-bytes' ? { ...expected, revision: { ...expected.revision, snapshot: { ...expected.revision.snapshot, content: { kind: 'html', text: '<h1>Wrong revision bytes</h1>' } } } } : expected, true));
    } else if (url.pathname.startsWith('/a/')) {
      response.setHeader('content-security-policy', transport === 'srcdoc' ? documentPolicy.replace("script-src 'none'", "script-src 'unsafe-inline'") : documentPolicy);
      if (transport === 'srcdoc') response.setHeader('connection-allowlist', '()');
      response.setHeader('x-dns-prefetch-control', 'off');
      response.setHeader('content-type', 'text/html; charset=utf-8');
      let html = publicationDocument(expected, { library: 'https://panel.example.test/', content: `/a/artifact-retained/r/${failure === 'content-binding' ? 'revision-two' : 'revision-one'}/content`, attachment: (path) => `/a/artifact-retained/r/${failure === 'attachment-binding' ? 'revision-two' : 'revision-one'}/files/${path}` }, true).replace(/<main\b[^>]*>/, `<main${failure === 'publication-partial' ? ' data-artifact-id="artifact-retained"' : markers()}>`);
      if (transport === 'srcdoc') html = html.replace(/src="[^"]*"/, `srcdoc="${escapeHtml(previewDocument(expected, true))}"`);
      if (failure === 'sequence') {
        assert(html.includes('Revisión 1</span>'), 'Sequence corruption must target the actual rendered revision');
        html = html.replace('Revisión 1</span>', 'Revisión 2</span>');
        assert(html.includes('Revisión 2</span>'), 'Sequence corruption must change the actual rendered revision');
      }
      if (failure === 'srcdoc') html = html.replace(escapeHtml(snapshot.content.text), escapeHtml('<h1>Wrong revision bytes</h1>'));
      if (failure === 'overflow') html = html.replace('<main', '<div style="width:2000px">Overflow</div><main');
      response.end(html);
    } else { response.setHeader('content-type', 'image/x-icon'); response.end(); }
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  const input = config(join(directory, `${mode}-${failure}-${falseExpectation}-${transport}`), `http://127.0.0.1:${address.port}`);
  expected = input.expected;
  if (['console', 'page', 'frame-overflow'].includes(failure)) {
    expected = structuredClone(expected);
    expected.revision.snapshot.content.text += failure === 'frame-overflow' ? '<div style="width:2000px">Content overflow</div>' : `<script>document.querySelector("#change").addEventListener("click",()=>{${failure === 'console' ? 'console.error("Retained content error")' : 'throw new Error("Retained page error")'}})</script>`;
    const canonical = JSON.stringify(expected.revision.snapshot, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
    expected.revision.sha256 = createHash('sha256').update(canonical).digest('hex');
    input.expected = expected;
  }
  if (falseExpectation) input.expectations = [{ kind: 'text', selector: '#total', text: '999.00' }];
  const context = await browser.newContext();
  try {
    const sentinel = await context.newPage();
    const report = await verifyRetainedArtifact(context, input);
    assert.equal(sentinel.isClosed(), false, 'Verifier preserves caller-owned pages');
    assert.deepEqual(requests.filter((request) => request.method !== 'GET'), [], 'Contract verification must not issue mutation requests');
    assert.equal((JSON.parse(await readFile(join(input.evidenceDirectory, 'result.json'), 'utf8')) as { status: string }).status, report.status);
    return report;
  } finally {
    await context.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
}

for (const mode of ['markers', 'legacy'] as const) test(`browser verifier accepts ${mode} evidence and resets interaction at both viewport sizes`, async () => {
  const report = await run(mode, 'none');
  assert.equal(report.status, 'passed', JSON.stringify(report.errors));
  assert.equal(report.publication, 'verified');
  assert.deepEqual(report.viewports, [{ width: 1280, height: 900, panel: mode, publication: mode }, { width: 390, height: 844, panel: mode, publication: mode }]);
  assert.deepEqual(report.attachments, [{ path: 'nested/bytes.bin', bytes: 3, sha256: '26a66b061e8f48f39927c312f25293959729eee95978e2892d49d3512a5cc092' }]);
});

test('browser verifier accepts exact legacy srcdoc transport with its original network policy', async () => {
  const report = await run('legacy', 'none', false, 'srcdoc');
  assert.equal(report.status, 'passed', JSON.stringify(report.errors));
  assert.equal(report.publication, 'verified');
});

test('browser verifier rejects corrupted legacy srcdoc bytes', async () => {
  const report = await run('legacy', 'srcdoc', false, 'srcdoc');
  assert.equal(report.status, 'failed');
  assert.match(report.errors.at(-1)!.message, /srcdoc bytes differ/);
});

for (const [mode, failure, message] of [
  ['markers', 'partial', /partial, malformed or mismatched/],
  ['markers', 'wrong-marker', /partial, malformed or mismatched/],
  ['legacy', 'publication-partial', /partial, malformed or mismatched/],
  ['legacy', 'sequence', /sequence differs/],
  ['legacy', 'content-binding', /frame must pin the exact retained revision/],
  ['legacy', 'content-bytes', /content bytes differ/],
  ['legacy', 'content-policy', /content CSP differs/],
  ['legacy', 'content-network', /content connection policy differs/],
  ['legacy', 'preview-url', /preview URL must pin/],
  ['legacy', 'archive', /ZIP bytes differ/],
  ['legacy', 'attachment-bytes', /Attachment bytes differ/],
  ['legacy', 'attachment-binding', /bind the exact artifact/],
  ['legacy', 'publication-moved', /publication version differs/],
  ['legacy', 'overflow', /Wrapper overflows/],
  ['legacy', 'frame-overflow', /Content frame overflows/],
] as const) test(`browser verifier rejects ${mode} ${failure}`, async () => {
  const report = await run(mode, failure);
  assert.equal(report.status, 'failed');
  assert.match(report.errors.at(-1)!.message, message);
});

test('browser verifier rejects false content expectations', async () => {
  const report = await run('legacy', 'none', true);
  assert.equal(report.status, 'failed');
  assert.match(report.errors.at(-1)!.message, /Content text expectation failed/);
});

for (const kind of ['console', 'page'] as const) test(`browser verifier records and fails content ${kind} errors`, async () => {
  const report = await run('legacy', kind);
  assert.equal(report.status, 'failed');
  assert(report.errors.some((error) => error.kind === kind && error.message.includes(kind === 'console' ? 'Retained content error' : 'Retained page error')));
  assert.match(report.errors.at(-1)!.message, /Browser emitted console\/page errors/);
});
