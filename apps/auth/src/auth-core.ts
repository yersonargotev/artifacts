import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { createAdmission } from '@artifacts/db/admission';
import { authRateStorage } from './rate-limit.ts';
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
  const codes = email && sender ? createEmailCode(db, config.access, sender) : undefined;
  const admission = createAdmission(db, config.access);
  const tokenHash = (token: string) => createHash('sha256').update(token).digest('base64url');
  const denied = () => new APIError('FORBIDDEN', { code: 'ACCESS_DENIED', message: 'Account access is disabled' });
  return betterAuth({
    appName: 'Artifacts',
    disabledPaths: ['/token', ...(!codes ? emailCodePaths : [])],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/oauth2/token' && ctx.body?.grant_type === 'refresh_token' && typeof ctx.body.refresh_token === 'string') {
          const token = await db.select({ userId: schema.oauthRefreshToken.userId }).from(schema.oauthRefreshToken).where(eq(schema.oauthRefreshToken.token, tokenHash(ctx.body.refresh_token))).get();
          if (token && !await admission.user(token.userId)) throw new APIError('BAD_REQUEST', { error: 'invalid_grant', error_description: 'Account access is disabled' });
        }
        if (ctx.path !== '/sign-out' && !ctx.path.startsWith('/sign-in/') && !emailCodePaths.includes(ctx.path)) {
          const current = await getSessionFromCtx(ctx);
          if (current && !await admission.user(current.user.id)) {
            if (ctx.path === '/get-session') return ctx.json(null);
            throw denied();
          }
        }
        if (codes) await codes.before(ctx);
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/oauth2/introspect') return;
        const result = ctx.context.returned;
        if (result && typeof result === 'object' && 'active' in result && result.active === true &&
            (!('sub' in result) || typeof result.sub !== 'string' || !await admission.user(result.sub))) return ctx.json({ active: false });
      }),
    },
    rateLimit: { enabled: true, customStorage: authRateStorage(db), customRules: { '/oauth2/introspect': false, ...(codes ? { '/email-otp/send-verification-otp': false, '/sign-in/email-otp': false } : {}) } },
    databaseHooks: {
      ...codes?.databaseHooks,
      session: { create: { before: async (session, ctx) => {
        if (!await admission.user(session.userId)) throw denied();
        await codes?.databaseHooks.session.create.before(session, ctx);
      } } },
    },
    baseURL: config.origin,
    secret: config.secret,
    database: drizzleAdapter(db, { provider: 'sqlite', schema, transaction: true }),
    trustedOrigins: [config.origin],
    emailAndPassword: { enabled: true, disableSignUp: !bootstrap, autoSignIn: false, minPasswordLength: 14 },
    session: { expiresIn: 30 * 86400, disableSessionRefresh: true, cookieCache: { enabled: false } },
    advanced: { ipAddress: { ipAddressHeaders: ['x-artifacts-client-ip'], ipv6Subnet: 64 }, cookiePrefix: 'artifacts-auth', useSecureCookies: config.origin.startsWith('https:') },
    plugins: [
      ...(codes ? [codes.plugin] : []),
      jwt({ jwt: { issuer: config.issuer } }),
      mcp({
        storeTokens: { hash: async (token) => tokenHash(token) },
        customTokenResponseFields: async ({ user }) => {
          if (!user || !await admission.user(user.id)) throw new APIError('BAD_REQUEST', { error: 'invalid_grant', error_description: 'Account access is disabled' });
          return {};
        },
        customUserInfoClaims: async ({ user }) => {
          if (!await admission.user(user.id)) throw denied();
          return {};
        },
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
