import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authConfig, dashboardConfig, mcpConfig } from '../packages/config/src/index.ts';

const env = { AUTH_URL: 'http://localhost:4100', DASHBOARD_URL: 'https://panel.example.test', MCP_URL: 'http://127.0.0.1:4101/mcp', BETTER_AUTH_SECRET: 'configuration-test-secret-at-least-32-characters', PANEL_CLIENT_ID: 'panel', PANEL_CLIENT_SECRET: 'secret', MCP_INTROSPECTION_CLIENT_ID: 'resource', MCP_INTROSPECTION_CLIENT_SECRET: 'secret' };

test('public origins reject unsupported paths and non-loopback HTTP while MCP retains its resource path', () => {
  assert.throws(() => authConfig({ ...env, AUTH_URL: 'http://localhost:4100/nested' }), /without a path/);
  assert.throws(() => mcpConfig({ ...env, AUTH_URL: 'http://localhost:4100/nested' }), /without a path/);
  assert.throws(() => dashboardConfig({ ...env, DASHBOARD_URL: 'https://panel.example.test/nested' }), /without a path/);
  assert.throws(() => dashboardConfig({ ...env, AUTH_URL: 'http://auth.example.test' }), /requires HTTPS/);
  assert.equal(mcpConfig(env).resource, 'http://127.0.0.1:4101/mcp');
  assert.equal(authConfig(env).dashboard, 'https://panel.example.test');
});
