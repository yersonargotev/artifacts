import type { McpWorkerEnvironment } from '@artifacts/config';
import { workerCompatibility, workerOrigins, type WorkerConfiguration } from '../../scripts/cloudflare.ts';

export default {
  worker: {
    name: 'artifacts-api',
    ...workerCompatibility,
    entrypoint: './src/worker.ts',
    env: {
      OWNER_EMAIL: { type: 'secret' },
      ALLOW_GUEST_ACCESS: { type: 'text', value: 'false' },
      EMAIL_TRANSPORT: { type: 'text', value: 'resend' },
      EMAIL_FROM: { type: 'secret' },
      RESEND_API_KEY: { type: 'secret' },
      AUTH_URL: { type: 'text', value: workerOrigins.AUTH_URL },
      MCP_URL: { type: 'text', value: workerOrigins.MCP_URL },
      API_URL: { type: 'text', value: workerOrigins.API_URL },
      PUBLISH_URL: { type: 'text', value: workerOrigins.PUBLISH_URL },
      MCP_INTROSPECTION_CLIENT_ID: { type: 'secret' },
      MCP_INTROSPECTION_CLIENT_SECRET: { type: 'secret' },
      DATABASE_URL: { type: 'secret' },
      DATABASE_AUTH_TOKEN: { type: 'secret' },
    },
  },
} satisfies WorkerConfiguration<McpWorkerEnvironment>;
