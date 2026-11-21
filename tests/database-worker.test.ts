import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { test } from 'node:test';
import { Miniflare, Response as WorkerResponse, convertV4MiniflareOptions } from 'miniflare';
import { workerCompatibility } from '../scripts/cloudflare.ts';
import { isRetryableRead } from '../packages/db/src/exchange.ts';

type Statement = { sql?: string; sql_id?: number };
type Pipeline = { baton?: string | null; requests: ({ type: 'execute'; stmt: Statement } | { type: 'batch'; batch: { steps: { stmt: Statement }[] } } | { type: 'store_sql'; sql_id: number; sql: string } | { type: 'close' })[] };

function result(sql: string) {
  const columns = sql.startsWith('select')
    ? sql.match(/^select (.+) from /i)![1]!.split(',').map((column) => ({ name: column.trim().replaceAll('"', ''), decltype: 'TEXT' }))
    : [{ name: 'foreign_keys', decltype: 'INTEGER' }];
  const row = sql.startsWith('select') ? columns.map(() => ({ type: 'null' })) : [{ type: 'integer', value: '1' }];
  return { cols: columns, rows: [row], affected_row_count: 0, last_insert_rowid: null };
}

function reply(pipeline: Pipeline) {
  const stored = new Map(pipeline.requests.flatMap((request) => request.type === 'store_sql' ? [[request.sql_id, request.sql] as const] : []));
  const sqlOf = (stmt: Statement) => stmt.sql ?? stored.get(stmt.sql_id!)!;
  const closed = pipeline.requests.some((request) => request.type === 'close');
  const begun = pipeline.requests.some((request) => request.type === 'batch' && request.batch.steps.some(({ stmt }) => /^begin/i.test(sqlOf(stmt))));
  return {
    baton: closed ? null : pipeline.baton ?? (begun ? 'interactive-transaction' : null), base_url: null,
    results: pipeline.requests.map((request) => {
      if (request.type === 'close' || request.type === 'store_sql') return { type: 'ok', response: { type: request.type } };
      if (request.type === 'batch') return { type: 'ok', response: { type: 'batch', result: { step_results: request.batch.steps.map(({ stmt }) => result(sqlOf(stmt))), step_errors: request.batch.steps.map(() => null) } } };
      return { type: 'ok', response: { type: 'execute', result: result(sqlOf(request.stmt)) } };
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
      if (pipeline.requests.some((item) => item.type === 'execute' && /^pragma/i.test(item.stmt.sql ?? ''))) {
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

// The mcp fault hits a PRAGMA, which is sent once, and the auth fault hits a SELECT, whose retry stalls too.
for (const [service, faultAt, retries] of [['mcp', 1, 0], ['auth', 3, 1]] as const) {
  for (const fault of ['headers', 'body'] as const) {
    test(`${service} Worker recovers in the same environment after stalled database ${fault}`, { timeout: 15_000 }, async () => {
      const source = `import worker from './apps/${service}/src/worker.ts';
        export default { fetch(request, env, ctx) {
          return worker.fetch(new Request('${service === 'auth' ? bindings.AUTH_URL : bindings.API_URL}/health'), env, ctx);
        }};`;
      const bundled = await build({ stdin: { contents: source, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser', conditions: ['workerd', 'browser'], external: ['node:*', 'cloudflare:*'], target: 'es2024' });
      const gate = Promise.withResolvers<void>();
      let calls = 0;
      const heldBodies: ReadableStreamDefaultController<Uint8Array>[] = [];
      const simulator = new Miniflare(convertV4MiniflareOptions({
        unsafeDirectSockets: [{ host: '127.0.0.1' }], modules: true, script: bundled.outputFiles[0]!.text,
        compatibilityDate: workerCompatibility.compatibilityDate, compatibilityFlags: workerCompatibility.compatibilityFlags, bindings,
        outboundService: async (request) => {
          const pipeline = await request.json() as Pipeline;
          calls++;
          if (calls >= faultAt && calls <= faultAt + retries) {
            if (fault === 'headers') await gate.promise;
            else return new WorkerResponse(new ReadableStream<Uint8Array>({ start(controller) { heldBodies.push(controller); controller.enqueue(new TextEncoder().encode('{"baton":')); } }), { headers: { 'content-type': 'application/json' } });
          }
          return WorkerResponse.json(reply(pipeline));
        },
      }));
      try {
        await simulator.ready;
        const origin = await simulator.unsafeGetDirectURL();
        const initial = await fetch(origin, { signal: AbortSignal.timeout(7500) }).then((response) => ({ status: response.status }), (error: Error) => ({ error: error.name }));
        assert.deepEqual(initial, { status: 503 }, 'a stalled dependency must reject instead of keeping startup pending');
        assert.equal(calls, faultAt + retries, retries ? 'a stalled read is retried once' : 'a stalled PRAGMA is not retried');
        const recovered = await fetch(origin, { signal: AbortSignal.timeout(2000) });
        assert.equal(recovered.status, 200);
        assert.deepEqual(await recovered.json(), { status: 'ok' });
        assert.equal(calls, faultAt + retries + (service === 'auth' ? 4 : 2));
      } finally {
        gate.resolve();
        for (const heldBody of heldBodies) try { heldBody.close(); } catch {}
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
      if (calls >= 3 && calls <= 42) await gate.promise;
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
    assert.equal(calls, 42, 'each stalled read is retried once after its request ends, then fails');
    assert.deepEqual(await (await fetch(origin, { signal: AbortSignal.timeout(2000) })).json(), { healthy: true });
    assert.equal(calls, 43, 'all concurrency permits remain reusable');
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

test('only a SELECT exchange outside an interactive transaction is retryable', () => {
  const pipeline = (requests: unknown[], baton: string | null = null) => JSON.stringify({ baton, requests });
  const execute = (sql: string) => ({ type: 'execute', stmt: { sql, args: [] } });
  const close = { type: 'close' };
  assert.equal(isRetryableRead(pipeline([execute('select "id" from "artifact"'), close])), true);
  assert.equal(isRetryableRead(pipeline([execute('  SELECT 1')])), true);
  assert.equal(isRetryableRead(pipeline([{ type: 'batch', batch: { steps: [{ stmt: { sql: 'select 1' } }, { condition: { type: 'ok', step: 0 }, stmt: { sql: 'select 2' } }] } }, close])), true);
  for (const [requests, reason] of [
    [[execute('select 1'), execute('update "artifact" set "slug" = null')], 'a read mixed with a write'],
    [[{ type: 'batch', batch: { steps: [{ stmt: { sql: 'BEGIN DEFERRED' } }, { stmt: { sql: 'select 1' } }, { stmt: { sql: 'COMMIT' } }] } }, close], 'a batch transaction'],
    [[execute('with "recent" as (select 1) select * from "recent"'), close], 'a CTE'],
    [[execute('PRAGMA foreign_keys'), close], 'a PRAGMA'],
    [[execute('insert into "artifact" select * from "artifact"'), close], 'an INSERT from a SELECT'],
    [[execute('selection'), close], 'a word that only starts with select'],
    [[{ type: 'execute', stmt: { sql_id: 1 } }, close], 'stored SQL'],
    [[{ type: 'sequence', sql: 'select 1' }, close], 'a sequence'],
    [[{ type: 'describe', sql: 'select 1' }, close], 'a describe'],
    [[{ type: 'store_sql', sql_id: 1, sql: 'select 1' }, close], 'a stored statement'],
    [[{ type: 'get_autocommit' }, close], 'an autocommit probe'],
    [[{ type: 'batch', batch: { steps: [] } }, close], 'an empty batch'],
    [[close], 'a bare close'],
  ] as const) assert.equal(isRetryableRead(pipeline([...requests])), false, reason);
  assert.equal(isRetryableRead(pipeline([execute('select 1'), close], 'interactive-transaction')), false, 'an exchange with a baton');
  assert.equal(isRetryableRead('{"baton":'), false, 'a body that is not JSON');
  assert.equal(isRetryableRead('{}'), false, 'a body without requests');
});

test('a stalled read recovers on its one retry, while stalled writes, mixed batches, and transactions fail once at five seconds', { timeout: 20_000 }, async () => {
  const source = `import { openDatabase } from '@artifacts/db';
    const warnings = [];
    console.warn = (...values) => { warnings.push(values); };
    let connection;
    export default { async fetch(request, env) {
      connection ??= await openDatabase({ url: env.DATABASE_URL });
      const { client } = connection;
      const path = new URL(request.url).pathname;
      if (path === '/warnings') return Response.json(warnings);
      const started = Date.now();
      try {
        if (path === '/read') await client.execute({ sql: 'select "title" from "artifact_revision" where "id" = ?', args: ['secret-read-id'] });
        if (path === '/write') await client.execute({ sql: 'update "artifact" set "project" = ? where "id" = ?', args: ['secret-project', 'secret-write-id'] });
        if (path === '/mixed') await client.batch([{ sql: 'select "id" from "artifact" where "id" = ?', args: ['secret-mixed-id'] }, { sql: 'update "artifact" set "slug" = ? where "id" = ?', args: ['secret-slug', 'secret-mixed-id'] }], 'write');
        if (path === '/transaction') {
          const transaction = await client.transaction('read');
          try {
            await transaction.execute('select "id" from "artifact"');
            await transaction.execute({ sql: 'select "title" from "artifact_revision" where "id" = ?', args: ['secret-transaction-id'] });
          } finally { transaction.close(); }
        }
        return Response.json({ ok: true, ms: Date.now() - started });
      } catch { return Response.json({ ok: false, ms: Date.now() - started }); }
    }};`;
  const bundled = await build({ stdin: { contents: source, resolveDir: new URL('../apps/auth/', import.meta.url).pathname }, bundle: true, write: false, format: 'esm', platform: 'browser', conditions: ['workerd', 'browser'], external: ['node:*', 'cloudflare:*'], target: 'es2024', define: { 'process.env.WORKER_NAME': JSON.stringify('artifacts-api') } });
  const gate = Promise.withResolvers<void>();
  const seen = { 'secret-read-id': 0, 'secret-write-id': 0, 'secret-mixed-id': 0, 'secret-transaction-id': 0 };
  const simulator = new Miniflare(convertV4MiniflareOptions({
    unsafeDirectSockets: [{ host: '127.0.0.1' }], modules: true, script: bundled.outputFiles[0]!.text,
    compatibilityDate: workerCompatibility.compatibilityDate, compatibilityFlags: workerCompatibility.compatibilityFlags, bindings,
    outboundService: async (request) => {
      const body = await request.text();
      const marker = Object.keys(seen).find((key) => body.includes(key)) as keyof typeof seen | undefined;
      if (marker) seen[marker]++;
      if (marker && (marker !== 'secret-read-id' || seen[marker] === 1)) await gate.promise;
      return WorkerResponse.json(reply(JSON.parse(body) as Pipeline));
    },
  }));
  try {
    await simulator.ready;
    const origin = await simulator.unsafeGetDirectURL();
    assert.equal((await fetch(new URL('/warnings', origin))).status, 200);
    const outcome = async (path: string) => await (await fetch(new URL(path, origin), { signal: AbortSignal.timeout(9000) })).json() as { ok: boolean; ms: number };
    const [read, write, mixed, transaction] = await Promise.all(['/read', '/write', '/mixed', '/transaction'].map(outcome));
    assert.equal(read!.ok, true, 'a read whose first exchange stalls recovers in the same request');
    assert(read!.ms >= 2000 && read!.ms < 4500, `the read retries after its two-second deadline, took ${read!.ms} ms`);
    for (const [name, failed] of [['write', write], ['mixed batch', mixed], ['transaction read', transaction]] as const) {
      assert.equal(failed!.ok, false, `a stalled ${name} fails`);
      assert(failed!.ms >= 4900 && failed!.ms < 6500, `a stalled ${name} fails at its five-second deadline, took ${failed!.ms} ms`);
    }
    assert.deepEqual(seen, { 'secret-read-id': 2, 'secret-write-id': 1, 'secret-mixed-id': 1, 'secret-transaction-id': 1 }, 'only the read is sent twice');
    const warnings = await (await fetch(new URL('/warnings', origin))).json() as { durationMs: number }[][];
    assert.equal(warnings.length, 1, 'the one retry writes one line');
    const [line] = warnings[0]!;
    assert.deepEqual({ ...line, durationMs: typeof line!.durationMs }, { message: 'Database read retried after a timeout', service: 'artifacts-api', attempt: 2, durationMs: 'number', recovered: true });
    assert(line!.durationMs >= 2000, 'the line reports the time the read took across both attempts');
    assert.doesNotMatch(JSON.stringify(warnings), /secret|select|artifact_revision|disposable\.invalid|libsql/i, 'the line carries no SQL, arguments, or database URL');
  } finally { gate.resolve(); await simulator.dispose(); }
});
