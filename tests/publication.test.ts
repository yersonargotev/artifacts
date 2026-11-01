import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { canvasDocument } from '../apps/publication/src/canvas.ts';
import { previewDocument } from '../apps/publication/src/document.ts';
import { createPublicationApp } from '../apps/publication/src/http.ts';
import { escapeHtml } from '../apps/publication/src/markup.ts';
import { snapshotSchema, type ArtifactRead } from '../packages/artifacts/src/contracts.ts';
import { localReturnPath } from '../apps/dashboard/src/identity.ts';
import { publicationServiceAuthorized } from '../apps/dashboard/src/publication.ts';

const publish = 'https://publication.example.test';
const dashboard = 'https://panel.example.test';
const artifact: ArtifactRead = {
  artifactId: 'artifact-a', ownerId: 'owner-a', headRevisionId: 'revision-1', project: null, publication: { revisionId: 'revision-1', version: 1, url: `${publish}/a/artifact-a` },
  revision: { id: 'revision-1', parentRevisionId: null, sequence: 1, authorUserId: 'owner-a', authorClientId: 'client-a', createdAt: '2026-01-01T00:00:00Z', sha256: 'a'.repeat(64), snapshot: { metadata: { title: 'Protected document', description: 'A retained document' }, content: { kind: 'html', text: '<h1>Protected bytes</h1><script>window.secret = 1</script>' }, files: [{ path: 'nested/file.html', mediaType: 'text/html', encoding: 'base64', data: 'AAH/PGgxPkF0dGFjaG1lbnQ8L2gxPg==' }] } },
};

const hostileBoard = '<!doctype html><h1 title="a&quot;b">Board "quoted" </iframe><script>parent.document.title = 1</script></h1>';
const design = snapshotSchema.parse({
  metadata: { title: 'Design canvas', description: 'Three boards on two pages' },
  content: { kind: 'design', text: JSON.stringify({
    v: 1,
    pages: [{ id: 'web', name: 'Web' }, { id: 'phone', name: 'Teléfono <b>' }],
    boards: { 'boards/Home.html': { x: 0, y: 0, w: 1440, h: 900, title: 'Inicio <script>' }, 'boards/Menu.html': { x: 1520, y: 0, w: 1440, h: 900, page: 'web' }, 'boards/Phone.html': { x: 0, y: 0, w: 390, h: 844, page: 'phone' } },
    order: ['boards/Home.html', 'boards/Menu.html', 'boards/Phone.html'],
    notes: { review: { x: 0, y: 980, text: '<img src=x onerror=alert(1)> & "quoted"\nsecond line' }, phone: { x: 470, y: 0, w: 360, text: 'Phone note', page: 'phone' } },
  }) },
  files: [
    { path: 'boards/Home.html', mediaType: 'text/html', encoding: 'utf8', data: hostileBoard },
    { path: 'boards/Menu.html', mediaType: 'text/html', encoding: 'utf8', data: '<p>Menu</p>' },
    { path: 'boards/Phone.html', mediaType: 'text/html', encoding: 'utf8', data: '<p>Phone</p>' },
    { path: 'boards/Unindexed.html', mediaType: 'text/html', encoding: 'utf8', data: '<p>Not on the canvas</p>' },
  ],
});

function environment() {
  return { DASHBOARD_URL: dashboard, PUBLISH_URL: publish, PUBLICATION_SERVICE_SECRET: randomBytes(32).toString('hex'), PUBLICATION_COOKIE_SECRET: randomBytes(32).toString('hex') };
}

function cookieHeader(response: Response) {
  return response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
}

async function authorize(handler: ReturnType<typeof createPublicationApp>) {
  const begin = await handler(new Request(`${publish}/a/artifact-a`));
  assert.equal(begin.status, 303);
  const target = new URL(begin.headers.get('location')!);
  assert.equal(target.origin, dashboard);
  assert.equal(target.pathname, '/publication/open');
  assert.equal(target.searchParams.get('artifactId'), 'artifact-a');
  const callback = new URL('/callback', publish);
  callback.search = new URLSearchParams({ artifactId: 'artifact-a', state: target.searchParams.get('state')!, code: 'a'.repeat(43) }).toString();
  const request = new Request(callback, { headers: { cookie: cookieHeader(begin) } });
  return { begin, request, admitted: await handler(request) };
}

