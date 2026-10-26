import type { AuthWorkerEnvironment } from '@artifacts/config';
import { workerCompatibility, workerOrigins, type WorkerConfiguration } from '../../scripts/cloudflare.ts';

export default {
  worker: {
    name: 'artifacts-auth',
    ...workerCompatibility,
    entrypoint: './src/worker.ts',
    env: {
      EMAIL_TRANSPORT: { type: 'text', value: 'cloudflare' },
      EMAIL_FROM: { type: 'secret' },
      CLOUDFLARE_ACCOUNT_ID: { type: 'secret' },
      CLOUDFLARE_EMAIL_API_TOKEN: { type: 'secret' },
      OWNER_EMAIL: { type: 'secret' },
      AUTH_URL: { type: 'text', value: workerOrigins.AUTH_URL },
      MCP_URL: { type: 'text', value: workerOrigins.MCP_URL },
      DASHBOARD_URL: { type: 'text', value: workerOrigins.DASHBOARD_URL },
      BETTER_AUTH_SECRET: { type: 'secret' },
      DATABASE_URL: { type: 'secret' },
      DATABASE_AUTH_TOKEN: { type: 'secret' },
    },
  },
} satisfies WorkerConfiguration<AuthWorkerEnvironment>;
