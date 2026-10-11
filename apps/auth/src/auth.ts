import { betterAuth } from 'better-auth';
import { jwt } from 'better-auth/plugins';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { mcp } from '@better-auth/mcp';
import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { scopes, type authConfig } from '@artifacts/config';
import type { Database } from '@artifacts/db';
import * as schema from '@artifacts/db/schema';

export function createAuth(db: Database, config: ReturnType<typeof authConfig>, bootstrap = false) {
  return betterAuth({
    appName: 'Artifacts',
    disabledPaths: ['/token'],
    baseURL: config.origin,
    secret: config.secret,
    database: drizzleAdapter(db, { provider: 'sqlite', schema, transaction: true }),
    trustedOrigins: [config.origin],
    emailAndPassword: { enabled: true, disableSignUp: !bootstrap, autoSignIn: false, minPasswordLength: 14 },
    session: { expiresIn: 30 * 86400, disableSessionRefresh: true, cookieCache: { enabled: false } },
    advanced: { cookiePrefix: 'artifacts-auth', useSecureCookies: config.origin.startsWith('https:') },
    plugins: [
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
      cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