test('publication navigation follows current project membership and encodes project names', async () => {
  let project: string | null = null;
  const backend: typeof fetch = async (input) => String(input).endsWith('/consume')
    ? Response.json({ artifactId: 'artifact-a', userId: 'owner-a', sessionId: 'session-a', expiresAt: Date.now() + 60_000 })
    : Response.json({ ...artifact, project });
  const handler = createPublicationApp(environment(), backend);
  const { admitted } = await authorize(handler);
  const cookie = cookieHeader(admitted);
  const read = async () => {
    const response = await handler(new Request(`${publish}/a/artifact-a`, { headers: { cookie, referer: 'https://attacker.example/', 'x-forwarded-host': 'attacker.example' } }));
    assert.equal(response.status, 200);
    return response.text();
  };
  assert.doesNotMatch(await read(), /<nav class="project-navigation"/);
  project = 'Diseño & "QA" + 50%/β';
  const filed = await read();
  assert(filed.includes('href="https://panel.example.test/?project=Dise%C3%B1o+%26+%22QA%22+%2B+50%25%2F%CE%B2"'));
  assert(filed.includes('aria-label="Volver al proyecto Diseño &amp; &quot;QA&quot; + 50%/β"'));
  assert(filed.includes('<span>Diseño &amp; &quot;QA&quot; + 50%/β</span>'));
  assert(filed.includes('href="https://panel.example.test/" rel="noreferrer" aria-label="Volver a la biblioteca"'));
  project = 'Next project';
  const moved = await read();
  assert(moved.includes('href="https://panel.example.test/?project=Next+project"'));
  assert(!moved.includes('Dise%C3%B1o'));
  project = null;
  assert.doesNotMatch(await read(), /<nav class="project-navigation"/);
});

