import type { Database } from '@artifacts/db';
import type { authConfig } from '@artifacts/config';
import { createAuth } from './auth.ts';
import { createAuthHandler } from './http-core.ts';

export function createAuthApp(db: Database, config: ReturnType<typeof authConfig>) {
  return createAuthHandler(db, config, createAuth(db, config));
}
