import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createPublicationApp } from '../apps/publication/src/http.ts';
import type { ArtifactRead } from '../packages/artifacts/src/contracts.ts';
import { localReturnPath } from '../apps/dashboard/src/identity.ts';
import { publicationServiceAuthorized } from '../apps/dashboard/src/publication.ts';

const publish = 'https://publication.example.test';
const dashboard = 'https://panel.example.test';
const artifact: ArtifactRead = {
  artifactId: 'artifact-a', ownerId: 'owner-a', headRevisionId: 'revision-1', publication: { revisionId: 'revision-1', version: 1, url: `${publish}/a/artifact-a` },
  revision: { id: 'revision-1', parentRevisionId: null, sequence: 1, authorUserId: 'owner-a', authorClientId: 'client-a', createdAt: '2026-01-01T00:00:00Z', sha256: 'a'.repeat(64), snapshot: { metadata: { title: 'Protected document', description: 'A retained document' }, content: { kind: 'html', text: '<h1>Protected bytes</h1><script>window.secret = 1</script>' }, files: [{ path: 'nested/file.html', mediaType: 'text/html', encoding: 'base64', data: 'AAH/PGgxPkF0dGFjaG1lbnQ8L2gxPg==' }] } },
};

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
  const document = await handler(new Request(`${publish}/a/artifact-a`, { headers: { cookie } }));
  assert.equal(document.status, 200);
  assert.equal(document.headers.get('cache-control'), 'private, no-store');
  assert.match(document.headers.get('content-security-policy')!, /connect-src 'none'/);
  const body = await document.text();
  assert(body.includes('sandbox="allow-scripts"'));
  assert(body.includes('&lt;script&gt;window.secret = 1&lt;/script&gt;'));
  assert(body.includes('/a/artifact-a/r/revision-1/files/nested/file.html'));
  const download = await handler(new Request(`${publish}/a/artifact-a/r/revision-1/files/nested/file.html`, { headers: { cookie } }));
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), Buffer.from(artifact.revision.snapshot.files[0]!.data, 'base64'));
  assert.match(download.headers.get('content-disposition')!, /^attachment;/);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await handler(flow.request)).status, 403);
  assert.equal((await handler(new Request(`${publish}/a/artifact-a/r/obsolete/files/nested/file.html`, { headers: { cookie } }))).status, 403);
  assert.equal((await handler(new Request(`${publish}/a/artifact-b`, { headers: { cookie } }))).status, 303);
  assert.equal(calls.filter((url) => url.endsWith('/read')).length, 3);
});

test('anonymous files, cookie tampering, callback mismatch and missing transaction cannot expose publication bytes', async () => {
  let calls = 0;
  const handler = createPublicationApp(environment(), async () => { calls++; return new Response(null, { status: 503 }); });
  assert.equal((await handler(new Request(`${publish}/a/artifact-a/r/revision-1/files/nested/file.html`))).status, 401);
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
    const response = await handler(new Request(`${publish}/a/artifact-a`, { headers: { cookie: cookieHeader(flow.admitted) } }));
    assert.equal(response.status, failure === 'revoked' ? 403 : 503);
    assert(!(await response.text()).includes('Protected bytes'));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
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