test('encrypted publication handoff binds state and artifact, clears the callback, and serves revision-bound downloads', async () => {
  const config = environment();
  const calls: string[] = [];
  let consumed = false;
  const backend: typeof fetch = async (input, init) => {
    assert.equal(init?.redirect, 'manual');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${config.PUBLICATION_SERVICE_SECRET}`);
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/consume')) {
      if (consumed) return new Response(null, { status: 403 });
      consumed = true;
      return Response.json({ artifactId: 'artifact-a', userId: 'owner-a', sessionId: 'session-a', expiresAt: Date.now() + 60_000 });
    }
    const parameters = JSON.parse(String(init?.body)) as { viewer: { artifactId: string }; revisionId?: string };
    assert.equal(parameters.viewer.artifactId, 'artifact-a');
    if (parameters.revisionId && parameters.revisionId !== 'revision-1') return new Response(null, { status: 404 });
    return Response.json(artifact);
  };
  const handler = createPublicationApp(config, backend);
  const flow = await authorize(handler);
  assert.equal(flow.admitted.status, 303);
  assert.equal(flow.admitted.headers.get('location'), `${publish}/a/artifact-a`);
  const transactionCookie = flow.begin.headers.get('set-cookie')!;
  assert(transactionCookie.includes('Secure; HttpOnly; SameSite=Lax'));
  assert(!transactionCookie.includes('Domain='));
  assert(!transactionCookie.includes('artifact-a'));
  assert(flow.admitted.headers.getSetCookie().some((value) => value.includes('Max-Age=0')));
  const cookie = cookieHeader(flow.admitted);
  const document = await handler(new Request(`${publish}/a/artifact-a`, { headers: { cookie, 'user-agent': 'Mozilla/5.0 Chrome/154.0.0.0 Safari/537.36', forwarded: 'host=attacker.example;proto=http', 'x-forwarded-host': 'attacker.example', referer: 'https://attacker.example/' } }));
  assert.equal(document.status, 200);
  assert.equal(document.headers.get('cache-control'), 'private, no-store');
  assert.match(document.headers.get('content-security-policy')!, /connect-src 'none'/);
  assert.match(document.headers.get('content-security-policy')!, /script-src 'none'/);
  assert.equal(document.headers.get('connection-allowlist'), null);
  assert.equal(document.headers.get('x-dns-prefetch-control'), 'off');
  assert.equal(document.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(document.headers.get('cross-origin-opener-policy'), 'same-origin');
  const body = await document.text();
  assert.match(body, /<a class="home" href="https:\/\/panel\.example\.test\/" rel="noreferrer" aria-label="Volver a la biblioteca"/);
  assert(body.includes('sandbox="allow-scripts"'));
  assert(body.includes('src="/a/artifact-a/r/revision-1/content"'));
  assert(!body.includes('srcdoc='));
  assert(!body.includes('window.secret'));
  assert(body.includes('/a/artifact-a/r/revision-1/files/nested/file.html'));
  const content = await handler(new Request(`${publish}/a/artifact-a/r/revision-1/content`, { headers: { cookie, 'sec-fetch-dest': 'iframe', 'user-agent': 'Mozilla/5.0 Chrome/154.0.0.0 Safari/537.36' } }));
  assert.equal(content.status, 200);
  assert.equal(content.headers.get('connection-allowlist'), '()');
  assert.match(content.headers.get('content-security-policy')!, /frame-ancestors 'self'; sandbox allow-scripts$/);
  assert.match(content.headers.get('content-security-policy')!, /connect-src 'none'/);
  assert.equal(content.headers.get('cache-control'), 'private, no-store');
  assert.equal(content.headers.get('x-dns-prefetch-control'), 'off');
  assert.equal(content.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(content.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert((await content.text()).includes('<script>window.secret = 1</script>'));
  assert.equal((await handler(new Request(`${publish}/a/artifact-a/r/revision-1/content`, { headers: { cookie } }))).status, 403);
  assert.equal((await handler(new Request(`${publish}/a/artifact-a/r/obsolete/content`, { headers: { cookie, 'sec-fetch-dest': 'iframe' } }))).status, 403);
  const inert = await handler(new Request(`${publish}/a/artifact-a`, { headers: { cookie, 'user-agent': 'Mozilla/5.0 Firefox/152.0' } }));
  const inertBody = await inert.text();
  assert(inertBody.includes('sandbox=""'));
  const inertContent = await handler(new Request(`${publish}/a/artifact-a/r/revision-1/content`, { headers: { cookie, 'sec-fetch-dest': 'iframe', 'user-agent': 'Mozilla/5.0 Firefox/152.0' } }));
  assert.equal(inertContent.status, 200);
  assert.match(inertContent.headers.get('content-security-policy')!, /script-src 'none'/);
  assert.match(inertContent.headers.get('content-security-policy')!, /; sandbox$/);
  assert.equal(inertContent.headers.get('connection-allowlist'), '()');
  assert((await inertContent.text()).includes('&lt;script&gt;window.secret = 1&lt;/script&gt;'));
  const download = await handler(new Request(`${publish}/a/artifact-a/r/revision-1/files/nested/file.html`, { headers: { cookie } }));
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), Buffer.from(artifact.revision.snapshot.files[0]!.data, 'base64'));
  assert.match(download.headers.get('content-disposition')!, /^attachment;/);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await handler(flow.request)).status, 403);
  assert.equal((await handler(new Request(`${publish}/a/artifact-a/r/obsolete/files/nested/file.html`, { headers: { cookie } }))).status, 403);
  assert.equal((await handler(new Request(`${publish}/a/artifact-b`, { headers: { cookie } }))).status, 303);
  assert.equal(calls.filter((url) => url.endsWith('/read')).length, 8);
});

test('anonymous files, cookie tampering, callback mismatch and missing transaction cannot expose publication bytes', async () => {
  let calls = 0;
  const handler = createPublicationApp(environment(), async () => { calls++; return new Response(null, { status: 503 }); });
  assert.equal((await handler(new Request(`${publish}/a/artifact-a/r/revision-1/files/nested/file.html`))).status, 401);
  assert.equal((await handler(new Request(`${publish}/a/artifact-a/r/revision-1/content`, { headers: { 'sec-fetch-dest': 'iframe' } }))).status, 401);
  const begin = await handler(new Request(`${publish}/a/artifact-a`));
  const state = new URL(begin.headers.get('location')!).searchParams.get('state')!;
  const callback = `${publish}/callback?${new URLSearchParams({ artifactId: 'artifact-a', state, code: 'a'.repeat(43) })}`;
  assert.equal((await handler(new Request(callback))).status, 403);
  assert.equal((await handler(new Request(callback, { headers: { cookie: `${cookieHeader(begin)}x` } }))).status, 403);
  assert.equal((await handler(new Request(callback.replace(state, 'b'.repeat(43)), { headers: { cookie: cookieHeader(begin) } }))).status, 403);
  assert.equal((await handler(new Request(callback.replace('artifact-a', 'artifact-b'), { headers: { cookie: cookieHeader(begin) } }))).status, 403);
  assert.equal(calls, 0);
});

test('backend outages, redirects and malformed content fail closed after valid admission', async () => {
  for (const failure of ['outage', 'redirect', 'malformed', 'revoked']) {
    const handler = createPublicationApp(environment(), async (input) => {
      if (String(input).endsWith('/consume')) return Response.json({ artifactId: 'artifact-a', userId: 'owner-a', sessionId: 'session-a', expiresAt: Date.now() + 60_000 });
      if (failure === 'outage') throw new Error('Disconnected');
      if (failure === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://attacker.example' } });
      if (failure === 'revoked') return new Response(null, { status: 403 });
      return Response.json({ ...artifact, unexpected: 'value' });
    });
    const flow = await authorize(handler);
    assert.equal(flow.admitted.status, 303);
    for (const path of ['/a/artifact-a', '/a/artifact-a/r/revision-1/content']) {
      const response = await handler(new Request(`${publish}${path}`, { headers: { cookie: cookieHeader(flow.admitted), 'sec-fetch-dest': 'iframe' } }));
      assert.equal(response.status, failure === 'revoked' ? 403 : 503);
      assert(!(await response.text()).includes('Protected bytes'));
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
  }
  const outage = createPublicationApp(environment(), async () => { throw new Error('Disconnected'); });
  assert.equal((await authorize(outage)).admitted.status, 503);
});

test('service admission precedes browser Origin exemption and OIDC return paths stay local', () => {
  const secret = randomBytes(32).toString('hex');
  assert(publicationServiceAuthorized(new Request(`${dashboard}/internal/publication/read`, { method: 'POST', headers: { authorization: `Bearer ${secret}` } }), secret));
  assert(!publicationServiceAuthorized(new Request(`${dashboard}/internal/publication/read`, { method: 'POST', headers: { authorization: `Bearer ${secret}x` } }), secret));
  assert(!publicationServiceAuthorized(new Request(`${dashboard}/internal/publication/read`, { method: 'GET', headers: { authorization: `Bearer ${secret}` } }), secret));
  assert.equal(localReturnPath('/publication/open?artifactId=a&state=b', dashboard), '/publication/open?artifactId=a&state=b');
  for (const target of ['https://attacker.example', '//attacker.example', '/\\attacker.example', '/\nattacker', '/#hidden']) assert.throws(() => localReturnPath(target, dashboard));
});

test('canvasDocument renders indexed boards as escaped srcdoc frames and notes as escaped text', () => {
  const canvas = canvasDocument(design, true);
  assert.equal(canvas.match(/<iframe /g)?.length, 3, 'one frame per indexed board, and board markup cannot open or close frames');
  assert(canvas.includes(`sandbox="allow-scripts" inert srcdoc="${escapeHtml(hostileBoard)}"`));
  assert(canvas.includes('&lt;/iframe&gt;&lt;script&gt;parent.document.title = 1&lt;/script&gt;'));
  assert(canvas.includes('a&amp;quot;b') && canvas.includes('Board &quot;quoted&quot;'));
  assert(!canvas.includes('</iframe><script>parent'));
  assert(!canvas.includes('Not on the canvas'), 'files outside the index stay attachments');
  assert(canvas.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot;\nsecond line</p>'));
  assert(!canvas.includes('<img src=x'));
  assert(canvas.includes('aria-label="Abrir Inicio &lt;script&gt; a tamaño real"'));
  assert(canvas.includes('aria-label="Abrir boards/Menu.html a tamaño real"'), 'a board without a title is labeled with its path');
  assert(canvas.includes('aria-label="Página Teléfono &lt;b&gt;"'));
  assert.equal(canvas.match(/<script>/g)?.length, 1, 'only the canvas host script runs in the content document');
});

test('a canvas board or note without a page belongs to the first page', () => {
  const canvas = canvasDocument(design, true);
  assert.match(canvas, /<section class="board" data-page="web" style="--x:0;--y:0;--w:1440;--h:900">/);
  assert.match(canvas, /<section class="board" data-page="phone" style="--x:0;--y:0;--w:390;--h:844">/);
  assert.match(canvas, /<p class="note" data-page="web" style="--x:0;--y:980">/);
  assert.match(canvas, /<p class="note" data-page="phone" style="--x:470;--y:0;--w:360">Phone note<\/p>/);
  const single = snapshotSchema.parse({ ...design, content: { kind: 'design', text: JSON.stringify({ v: 1, boards: { 'boards/Menu.html': { x: 5, y: 6, w: 400, h: 300 } }, order: ['boards/Menu.html'] }) } });
  const unpaged = canvasDocument(single, true);
  assert(!unpaged.includes('data-page') && !unpaged.includes('class="pages"'));
});

test('canvasDocument emits an inert source listing when interactive is false', () => {
  const listing = canvasDocument(design, false);
  assert(listing.startsWith('<p>Vista de código. Abre este diseño en Chrome 152 o posterior para usar su lienzo interactivo.</p>'));
  assert(!listing.includes('<iframe') && !listing.includes('<script') && !listing.includes('<img'));
  assert(listing.indexOf('Inicio &lt;script&gt;') < listing.indexOf('boards/Menu.html') && listing.indexOf('boards/Menu.html') < listing.indexOf('boards/Phone.html'));
  assert(listing.includes(`<pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:17px/1.6 system-ui">${escapeHtml(hostileBoard)}</pre>`));
  assert(listing.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert(!listing.includes('Not on the canvas'));
});

test('previewDocument keeps HTML, Markdown, and text bytes and renders a design as a canvas', () => {
  const shell = (policy: string, body: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(policy)}"><meta name="referrer" content="no-referrer"></head><body>${body}</body></html>`;
  const scripts = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const inert = scripts.replace("script-src 'unsafe-inline'", "script-src 'none'");
  const read = (content: { kind: 'html' | 'markdown' | 'text'; text: string }) => ({ revision: { snapshot: { content, files: [] } } });
  const pre = (text: string) => `<pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:17px/1.6 system-ui">${escapeHtml(text)}</pre>`;
  assert.equal(previewDocument(read({ kind: 'html', text: '<h1>Hi</h1>' }), true), shell(scripts, '<h1>Hi</h1>'));
  assert.equal(previewDocument(read({ kind: 'html', text: '<h1>Hi</h1>' })), shell(inert, `<p>Vista de código. Abre este HTML en Chrome 152 o posterior para usar su versión interactiva.</p>${pre('<h1>Hi</h1>')}`));
  assert.equal(previewDocument(read({ kind: 'markdown', text: '# <Hi>' }), true), shell(scripts, pre('# <Hi>')));
  assert.equal(previewDocument(read({ kind: 'text', text: 'a & b' }), true), shell(scripts, pre('a & b')));
  assert.equal(previewDocument({ revision: { snapshot: design } }, true), shell(scripts, canvasDocument(design, true)));
  assert.equal(previewDocument({ revision: { snapshot: design } }), shell(inert, canvasDocument(design, false)));
});

test('a design content response carries the same headers as an HTML content response', async () => {
  const headers: Record<string, [string, string][]> = {};
  for (const [kind, snapshot] of [['html', artifact.revision.snapshot], ['design', design]] as const) {
    const handler = createPublicationApp(environment(), async (input) => String(input).endsWith('/consume')
      ? Response.json({ artifactId: 'artifact-a', userId: 'owner-a', sessionId: 'session-a', expiresAt: Date.now() + 60_000 })
      : Response.json({ ...artifact, revision: { ...artifact.revision, snapshot } }));
    const cookie = cookieHeader((await authorize(handler)).admitted);
    for (const agent of ['Mozilla/5.0 Chrome/156.0.0.0 Safari/537.36', 'Mozilla/5.0 Firefox/152.0']) {
      const response = await handler(new Request(`${publish}/a/artifact-a/r/revision-1/content`, { headers: { cookie, 'sec-fetch-dest': 'iframe', 'user-agent': agent } }));
      assert.equal(response.status, 200);
      headers[`${kind} ${agent}`] = [...response.headers];
      if (kind === 'design') assert((await response.text()).includes(agent.includes('Chrome') ? '<main class="canvas"' : 'Vista de código. Abre este diseño'));
    }
  }
  assert.deepEqual(headers['design Mozilla/5.0 Chrome/156.0.0.0 Safari/537.36'], headers['html Mozilla/5.0 Chrome/156.0.0.0 Safari/537.36']);
  assert.deepEqual(headers['design Mozilla/5.0 Firefox/152.0'], headers['html Mozilla/5.0 Firefox/152.0']);
});
