import { serve } from '@hono/node-server';
import { listener, mcpConfig } from '@artifacts/config';
import { createMcpApp } from './http.ts';

process.loadEnvFile();
const config = mcpConfig();
serve({ fetch: createMcpApp(config), ...listener('MCP', 4101) });
console.log(`MCP listening at ${config.resource}`);
