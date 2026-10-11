import type { PublicationWorkerEnvironment } from '@artifacts/config';
import { workerCompatibility, workerOrigins, type WorkerConfiguration } from '../../scripts/cloudflare.ts';

export default {
  worker: {
    name: 'artifacts-view',
    ...workerCompatibility,
    entrypoint: './src/worker.ts',
    env: {
      DASHBOARD_URL: { type: 'text', value: workerOrigins.DASHBOARD_URL },
      PUBLISH_URL: { type: 'text', value: workerOrigins.PUBLISH_URL },
      PUBLICATION_SERVICE_SECRET: { type: 'secret' },
      PUBLICATION_COOKIE_SECRET: { type: 'secret' },
    },
  },
} satisfies WorkerConfiguration<PublicationWorkerEnvironment>;
