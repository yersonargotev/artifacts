import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { test } from 'node:test';
import { Miniflare, Response as WorkerResponse, convertV4MiniflareOptions } from 'miniflare';
import { workerCompatibility } from '../scripts/cloudflare.ts';

type Pipeline = { requests: ({ type: 'execute'; stmt: { sql: string } } | { type: 'close' })[] };

function reply(pipeline: Pipeline) {
  return {
    baton: null, base_url: null,
    results: pipeline.requests.map((request) => {
      if (request.type === 'close') return { type: 'ok', response: { type: 'close' } };
      const columns = request.stmt.sql.startsWith('select')
        ? request.stmt.sql.match(/^select (.+) from /i)![1]!.split(',').map((column) => ({ name: column.trim().replaceAll('"', ''), decltype: 'TEXT' }))
        : [{ name: 'foreign_keys', decltype: 'INTEGER' }];
      const row = request.stmt.sql.startsWith('select') ? columns.map(() => ({ type: 'null' })) : [{ type: 'integer', value: '1' }];
      return { type: 'ok', response: { type: 'execute', result: { cols: columns, rows: [row], affected_row_count: 0, last_insert_rowid: null } } };
    }),
  };
}

const bindings = {
  DATABASE_URL: 'libsql://disposable.invalid', BETTER_AUTH_SECRET: 'disposable-authorization-secret-at-least-32-bytes',
  DASHBOARD_URL: 'https://panel.example.test', AUTH_URL: 'https://auth.example.test', API_URL: 'https://api.example.test',
  MCP_URL: 'https://api.example.test/mcp', PUBLISH_URL: 'https://view.example.test', OWNER_EMAIL: 'owner@example.test',
  ALLOW_GUEST_ACCESS: 'false', MCP_INTROSPECTION_CLIENT_ID: 'diagnostic', MCP_INTROSPECTION_CLIENT_SECRET: 'diagnostic',
};

