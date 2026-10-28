import type { BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware, type createAuthEndpoint } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@artifacts/db';
import * as schema from '@artifacts/db/schema';
import type { AccessPolicy } from '@artifacts/config';
import { createAdmission } from '@artifacts/db/admission';
import type { EmailSender } from '@artifacts/config/email';
import { deliverEmailCode, emailCodeIp } from './email-code-context.ts';

export const emailCodePaths = ['/email-otp/send-verification-otp', '/sign-in/email-otp'];
const invalidCode = { code: 'INVALID_OTP', message: 'Invalid OTP' };
const emailInput = z.object({ email: z.email() });

export function createEmailCode(db: Database, policy: AccessPolicy, send: EmailSender) {
  const { ownerEmail } = policy;
  const { email: admitted } = createAdmission(db, policy);
  async function reserve(kind: 'send-ip' | 'send-email' | 'redeem-ip', identity: string, maximum: number) {
    const key = `artifacts:email-code:${kind}:${identity}`;
    const now = sql`cast(unixepoch('subsecond') * 1000 as integer)`;
    const accepted = await db.all<{ count: number }>(sql`
      INSERT INTO verification (id, identifier, value, created_at, updated_at, expires_at)
      VALUES (${key}, ${key}, '1', ${now}, ${now}, ${now} + 604800000)
      ON CONFLICT (id) DO UPDATE SET
        value = CASE WHEN updated_at <= ${now} - 60000 THEN '1' ELSE cast(cast(value as integer) + 1 as text) END,
        updated_at = ${now}, expires_at = ${now} + 604800000
      WHERE updated_at <= ${now} - 60000 OR cast(value as integer) < ${maximum}
      RETURNING cast(value as integer) AS count
    `);
    if (accepted.length) return;
    const [remaining] = await db.all<{ seconds: number }>(sql`SELECT max(1, cast((updated_at + 60000 - ${now} + 999) / 1000 as integer)) AS seconds FROM verification WHERE id = ${key}`);
    throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many requests. Please try again later.' }, { 'X-Retry-After': String(remaining?.seconds ?? 60) });
  }
  const otp = emailOTP({
    storeOTP: 'hashed',
    async sendVerificationOTP({ email, otp }) {
      await deliverEmailCode(async () => {
        if (await admitted(email)) await send({ to: email, subject: 'Tu código para Artifacts', text: `Tu código para iniciar sesión es ${otp}. Caduca en cinco minutos.` });
      });
    },
  });
  Object.assign(otp.endpoints.signInEmailOTP.options, {
    onAPIError(error) {
      if ((error.statusCode === 400 && ['INVALID_OTP', 'OTP_EXPIRED'].includes(error.body?.code ?? '')) ||
          (error.statusCode === 403 && error.body?.code === 'TOO_MANY_ATTEMPTS')) throw new APIError('BAD_REQUEST', invalidCode);
    },
  } satisfies Pick<Parameters<typeof createAuthEndpoint>[0], 'onAPIError'>);
  const plugin = { id: otp.id, version: otp.version, endpoints: { sendVerificationOTP: otp.endpoints.sendVerificationOTP, signInEmailOTP: otp.endpoints.signInEmailOTP } };
  const before = createAuthMiddleware(async (ctx) => {
    if (!emailCodePaths.includes(ctx.path)) return;
    const input = emailInput.safeParse(ctx.body);
    if (!input.success) throw new APIError('BAD_REQUEST', invalidCode);
    if (ctx.path === '/email-otp/send-verification-otp') {
      if (ctx.body.type !== 'sign-in') throw new APIError('BAD_REQUEST', invalidCode);
      await reserve('send-ip', emailCodeIp(), 10);
      await reserve('send-email', input.data.email.toLowerCase(), 3);
    } else {
      await reserve('redeem-ip', emailCodeIp(), 30);
      if (!otp.endpoints.signInEmailOTP.options.body.safeParse(ctx.body).success) throw new APIError('BAD_REQUEST', invalidCode);
      if (!await admitted(input.data.email.toLowerCase())) throw new APIError('BAD_REQUEST', invalidCode);
    }
  });
  const databaseHooks = {
    session: { create: { before: async (session, ctx) => {
      if (ctx?.path !== '/sign-in/email-otp') return;
      const existing = await db.select({ verified: schema.user.emailVerified }).from(schema.user).where(eq(schema.user.id, session.userId)).get();
      if (!existing?.verified) throw new APIError('BAD_REQUEST', invalidCode);
    } } },
    account: { delete: { before: async (account, ctx) => {
      if (ctx?.path !== '/sign-in/email-otp' || account.providerId !== 'credential' || !account.password || account.accountId !== account.userId) return;
      const input = emailInput.safeParse(ctx.body);
      if (!input.success || input.data.email.toLowerCase() !== ownerEmail) return;
      const existing = await db.select().from(schema.user).where(eq(schema.user.id, account.userId)).get();
      if (existing?.email === ownerEmail && !existing.emailVerified) return false;
    } } },
  } satisfies NonNullable<BetterAuthOptions['databaseHooks']>;
  return { plugin, before, databaseHooks };
}
