import { createPublicationApp } from './http.ts';
import type { PublicationEnvironment } from './http.ts';

export default { fetch(request: Request, environment: PublicationEnvironment) { return createPublicationApp(environment)(request); } };
