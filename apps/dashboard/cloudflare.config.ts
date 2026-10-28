import type { DashboardWorkerEnvironment } from '@artifacts/config';
import { workerCompatibility, workerOrigins, type WorkerConfiguration } from '../../scripts/cloudflare.ts';

export default {
  worker: {
    name: 'artifacts-panel',
    ...workerCompatibility,
    entrypoint: '@astrojs/cloudflare/entrypoints/server',
    env: {
      OWNER_EMAIL: { type: 'secret' },
      ALLOW_GUEST_ACCESS: { type: 'text', value: 'false' },
      EMAIL_TRANSPORT: { type: 'text', value: 'resend' },
      EMAIL_FROM: { type: 'secret' },
      RESEND_API_KEY: { type: 'secret' },
      AUTH_URL: { type: 'text', value: workerOrigins.AUTH_URL },
      MCP_URL: { type: 'text', value: workerOrigins.MCP_URL },
      DASHBOARD_URL: { type: 'text', value: workerOrigins.DASHBOARD_URL },
      PUBLISH_URL: { type: 'text', value: workerOrigins.PUBLISH_URL },
      PANEL_CLIENT_ID: { type: 'secret' },
      PANEL_CLIENT_SECRET: { type: 'secret' },
      PUBLICATION_SERVICE_SECRET: { type: 'secret' },
      DATABASE_URL: { type: 'secret' },
      DATABASE_AUTH_TOKEN: { type: 'secret' },
    },
  },
} satisfies WorkerConfiguration<DashboardWorkerEnvironment>;
