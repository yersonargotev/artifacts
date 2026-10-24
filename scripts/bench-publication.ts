import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { artifactReadSchema, publishResultSchema } from '../packages/artifacts/src/contracts.ts';

type Instance = { mcp: string };
type Credentials = { accessToken: string; password: string };
type Viewer = { run: string; artifactId: string; url: string; cookie: string; samples: number[] };

const requests = 200;
const warmup = 10;
const snapshot = { metadata: { title: 'Publication benchmark', description: '' }, content: { kind: 'html', text: '<h1>Publication benchmark</h1>' }, files: [] };

async function tool(instance: Instance, credentials: Credentials, name: string, input: unknown) {
  const response = await fetch(instance.mcp, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${credentials.accessToken}`, 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } }) });
  assert.equal(response.status, 200, `${name} HTTP status; a run's MCP token expires about five minutes after launch`);
  const body = await response.text();
  const payload = body.startsWith('event:') ? body.split('\n').find((line) => line.startsWith('data:'))?.slice(5) : body;
  const { result } = JSON.parse(payload ?? '{}') as { result?: { isError?: boolean; structuredContent: unknown } };
  assert(result && !result.isError, `${name} succeeded`);
  return result.structuredContent;
}

async function admit(browser: Browser, run: string): Promise<Viewer> {
  const instance = JSON.parse(await readFile(join(run, 'instance.json'), 'utf8')) as Instance;
  const credentials = JSON.parse(await readFile(join(run, 'runtime', 'credentials.json'), 'utf8')) as Credentials;
  const created = artifactReadSchema.parse(await tool(instance, credentials, 'artifacts_create', { requestId: randomUUID(), snapshot }));
  const published = publishResultSchema.parse(await tool(instance, credentials, 'artifacts_publish', { requestId: randomUUID(), artifactId: created.artifactId, revisionId: created.revision.id, expectedPublicationVersion: 0 }));
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(published.url);
    await page.getByLabel('Correo electrónico').fill('owner@example.test');
    await page.getByLabel('Contraseña').fill(credentials.password);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.waitForURL(published.url);
    const cookies = await context.cookies(published.url);
    return { run, artifactId: created.artifactId, url: published.url, cookie: cookies.map(({ name, value }) => `${name}=${value}`).join('; '), samples: [] };
  } finally { await context.close(); }
}

async function timed(viewer: Viewer) {
  const started = performance.now();
  const response = await fetch(viewer.url, { headers: { cookie: viewer.cookie }, redirect: 'manual' });
  const body = await response.text();
  const elapsed = performance.now() - started;
  assert.equal(response.status, 200, `${viewer.run} GET ${viewer.url} status`);
  assert(body.includes(viewer.artifactId), `${viewer.run} served the published document`);
  return elapsed;
}

const percentile = (samples: number[], fraction: number) => samples.toSorted((left, right) => left - right)[Math.ceil(samples.length * fraction) - 1]!;
const twoDecimals = (value: number) => Math.round(value * 100) / 100;

const runs = process.argv.slice(2).map((path) => resolve(path));
if (runs.length !== 2) throw new Error('Usage: node --import tsx scripts/bench-publication.ts <trunk-run> <head-run>');
const browser = await chromium.launch({ channel: 'chrome' });
const viewers: Viewer[] = [];
try { for (const run of runs) viewers.push(await admit(browser, run)); }
finally { await browser.close(); }
for (let round = 0; round < warmup; round++) for (const viewer of viewers) await timed(viewer);
for (let pair = 0; pair < requests / 2; pair++) {
  const order = pair % 2 === 0 ? viewers : viewers.toReversed();
  for (const viewer of order) viewer.samples.push(await timed(viewer));
}
console.log(JSON.stringify({ requests, warmup, runs: viewers.map(({ run, samples }) => ({ run, samples: samples.length, p50Ms: twoDecimals(percentile(samples, 0.5)), p95Ms: twoDecimals(percentile(samples, 0.95)) })) }, null, 2));
