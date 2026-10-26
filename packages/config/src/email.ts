import { required, type Environment } from './index.ts';

export type EmailMessage = { to: string; subject: string; text: string; html?: string };
export type EmailSender = (message: EmailMessage) => Promise<void>;
export type EmailConfiguration =
  | { transport: 'disabled' }
  | { transport: 'file'; ownerEmail: string; path: string }
  | { transport: 'cloudflare'; ownerEmail: string; from: string; accountId: string; apiToken: string };
export type EmailEnvironment = {
  EMAIL_TRANSPORT?: string;
  OWNER_EMAIL?: string;
  EMAIL_FROM?: string;
  EMAIL_FILE_PATH?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_EMAIL_API_TOKEN?: string;
};

export function emailConfiguration(env: Environment, origin: string): EmailConfiguration {
  if (!env.EMAIL_TRANSPORT) return { transport: 'disabled' };
  const ownerEmail = required('OWNER_EMAIL', env).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new Error('OWNER_EMAIL must be an email address');
  if (env.EMAIL_TRANSPORT === 'file') {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('File email delivery requires a loopback AUTH_URL');
    return { transport: 'file', ownerEmail, path: required('EMAIL_FILE_PATH', env) };
  }
  if (env.EMAIL_TRANSPORT === 'cloudflare') {
    const from = required('EMAIL_FROM', env).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) throw new Error('EMAIL_FROM must be an email address');
    const accountId = required('CLOUDFLARE_ACCOUNT_ID', env);
    if (!/^[a-f\d]{32}$/i.test(accountId)) throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal ID');
    return { transport: 'cloudflare', ownerEmail, from, accountId, apiToken: required('CLOUDFLARE_EMAIL_API_TOKEN', env) };
  }
  throw new Error('EMAIL_TRANSPORT must be cloudflare or file');
}

export function cloudflareEmailSender(config: Extract<EmailConfiguration, { transport: 'cloudflare' }>, fetcher: typeof fetch = fetch): EmailSender {
  return async (message) => {
    const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/email/sending/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...message, from: config.from }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Email provider request failed');
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('success' in body) || body.success !== true || !('errors' in body) || !Array.isArray(body.errors) || body.errors.length || !('result' in body) || !body.result || typeof body.result !== 'object') throw new Error('Email provider response is invalid');
    const result = body.result;
    const addresses = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
    if (!('delivered' in result) || !addresses(result.delivered) || !('queued' in result) || !addresses(result.queued) || !('permanent_bounces' in result) || !addresses(result.permanent_bounces) || ('suppressed_recipients' in result && !addresses(result.suppressed_recipients))) throw new Error('Email provider delivery result is invalid');
    const matches = (email: string) => email.toLowerCase() === message.to.toLowerCase();
    if (result.permanent_bounces.some(matches) || ('suppressed_recipients' in result && (result.suppressed_recipients as string[]).some(matches)) || ![...result.delivered, ...result.queued].some(matches)) throw new Error('Email provider did not accept the recipient');
  };
}
