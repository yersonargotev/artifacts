import { serve } from '@hono/node-server';
import { listener, mcpConfig, required, serviceUrl } from '@artifacts/config';
import { openDatabase } from '@artifacts/db';
import { createArtifactStore } from '@artifacts/artifacts';
import { createResourceApp } from './app.ts';

process.loadEnvFile();
const config = mcpConfig();
const { db } = await openDatabase({ url: required('DATABASE_URL'), authToken: process.env.DATABASE_AUTH_TOKEN });
const artifacts = createArtifactStore(db, { publishOrigin: serviceUrl('PUBLISH_URL') });
serve({ fetch: createResourceApp(config, artifacts), ...listener('MCP', 4101) });
console.log(`MCP listening at ${config.resource}`);
