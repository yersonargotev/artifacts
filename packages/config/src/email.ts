import { required, type Environment } from './index.ts';

export type EmailMessage = { to: string; subject: string; text: string; html?: string };
export type EmailSender = (message: EmailMessage) => Promise<void>;
export type EmailTransportConfiguration =
  | { transport: 'disabled' }
  | { transport: 'file'; path: string }
  | { transport: 'resend'; from: string; apiKey: string };
export type EmailConfiguration = { transport: 'disabled' } | (Exclude<EmailTransportConfiguration, { transport: 'disabled' }> & { ownerEmail: string });
export type EmailEnvironment = {
  EMAIL_TRANSPORT?: string;
  OWNER_EMAIL?: string;
  EMAIL_FROM?: string;
  EMAIL_FILE_PATH?: string;
  RESEND_API_KEY?: string;
};

export function emailTransportConfiguration(env: Environment, origin: string): EmailTransportConfiguration {
  if (!env.EMAIL_TRANSPORT) return { transport: 'disabled' };
  if (env.EMAIL_TRANSPORT === 'file') {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('File email delivery requires a loopback AUTH_URL');
    return { transport: 'file', path: required('EMAIL_FILE_PATH', env) };
  }
  if (env.EMAIL_TRANSPORT === 'resend') {
    const from = required('EMAIL_FROM', env).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) throw new Error('EMAIL_FROM must be an email address');
    const apiKey = required('RESEND_API_KEY', env);
    if (/[\s\x00-\x1f\x7f]/.test(apiKey)) throw new Error('RESEND_API_KEY must not contain whitespace or control characters');
    return { transport: 'resend', from, apiKey };
  }
  throw new Error('EMAIL_TRANSPORT must be resend or file');
}

export function emailConfiguration(env: Environment, origin: string): EmailConfiguration {
  if (!env.EMAIL_TRANSPORT) return { transport: 'disabled' };
  const ownerEmail = required('OWNER_EMAIL', env).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new Error('OWNER_EMAIL must be an email address');
  const transport = emailTransportConfiguration(env, origin);
  return transport.transport === 'disabled' ? transport : { ...transport, ownerEmail };
}

export function resendEmailSender(config: Extract<EmailTransportConfiguration, { transport: 'resend' }>, fetcher: typeof fetch = fetch): EmailSender {
  return async (message) => {
    try {
      const response = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...message, from: config.from }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('Email provider request failed');
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string' || !body.id.trim()) throw new Error('Email provider response is invalid');
    } catch {
      throw new Error('Email provider request failed');
    }
  };
}
