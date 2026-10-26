import { appendFile } from 'node:fs/promises';
import type { EmailSender } from './email.ts';

export function fileEmailSender(path: string): EmailSender {
  return (message) => appendFile(path, `${JSON.stringify(message)}\n`, { mode: 0o600 });
}
