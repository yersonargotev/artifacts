import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import type { authConfig } from '@artifacts/config';
import type { Database } from '@artifacts/db';
import { createAuth as createAuthWithTransport } from './auth-core.ts';
import { cloudflareEmailSender } from '@artifacts/config/email';
import { fileEmailSender } from '@artifacts/config/email-node';

export function createAuth(db: Database, config: ReturnType<typeof authConfig>, bootstrap = false) {
  const sender = config.email?.transport === 'file' ? fileEmailSender(config.email.path) : config.email?.transport === 'cloudflare' ? cloudflareEmailSender(config.email) : undefined;
  return createAuthWithTransport(db, config, { fetchClientMetadataResource }, bootstrap, sender);
}

export type Auth = ReturnType<typeof createAuth>;
