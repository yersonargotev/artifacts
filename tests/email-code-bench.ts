import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { fixture } from './helpers.ts';
import { createAuthApp } from '../apps/auth/src/http.ts';
import { createArtifactStore } from '../packages/artifacts/src/index.ts';

const parentPath = process.argv[process.argv.indexOf('--parent') + 1];
const output = process.argv[process.argv.indexOf('--out') + 1];
assert(parentPath && output, 'Pass --parent WORKTREE --out JSON');
assert.equal(process.env.NODE_ENV, 'production', 'Run both sides with production auth limiting');
const parent = await import(pathToFileURL(resolve(parentPath, 'tests/helpers.ts')).href) as typeof import('./helpers.ts');
const nativeFetch = globalThis.fetch;
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const summary = (values: number[]) => ({ count: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95), min: Math.min(...values), max: Math.max(...values) });
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function measured(app: Awaited<ReturnType<typeof fixture>>, path: string, body: unknown) {
  const start = performance.now();
  const response = await nativeFetch(`${app.config.issuer}${path}`, { method: 'POST', headers: { origin: app.config.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  const elapsed = performance.now() - start;
  assert.equal(response.status, 200);
  return { elapsed, result };
}
const baseline = await parent.fixture();
const head = await fixture({ emailCode: true });
const password = { parent: [] as number[], head: [] as number[] };
try {
  for (let index = 0; index < 50; index++) {
    if (index && index % 3 === 0) await delay(10_100);
    for (const side of index % 2 ? ['head', 'parent'] as const : ['parent', 'head'] as const) {
      const app = side === 'parent' ? baseline : head;
      const value = await measured(app, '/sign-in/email', { email: 'owner@example.test', password: app.password });
      assert.equal(value.result.user.id, app.ownerId);
      assert(value.result.token);
      password[side].push(value.elapsed);
    }
  }
} finally { await baseline.close(); await head.close(); }

const timings: Record<string, { admitted: number[]; suppressed: number[]; deliveries: number; bodiesEqual: boolean }> = {};
try {
  for (const transport of ['file', 'delayed', 'rejecting'] as const) {
    const samples = { admitted: [] as number[], suppressed: [] as number[], deliveries: 0, bodiesEqual: true };
    timings[transport] = samples;
    for (let batch = 0; batch < 10; batch++) {
      const app = await fixture({ emailCode: true });
      let runtime: ReturnType<typeof createAuthApp> | undefined;
      let providerCalls = 0;
      try {
        if (transport !== 'file') {
          globalThis.fetch = async (url, init) => {
            if (String(url) !== 'https://api.resend.com/emails') return nativeFetch(url, init);
            providerCalls++;
            await delay(100);
            if (transport === 'rejecting') throw new Error('Injected provider rejection');
            return Response.json({ id: 'accepted-message' });
          };
          runtime = createAuthApp(app.db, { ...app.config, email: { transport: 'resend', ownerEmail: 'owner@example.test', from: 'codes@example.test', apiKey: 'fixture-token' } });
          app.setAuthHandler(runtime);
        }
        const current = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
        assert(current);
        const actor = { userId: app.ownerId, sessionId: current.session.id, clientId: 'email-code-benchmark', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
        const store = createArtifactStore(app.db, { publishOrigin: 'https://publication.example.test' });
        const artifact = await store.create(actor, { requestId: randomUUID(), snapshot: { metadata: { title: 'Timing fixture', description: '' }, content: { kind: 'html', text: '<p>Timing</p>' }, files: [] } });
        for (let pair = 0; pair < 5; pair++) {
          for (const admitted of pair % 2 ? [false, true] : [true, false]) {
            const email = `${admitted ? 'admitted' : 'suppressed'}-${pair}@example.test`;
            await app.auth.api.signUpEmail({ body: { email, name: 'Timing account', password: app.password } });
            const share = await store.share(actor, { requestId: randomUUID(), artifactId: artifact.artifactId, email });
            if (!admitted) await store.unshare(actor, { requestId: randomUUID(), artifactId: artifact.artifactId, shareId: share.shareId });
            const value = await measured(app, '/email-otp/send-verification-otp', { email, type: 'sign-in' });
            assert.deepEqual(value.result, { success: true });
            samples[admitted ? 'admitted' : 'suppressed'].push(value.elapsed);
          }
        }
        if (runtime) await runtime.drain();
        else {
          for (let attempt = 0; attempt < 100; attempt++) {
            const lines = (await readFile(app.emailSink!, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
            if (lines.length === 5) break;
            await delay(10);
          }
          assert.equal((await readFile(app.emailSink!, 'utf8')).trim().split('\n').length, 5);
        }
        assert.equal(providerCalls, transport === 'file' ? 0 : 5);
        samples.deliveries += 5;
        const counters = await app.client.execute("SELECT value FROM verification WHERE id LIKE 'artifacts:email-code:send-ip:%'");
        assert.equal(counters.rows[0].value, '10');
      } finally { await runtime?.drain(); await app.close(); globalThis.fetch = nativeFetch; }
    }
  }
} finally { globalThis.fetch = nativeFetch; }
const before = summary(password.parent);
const after = summary(password.head);
const report = {
  runtime: process.version, mode: process.env.NODE_ENV, baseline: resolve(parentPath), samples: { password, timings },
  password: { parent: before, head: after, regression: after.p95 > before.p95 * 1.1 && after.p95 - before.p95 > 5 },
  code: Object.fromEntries(Object.entries(timings).map(([name, values]) => [name, { admitted: summary(values.admitted), suppressed: summary(values.suppressed), deliveries: values.deliveries, bodiesEqual: values.bodiesEqual }])),
  failures: 0, policy: 'Unchanged production password budgets and 10 real send reservations per independent fixture IP bucket',
};
await writeFile(output, JSON.stringify(report, null, 2));
assert.equal(report.password.regression, false, 'Password p95 exceeds both 10 percent and 5 ms');
assert(summary(timings.file.admitted).p95 <= 200, 'File code request p95 exceeds 200 ms');
console.log(JSON.stringify({ password: report.password, code: report.code, failures: report.failures }));
