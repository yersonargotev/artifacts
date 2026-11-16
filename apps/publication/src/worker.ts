import { withMonitoring } from '@artifacts/monitoring';
import { createPublicationApp } from './http.ts';
import type { PublicationEnvironment } from './http.ts';

export default withMonitoring('artifacts-view', { fetch(request: Request, environment: PublicationEnvironment) { return createPublicationApp(environment)(request); } });
