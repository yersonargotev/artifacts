import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import panel from '../apps/dashboard/cloudflare.config.ts';

const require = createRequire(new URL('../apps/dashboard/node_modules/wrangler/package.json', import.meta.url));
const { Miniflare, Response: MiniflareResponse } = require('miniflare') as typeof import('miniflare');

const bundle = new URL('../dist/workers/panel/.cloudflare/output/v0/workers/default/', import.meta.url);
const secrets = { cookie: 'panel-cookie-value', token: 'bearer-token-value', query: 'query-grant-value', email: 'owner@example.test' };
const text = Object.fromEntries(Object.entries(panel.worker.env).flatMap(([name, binding]) => binding.type === 'text' ? [[name, binding.value]] : []));
const secretBindings = Object.fromEntries(Object.entries(panel.worker.env).flatMap(([name, binding]) => binding.type === 'secret' ? [[name, `${name.toLowerCase()}-placeholder-value-with-length`]] : []));

async function run(dsn: string | undefined) {
  const outbound: { url: string; body: string }[] = [];
  const values: Record<string, string> = { ...text, ...secretBindings, OWNER_EMAIL: secrets.email, DATABASE_URL: 'unsupported://database', SENTRY_DSN: dsn ?? '' };
  const miniflare = new Miniflare({ workers: [{
    config: {
      name: panel.worker.name,
      compatibilityDate: panel.worker.compatibilityDate,
      compatibilityFlags: panel.worker.compatibilityFlags,
      env: { ...Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { type: 'text' as const, value }])), ASSETS: { type: 'assets' as const } },
      assets: { directory: new URL('assets', bundle).pathname, runWorkerFirst: true, hasUserWorker: true },
      manifest: { mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm' as const, contents: await readFile(new URL('bundle/worker.mjs', bundle), 'utf8') } } },
    },
    dev: {
      outboundService: { type: 'fetcher' as const, handler: async (request: import('miniflare').Request) => {
        outbound.push({ url: request.url, body: await request.text() });
        return new MiniflareResponse('{}');
      } },
    },
  }] });
  try {
    const response = await miniflare.dispatchFetch(`${text.DASHBOARD_URL}/?share=${secrets.query}&email=${secrets.email}`, {
      headers: { cookie: `artifacts_panel=${secrets.cookie}`, authorization: `Bearer ${secrets.token}`, 'x-forwarded-email': secrets.email },
    });
    const body = await response.text();
    for (let attempt = 0; dsn && attempt < 50 && !outbound.length; attempt++) await delay(100);
    return { status: response.status, body, outbound };
  } finally { await miniflare.dispose(); }
}

const unavailable = 'El servicio no está disponible. Inténtalo de nuevo.';
const silent = await run(undefined);
assert.deepEqual([silent.status, silent.body, silent.outbound.length], [503, unavailable, 0], 'without a DSN the panel answers 503 and sends nothing');
const monitored = await run('https://public@sentry.example.test/1');
assert.deepEqual([monitored.status, monitored.body], [503, unavailable], 'Sentry does not change the response');
assert.equal(monitored.outbound.length, 1, `one envelope reaches the DSN host, saw ${monitored.outbound.map(({ url }) => url).join(', ')}`);
const [envelope] = monitored.outbound;
assert.match(envelope!.url, /^https:\/\/sentry\.example\.test\/api\/1\/envelope\//);
const event = envelope!.body.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line) as { tags?: Record<string, string>; exception?: { values?: { value?: string }[] } }).find((item) => item.exception);
assert.equal(event?.tags?.service, 'artifacts-panel');
assert.match(event?.exception?.values?.[0]?.value ?? '', /URL_SCHEME_NOT_SUPPORTED/);
for (const [name, value] of Object.entries(secrets)) assert(!envelope!.body.includes(value), `${name} reached Sentry`);
console.log('The panel Worker reports a failed startup to Sentry in workerd without user data');
