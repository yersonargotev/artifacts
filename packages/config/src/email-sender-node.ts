import type { Environment } from './index.ts';
import { resendEmailSender, emailTransportConfiguration, type EmailSender } from './email.ts';
import { fileEmailSender } from './email-node.ts';

export function createEmailSender(env: Environment, origin: string): EmailSender | undefined {
  const config = emailTransportConfiguration(env, origin);
  if (config.transport === 'disabled') return undefined;
  return config.transport === 'file' ? fileEmailSender(config.path) : resendEmailSender(config);
}
