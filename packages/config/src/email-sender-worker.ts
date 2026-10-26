import type { Environment } from './index.ts';
import { resendEmailSender, emailTransportConfiguration, type EmailSender } from './email.ts';

export function createEmailSender(env: Environment, origin: string): EmailSender | undefined {
  const config = emailTransportConfiguration(env, origin);
  if (config.transport === 'disabled') return undefined;
  if (config.transport === 'file') throw new Error('File email delivery is unavailable in Workers');
  return resendEmailSender(config);
}
