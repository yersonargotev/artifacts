import { serve } from '@hono/node-server';
import { required } from '@artifacts/config';
import { createPublicationApp } from './http.ts';

const fetch = createPublicationApp({ DASHBOARD_URL: required('DASHBOARD_URL'), PUBLISH_URL: required('PUBLISH_URL'), PUBLICATION_SERVICE_SECRET: required('PUBLICATION_SERVICE_SECRET'), PUBLICATION_COOKIE_SECRET: required('PUBLICATION_COOKIE_SECRET') });
serve({ fetch, hostname: process.env.PUBLICATION_BIND_HOST ?? '127.0.0.1', port: Number(process.env.PUBLICATION_PORT ?? 8788) });
