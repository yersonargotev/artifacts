import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import type { authConfig } from '@artifacts/config';
import type { Database } from '@artifacts/db';
import { createAuth as createAuthWithTransport } from './auth-core.ts';

export function createAuth(db: Database, config: ReturnType<typeof authConfig>, bootstrap = false) {
  return createAuthWithTransport(db, config, { fetchClientMetadataResource }, bootstrap);
}

export type Auth = ReturnType<typeof createAuth>;
