import { betterAuth } from 'better-auth';
import { jwt } from 'better-auth/plugins';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { mcp } from '@better-auth/mcp';
import { cimd } from '@better-auth/cimd';
import { scopes, type authConfig } from '@artifacts/config';
import type { Database } from '@artifacts/db';
import * as schema from '@artifacts/db/schema';
import type { EmailSender } from '@artifacts/config/email';
import { createEmailCode, emailCodePaths } from './email-code.ts';

export type ClientMetadataTransport = Pick<Parameters<typeof cimd>[0], 'fetchClientMetadataResource' | 'isMetadataDocumentUrlAllowed'>;

export function createAuth(db: Database, config: ReturnType<typeof authConfig>, transport: ClientMetadataTransport, bootstrap = false, sender?: EmailSender) {
  const email = config.email && config.email.transport !== 'disabled' ? config.email : undefined;
  if (email && !sender) throw new Error('Email delivery is required when email codes are enabled');
  const codes = email && sender ? createEmailCode(db, email.ownerEmail, sender) : undefined;
  return betterAuth({
    appName: 'Artifacts',
    disabledPaths: ['/token', ...(!codes ? emailCodePaths : [])],
    hooks: codes ? { before: codes.before } : undefined,
    rateLimit: codes ? { customRules: { '/email-otp/send-verification-otp': false, '/sign-in/email-otp': false } } : undefined,
    databaseHooks: codes?.databaseHooks,
    baseURL: config.origin,
    secret: config.secret,
    database: drizzleAdapter(db, { provider: 'sqlite', schema, transaction: true }),
    trustedOrigins: [config.origin],
    emailAndPassword: { enabled: true, disableSignUp: !bootstrap, autoSignIn: false, minPasswordLength: 14 },
    session: { expiresIn: 30 * 86400, disableSessionRefresh: true, cookieCache: { enabled: false } },
    advanced: { cookiePrefix: 'artifacts-auth', useSecureCookies: config.origin.startsWith('https:') },
    plugins: [
      ...(codes ? [codes.plugin] : []),
      jwt({ jwt: { issuer: config.issuer } }),
      mcp({
        loginPage: '/sign-in',
        consentPage: '/consent',
        resource: config.resource,
        scopes: [...scopes],
        grantTypes: ['authorization_code', 'refresh_token'],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        allowPublicClientPrelogin: true,
        clientRegistrationRequirePKCE: true,
        accessTokenExpiresIn: 300,
        refreshTokenExpiresIn: 7 * 86400,
        refreshTokenReuseInterval: 30,
        rateLimit: { introspect: false },
      }),
      cimd({ ...transport, metadataProfile: 'mcp-2026-07-28' }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
