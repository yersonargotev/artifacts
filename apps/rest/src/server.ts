import { createEmailSender } from '@artifacts/config/email-sender';
import { serve } from '@hono/node-server';
import { accessPolicy, listener, mcpConfig, required, serviceUrl } from '@artifacts/config';
import { openDatabase } from '@artifacts/db';
import { createArtifactStore } from '@artifacts/artifacts';
import { createArtifactRestApp } from '@artifacts/rest';

const config = mcpConfig();
const { db } = await openDatabase({ url: required('DATABASE_URL'), authToken: process.env.DATABASE_AUTH_TOKEN });
const artifacts = createArtifactStore(db, { access: accessPolicy(), publishOrigin: serviceUrl('PUBLISH_URL'), sendInvitation: createEmailSender(process.env, serviceUrl('MCP_URL')) });
serve({ fetch: createArtifactRestApp({ ...config, resource: config.apiResource ?? config.resource }, artifacts), ...listener('MCP', 4101) });
console.log(`REST listening at ${config.apiResource ?? config.resource}/v1`);
