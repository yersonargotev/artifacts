import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { fixture } from './helpers.ts';

test('Workers retain shared startup in each request context and recover after failed initialization', async () => {
  const app = await fixture();
  try {
    const source = `
      import assert from 'node:assert/strict';
      import auth from './apps/auth/src/worker.ts';
      import resource from './apps/mcp/src/worker.ts';
      const configured = JSON.parse(process.env.WORKER_STARTUP_FIXTURE);
      for (const [name, worker] of [['auth', auth], ['resource', resource]]) {
        const env = { ...configured };
        const first = [];
        const second = [];
        const request = () => new Request((name === 'auth' ? env.AUTH_URL : env.API_URL) + '/health');
        const responses = [
          worker.fetch(request(), env, { waitUntil: (task) => first.push(task) }),
          worker.fetch(request(), env, { waitUntil: (task) => second.push(task) }),
        ];
        assert.equal(first.length, 1, name + ' retains startup before awaiting it');
        assert.equal(second.length, 1, name + ' retains shared startup in the later context');
        assert.deepEqual((await Promise.all(responses)).map((response) => response.status), [200, 200]);
        assert.deepEqual(await Promise.all([...first, ...second]), [undefined, undefined]);

        const retryEnv = { ...configured, DATABASE_URL: 'unsupported://database' };
        const failed = [];
        assert.equal((await worker.fetch(request(), retryEnv, { waitUntil: (task) => failed.push(task) })).status, 503);
        assert.equal(failed.length, 1, name + ' retains failed startup');
        assert.deepEqual(await Promise.all(failed), [undefined], name + ' handles background failure');
        retryEnv.DATABASE_URL = configured.DATABASE_URL;
        const retried = [];
        assert.equal((await worker.fetch(request(), retryEnv, { waitUntil: (task) => retried.push(task) })).status, 200);
        assert.equal(retried.length, 1);
        await Promise.all(retried);
      }
      console.log('Worker startup contexts passed under local Node execution');
    `;
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], {
      cwd: new URL('..', import.meta.url), timeout: 15_000,
      env: { PATH: process.env.PATH, WORKER_STARTUP_FIXTURE: JSON.stringify({ OWNER_EMAIL: app.config.access.ownerEmail, DATABASE_URL: app.databaseUrl, AUTH_URL: app.config.origin, API_URL: new URL(app.config.resource).origin, MCP_URL: app.config.resource, DASHBOARD_URL: app.config.dashboard, PUBLISH_URL: 'https://published.example.test', BETTER_AUTH_SECRET: app.config.secret, MCP_INTROSPECTION_CLIENT_ID: app.mcpOptions.clientId, MCP_INTROSPECTION_CLIENT_SECRET: app.mcpOptions.clientSecret }) },
    });
    assert.match(result.stdout, /Worker startup contexts passed/);
  } finally { await app.close(); }
});
