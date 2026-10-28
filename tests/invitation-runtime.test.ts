import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createArtifactHttpClient } from '../packages/client/src/index.ts';
import { fixture, grant } from './helpers.ts';

test('transport configuration stays independent of auth admission and Workers reject local file delivery', async () => {
  const { emailConfiguration, emailTransportConfiguration } = await import('../packages/config/src/email.ts');
  const { createEmailSender: workerSender } = await import('../packages/config/src/email-sender-worker.ts');
  assert.deepEqual(emailConfiguration({}, 'https://auth.example.test'), { transport: 'disabled' });
  assert.deepEqual(emailTransportConfiguration({ EMAIL_TRANSPORT: 'file', EMAIL_FILE_PATH: '/private/disposable.jsonl' }, 'http://localhost:4100'), { transport: 'file', path: '/private/disposable.jsonl' });
  assert.throws(() => emailConfiguration({ EMAIL_TRANSPORT: 'file', EMAIL_FILE_PATH: '/private/disposable.jsonl' }, 'http://localhost:4100'), /OWNER_EMAIL/);
  assert.throws(() => workerSender({ EMAIL_TRANSPORT: 'file', EMAIL_FILE_PATH: '/private/disposable.jsonl' }, 'http://localhost:4100'), /unavailable in Workers/);
});

test('the actual standalone REST and MCP Node factories deliver to the disposable file sink', async () => {
  const app = await fixture({ transport: 'rest', invitations: true });
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-invitation-runtime-'));
  const children: ChildProcess[] = [];
  try {
    await writeFile(join(directory, '.env'), '', { mode: 0o600 });
    const token = (await grant(app, 'openid profile artifacts:read artifacts:write artifacts:publish')).access_token;
    const client = createArtifactHttpClient({ resource: app.config.resource, accessToken: token });
    const created = await client.create({ requestId: randomUUID(), snapshot: { metadata: { title: 'Runtime invitation', description: '' }, content: { kind: 'text', text: 'Disposable' }, files: [] } });
    for (const service of ['rest', 'mcp']) {
      const reservation = createServer().listen(0, '127.0.0.1');
      await once(reservation, 'listening');
      const address = reservation.address();
      assert(address && typeof address === 'object');
      await new Promise<void>((done) => reservation.close(() => done()));
      const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url)), fileURLToPath(new URL(`../apps/${service}/src/server.ts`, import.meta.url))], { cwd: directory, env: { PATH: process.env.PATH, OWNER_EMAIL: app.config.access.ownerEmail, ALLOW_GUEST_ACCESS: String(app.config.access.allowGuests), DATABASE_URL: app.databaseUrl, AUTH_URL: app.config.origin, MCP_URL: app.config.resource, PUBLISH_URL: 'https://published.example.test', MCP_INTROSPECTION_CLIENT_ID: app.mcpOptions.clientId, MCP_INTROSPECTION_CLIENT_SECRET: app.mcpOptions.clientSecret, MCP_PORT: String(address.port), EMAIL_TRANSPORT: 'file', EMAIL_FILE_PATH: app.emailSink }, stdio: ['ignore', 'pipe', 'ignore'] });
      children.push(child);
      await Promise.race([once(child.stdout!, 'data'), once(child, 'exit').then(() => { throw new Error(`${service} factory exited before readiness`); })]);
      let listening = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        listening = await new Promise<boolean>((done) => {
          const socket = createConnection({ host: '127.0.0.1', port: address.port });
          socket.once('connect', () => { socket.destroy(); done(true); });
          socket.once('error', () => { socket.destroy(); done(false); });
        });
        if (listening) break;
        assert.equal(child.exitCode, null);
        await new Promise((done) => setTimeout(done, 20));
      }
      assert(listening, 'The standalone listener must accept connections');
      const body = JSON.stringify({ requestId: randomUUID(), email: `${service}@example.test`, notify: true });
      const result = await new Promise<{ status: number; body: unknown }>((accept, reject) => {
        const outgoing = request({ hostname: '127.0.0.1', port: address.port, path: `/mcp/v1/artifacts/${created.artifactId}/shares`, method: 'POST', headers: { host: new URL(app.config.resource).host, authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (response) => {
          let bytes = '';
          response.on('data', (chunk) => { bytes += String(chunk); });
          response.on('end', () => { try { accept({ status: response.statusCode!, body: JSON.parse(bytes) }); } catch (error) { reject(error); } });
        });
        outgoing.on('error', reject);
        outgoing.end(body);
      });
      assert.equal(result.status, 201);
      assert.deepEqual((result.body as { notification: unknown }).notification, { status: 'requested' });
      assert.equal((await client.listShares({ artifactId: created.artifactId })).items.filter((share) => share.value === `${service}@example.test`).length, 1);
    }
    const messages = (await readFile(app.emailSink!, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(messages.map((message) => message.to).sort(), ['mcp@example.test', 'rest@example.test']);
  } finally {
    await Promise.all(children.map(async (child) => { if (child.exitCode !== null) return; const closed = once(child, 'exit'); child.kill('SIGTERM'); await closed; }));
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
