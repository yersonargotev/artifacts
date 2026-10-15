import { mkdtemp, chmod, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restCliFixture } from './rest-cli-fixture.ts';
import { grant } from './helpers.ts';

const app = await restCliFixture();
const directory = await mkdtemp(join(tmpdir(), 'artifacts-cli-forward-'));
await chmod(directory, 0o700);
const manifest = join(directory, 'connection.json');
const tokens = await grant(app, 'openid profile offline_access artifacts:read artifacts:write artifacts:publish');
let refreshToken = tokens.refresh_token;
async function save(accessToken: string) {
  const next = join(directory, 'connection.next.json');
  await writeFile(next, JSON.stringify({ server: app.config.resource, panel: app.dashboard, publication: app.publishOrigin, account: { email: 'owner@example.test', password: app.password, userId: app.ownerId }, env: { ARTIFACTS_SERVER: app.config.resource, ARTIFACTS_STATE_DIR: join(directory, 'state'), ARTIFACTS_ACCESS_TOKEN: accessToken }, directory }, null, 2) + '\n', { mode: 0o600 });
  await rename(next, manifest);
}
await save(tokens.access_token);
let refreshing: Promise<void> | undefined;
const timer = setInterval(() => {
  if (refreshing) return;
  refreshing = (async () => {
    const response = await fetch(`${app.config.issuer}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: tokens.clientId, refresh_token: refreshToken, resource: app.config.resource }), redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Fixture credential refresh failed');
    const refreshed = await response.json() as { access_token: string; refresh_token: string };
    refreshToken = refreshed.refresh_token;
    await save(refreshed.access_token);
  })().catch(() => { process.stderr.write('Fixture credentials could not be refreshed. Restart the disposable fixture.\n'); }).finally(() => { refreshing = undefined; });
}, 60_000);
console.log(JSON.stringify({ manifest, server: app.config.resource, panel: app.dashboard }));
try {
  await new Promise<void>((resolve) => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
} finally {
  clearInterval(timer);
  await refreshing;
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
