import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchClientMetadataResource, isMetadataDocumentUrlAllowed } from '../apps/auth/src/metadata-worker.ts';

const codex = 'https://chatgpt.com/oauth/codex/client.json';
const claude = 'https://claude.ai/oauth/claude-code-client-metadata';

test('Worker metadata gate and transport share the exact vendor resource policy', async () => {
  const original = globalThis.fetch;
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json({ client_id: requests.at(-1)!.url });
  };
  try {
    for (const url of [codex, claude]) {
      assert(isMetadataDocumentUrlAllowed(url));
      assert.equal((await fetchClientMetadataResource(url)).status, 200);
    }
    for (const url of ['http://chatgpt.com/oauth/codex/client.json', `${codex}?changed=1`, `${codex}#changed`, 'https://chatgpt.com/oauth/codex/client.json/extra', 'https://chatgpt.com/jwks', 'https://chatgpt.com.evil.test/oauth/codex/client.json', 'https://127.0.0.1/', 'https://169.254.169.254/']) {
      assert.equal(isMetadataDocumentUrlAllowed(url), false);
      await assert.rejects(fetchClientMetadataResource(url));
    }
    await assert.rejects(fetchClientMetadataResource(codex, { method: 'POST' }), /GET and HEAD/);
    assert.equal(requests.length, 2);
    assert(requests.every((request) => request.redirect === 'manual'));
  } finally {
    globalThis.fetch = original;
  }
});

test('Worker metadata refuses redirects, cancels their bodies, and permits conditional 304', async () => {
  const original = globalThis.fetch;
  let cancelled = 0;
  let calls = 0;
  try {
    for (const status of [300, 301, 302, 303, 305, 307, 308, 399]) {
      globalThis.fetch = async () => {
        calls++;
        return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status, headers: { location: claude } });
      };
      await assert.rejects(fetchClientMetadataResource(codex), /redirects are forbidden/);
    }
    assert.equal(cancelled, 8);
    assert.equal(calls, 8);
    globalThis.fetch = async () => new Response(null, { status: 304 });
    assert.equal((await fetchClientMetadataResource(codex, { method: 'HEAD' })).status, 304);
  } finally {
    globalThis.fetch = original;
  }
});
