import type { PublicationWorkerEnvironment } from '@artifacts/config';
import { sentryDsn, workerCompatibility, workerObservability, workerOrigins, type WorkerConfiguration } from '../../scripts/cloudflare.ts';

export default {
  worker: {
    name: 'artifacts-view',
    ...workerCompatibility,
    entrypoint: './src/worker.ts',
    observability: workerObservability,
    env: {
      SENTRY_DSN: { type: 'text', value: sentryDsn },
      DASHBOARD_URL: { type: 'text', value: workerOrigins.DASHBOARD_URL },
      PUBLISH_URL: { type: 'text', value: workerOrigins.PUBLISH_URL },
      PUBLICATION_SERVICE_SECRET: { type: 'secret' },
      PUBLICATION_COOKIE_SECRET: { type: 'secret' },
    },
  },
} satisfies WorkerConfiguration<PublicationWorkerEnvironment>;
