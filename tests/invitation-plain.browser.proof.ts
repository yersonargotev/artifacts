import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createArtifactHttpClient } from '../packages/client/src/index.ts';
import { restCliFixture } from './rest-cli-fixture.ts';
import { grant } from './helpers.ts';

const label = process.argv.includes('--parent') ? 'parent' : 'head';
const directory = resolve(`.test-artifacts/invitation-plain-${label}`);
await mkdir(directory, { recursive: true });
const app = await restCliFixture();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const client = createArtifactHttpClient({ resource: app.config.resource, accessToken: (await grant(app, 'openid profile artifacts:read artifacts:write artifacts:publish')).access_token });
  const created = await client.create({ requestId: randomUUID(), snapshot: { metadata: { title: 'Acceso sin aviso', description: '' }, content: { kind: 'text', text: 'Publicación de prueba' }, files: [] } });
  const command = { requestId: randomUUID(), artifactId: created.artifactId, email: 'plain@example.test' };
  const result = await client.share(command);
  assert.deepEqual(Object.keys(result).sort(), ['artifactId', 'createdAt', 'kind', 'shareId', 'value']);
  assert.deepEqual(await client.share(command), result);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(app.dashboard);
  if (await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).isVisible()) await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByLabel('Correo electrónico', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Contraseña', { exact: true }).fill(app.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByRole('heading', { name: 'Biblioteca', exact: true }).waitFor();
  await page.goto(`${app.dashboard}/artifacts/${created.artifactId}/share`);
  await page.getByText('plain@example.test', { exact: true }).waitFor();
  await page.screenshot({ path: resolve(directory, `share-${label}.png`) });
  await writeFile(resolve(directory, 'result.json'), JSON.stringify({ status: 'PASS', label, result, observed: 'Plain shares return exactly five fields and exact replay returns the same receipt.' }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', label, directory }));
} finally { await browser.close(); await app.close(); }