test('panel runtime recovers when an earlier startup outlives its request', { timeout: 15_000 }, async () => {
  const source = `import { getRuntime } from './apps/dashboard/src/runtime.ts';
    let first;
    let winner;
    export default { async fetch(request, env, ctx) {
      const path = new URL(request.url).pathname;
      if (path === '/seed') {
        first = getRuntime();
        ctx.waitUntil(first.catch(() => {}));
        return Response.json({ seeded: true });
      }
      if (path === '/first') return Response.json({ same: await first === winner });
      const runtime = await getRuntime();
      winner ??= runtime;
      await runtime.identity.logout('test-token');
      return Response.json({ same: runtime === winner });
    }};`;
  const bundled = await build({ stdin: { contents: source, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser', conditions: ['workerd', 'browser'], external: ['node:*', 'cloudflare:*'], target: 'es2024' });
  const started = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  let opens = 0;
  let statements = 0;
  const simulator = new Miniflare(convertV4MiniflareOptions({
    unsafeDirectSockets: [{ host: '127.0.0.1' }], modules: true, script: bundled.outputFiles[0]!.text,
    compatibilityDate: workerCompatibility.compatibilityDate, compatibilityFlags: workerCompatibility.compatibilityFlags,
    bindings: { ...bindings, PANEL_CLIENT_ID: 'panel', PANEL_CLIENT_SECRET: 'panel-secret' },
    outboundService: async (request) => {
      const pipeline = await request.json() as Pipeline;
      statements++;
      if (pipeline.requests.some((item) => item.type === 'execute' && /^pragma/i.test(item.stmt.sql))) {
        opens++;
        if (opens === 1) { started.resolve(); await gate.promise; }
      }
      return WorkerResponse.json(reply(pipeline));
    },
  }));
  try {
    await simulator.ready;
    const origin = await simulator.unsafeGetDirectURL();
    assert.deepEqual(await (await fetch(new URL('/seed', origin))).json(), { seeded: true });
    await started.promise;
    const recovered = await fetch(origin, { signal: AbortSignal.timeout(8000) });
    assert.equal(recovered.status, 200, 'a second request can start while the first database call is pending');
    assert.deepEqual(await recovered.json(), { same: true });
    gate.resolve();
    assert.deepEqual(await (await fetch(new URL('/first', origin), { signal: AbortSignal.timeout(2000) })).json(), { same: true });
    const opened = opens;
    const beforeWarm = statements;
    assert.deepEqual(await (await fetch(origin, { signal: AbortSignal.timeout(2000) })).json(), { same: true });
    assert.equal(opens, opened, 'warm access does not reopen the database');
    assert.equal(statements, beforeWarm + 1, 'warm access can still execute SQL');
  } finally { gate.resolve(); await simulator.dispose(); }
});

for (const [service, faultAt] of [['mcp', 1], ['auth', 3]] as const) {
  for (const fault of ['headers', 'body'] as const) {
    test(`${service} Worker recovers in the same environment after stalled database ${fault}`, { timeout: 15_000 }, async () => {
      const source = `import worker from './apps/${service}/src/worker.ts';
        export default { fetch(request, env, ctx) {
          return worker.fetch(new Request('${service === 'auth' ? bindings.AUTH_URL : bindings.API_URL}/health'), env, ctx);
        }};`;
      const bundled = await build({ stdin: { contents: source, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser', conditions: ['workerd', 'browser'], external: ['node:*', 'cloudflare:*'], target: 'es2024' });
      const gate = Promise.withResolvers<void>();
      let calls = 0;
      let heldBody: ReadableStreamDefaultController<Uint8Array> | undefined;
      const simulator = new Miniflare(convertV4MiniflareOptions({
        unsafeDirectSockets: [{ host: '127.0.0.1' }], modules: true, script: bundled.outputFiles[0]!.text,
        compatibilityDate: workerCompatibility.compatibilityDate, compatibilityFlags: workerCompatibility.compatibilityFlags, bindings,
        outboundService: async (request) => {
          const pipeline = await request.json() as Pipeline;
          calls++;
          if (calls === faultAt) {
            if (fault === 'headers') await gate.promise;
            else return new WorkerResponse(new ReadableStream<Uint8Array>({ start(controller) { heldBody = controller; controller.enqueue(new TextEncoder().encode('{"baton":')); } }), { headers: { 'content-type': 'application/json' } });
          }
          return WorkerResponse.json(reply(pipeline));
        },
      }));
      try {
        await simulator.ready;
        const origin = await simulator.unsafeGetDirectURL();
        const initial = await fetch(origin, { signal: AbortSignal.timeout(7500) }).then((response) => ({ status: response.status }), (error: Error) => ({ error: error.name }));
        assert.deepEqual(initial, { status: 503 }, 'a stalled dependency must reject instead of keeping startup pending');
        assert.equal(calls, faultAt, 'the failed database statement is not retried');
        const recovered = await fetch(origin, { signal: AbortSignal.timeout(2000) });
        assert.equal(recovered.status, 200);
        assert.deepEqual(await recovered.json(), { status: 'ok' });
        assert.equal(calls, faultAt + (service === 'auth' ? 4 : 2));
      } finally {
        gate.resolve();
        try { heldBody?.close(); } catch {}
        await simulator.dispose();
      }
    });
  }
}

test('a database exchange remains bounded after its invoking Worker request ends', { timeout: 15_000 }, async () => {
  const source = `import { openDatabase } from '@artifacts/db';
    let connection;
    let pending;
    export default { async fetch(request, env) {
      connection ??= await openDatabase({ url: env.DATABASE_URL });
      if (new URL(request.url).pathname === '/health') return Response.json({ healthy: true });
      if (new URL(request.url).pathname === '/seed') {
        pending = Promise.all(Array.from({ length: 20 }, () => connection.client.execute('SELECT 1').then(() => 'unexpected-success', () => 'failed')));
        return Response.json({ seeded: true });
      }
      if (new URL(request.url).pathname === '/result') return Response.json({ result: await pending });
      await connection.client.execute('SELECT 1');
      return Response.json({ healthy: true });
    }};`;
  const bundled = await build({ stdin: { contents: source, resolveDir: new URL('../apps/auth/', import.meta.url).pathname }, bundle: true, write: false, format: 'esm', platform: 'browser', conditions: ['workerd', 'browser'], external: ['node:*', 'cloudflare:*'], target: 'es2024' });
  const gate = Promise.withResolvers<void>();
  let calls = 0;
  const simulator = new Miniflare(convertV4MiniflareOptions({
    unsafeDirectSockets: [{ host: '127.0.0.1' }], modules: true, script: bundled.outputFiles[0]!.text,
    compatibilityDate: workerCompatibility.compatibilityDate, compatibilityFlags: workerCompatibility.compatibilityFlags, bindings,
    outboundService: async (request) => {
      const pipeline = await request.json() as Pipeline;
      calls++;
      if (calls >= 3 && calls <= 22) await gate.promise;
      return WorkerResponse.json(reply(pipeline));
    },
  }));
  try {
    await simulator.ready;
    const origin = await simulator.unsafeGetDirectURL();
    assert.equal((await fetch(new URL('/health', origin))).status, 200);
    assert.deepEqual(await (await fetch(new URL('/seed', origin))).json(), { seeded: true });
    const outcome = await fetch(new URL('/result', origin), { signal: AbortSignal.timeout(7500) }).then(async (response) => await response.json(), (error: Error) => ({ error: error.name }));
    assert.deepEqual(outcome, { result: Array.from({ length: 20 }, () => 'failed') });
    assert.equal(calls, 22, 'each failed statement is sent once');
    assert.deepEqual(await (await fetch(origin, { signal: AbortSignal.timeout(2000) })).json(), { healthy: true });
    assert.equal(calls, 23, 'all concurrency permits remain reusable');
  } finally { gate.resolve(); await simulator.dispose(); }
});

test('a shared database client keeps serving after clients cancel many in-flight requests', { timeout: 30_000 }, async () => {
  const source = `import { openDatabase } from '@artifacts/db';
    let connection;
    export default { async fetch() {
      connection ??= openDatabase({ url: 'libsql://disposable.invalid' });
      const { client } = await connection;
      for (let index = 0; index < 4; index++) await client.execute('SELECT 1');
      return Response.json({ healthy: true });
    }};`;
  const bundled = await build({ stdin: { contents: source, resolveDir: new URL('../apps/auth/', import.meta.url).pathname }, bundle: true, write: false, format: 'esm', platform: 'browser', conditions: ['workerd', 'browser'], external: ['node:*', 'cloudflare:*'], target: 'es2024' });
  const simulator = new Miniflare(convertV4MiniflareOptions({
    unsafeDirectSockets: [{ host: '127.0.0.1' }], modules: true, script: bundled.outputFiles[0]!.text,
    compatibilityDate: workerCompatibility.compatibilityDate, compatibilityFlags: workerCompatibility.compatibilityFlags, bindings,
    outboundService: async (request) => {
      const pipeline = await request.json() as Pipeline;
      await new Promise((resolve) => setTimeout(resolve, 150));
      return WorkerResponse.json(reply(pipeline));
    },
  }));
  try {
    await simulator.ready;
    const origin = await simulator.unsafeGetDirectURL();
    for (let press = 0; press < 60; press++) {
      const cancelled = new AbortController();
      void fetch(origin, { signal: cancelled.signal }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 10));
      cancelled.abort();
    }
    const after = await fetch(origin, { signal: AbortSignal.timeout(10_000) });
    assert.equal(after.status, 200, 'requests after a burst of cancelled requests still reach the database');
    assert.deepEqual(await after.json(), { healthy: true });
  } finally { await simulator.dispose(); }
});

test('the Worker database transport preserves a supplied fetch and its response metadata', async () => {
  const source = `import { openDatabase } from '@artifacts/db';
    export default { async fetch(request, env) {
      const mode = new URL(request.url).pathname;
      let calls = 0;
      try {
        const { client } = await openDatabase({ url: env.DATABASE_URL, fetch: async request => {
          calls++;
          if (mode === '/empty') return new Response(null, { status: 204 });
          if (mode === '/error') return new Response('diagnostic café', { status: 418, statusText: 'Diagnostic', headers: { 'content-type': 'text/plain' } });
          request.headers.set('x-custom-transport', 'used');
          return fetch(request);
        }});
        client.close();
        return Response.json({ calls });
      } catch (error) { return Response.json({ calls, message: error.message }); }
    }};`;
  const bundled = await build({ stdin: { contents: source, resolveDir: new URL('../apps/auth/', import.meta.url).pathname }, bundle: true, write: false, format: 'esm', platform: 'browser', conditions: ['workerd', 'browser'], external: ['node:*', 'cloudflare:*'], target: 'es2024' });
  let calls = 0;
  const simulator = new Miniflare(convertV4MiniflareOptions({
    unsafeDirectSockets: [{ host: '127.0.0.1' }], modules: true, script: bundled.outputFiles[0]!.text,
    compatibilityDate: workerCompatibility.compatibilityDate, compatibilityFlags: workerCompatibility.compatibilityFlags, bindings,
    outboundService: async (request) => {
      calls++;
      assert.equal(request.headers.get('x-custom-transport'), 'used');
      return WorkerResponse.json(reply(await request.json() as Pipeline));
    },
  }));
  try {
    await simulator.ready;
    const origin = await simulator.unsafeGetDirectURL();
    assert.deepEqual(await (await fetch(origin)).json(), { calls: 2 });
    assert.equal(calls, 2);
    const failure = await (await fetch(new URL('/error', origin))).json() as { calls: number; message: string };
    assert.equal(failure.calls, 1);
    assert.match(failure.message, /418/);
    assert.match(failure.message, /café/);
    const empty = await (await fetch(new URL('/empty', origin))).json() as { calls: number; message: string };
    assert.equal(empty.calls, 1);
    assert.match(empty.message, /JSON/i);
  } finally { await simulator.dispose(); }
});
