import type { Database } from '@artifacts/db';
import type { authConfig } from '@artifacts/config';
import { createAuth } from './auth.ts';
import { createAuthHandler } from './http-core.ts';
import { withEmailCodeRequest } from './email-code-context.ts';

export function createAuthApp(db: Database, config: ReturnType<typeof authConfig>) {
  const handler = createAuthHandler(db, config, createAuth(db, config));
  const pending = new Set<Promise<void>>();
  let closing = false;
  const fetch = (request: Request, bindings?: { incoming: { socket: { remoteAddress?: string } } }) => {
    if (closing) return Promise.resolve(new Response('Authorization unavailable', { status: 503 }));
    return withEmailCodeRequest(request, bindings?.incoming.socket.remoteAddress, (task) => {
      pending.add(task);
      void task.finally(() => pending.delete(task));
    }, handler);
  };
  return Object.assign(fetch, { async drain() {
    closing = true;
    while (pending.size) await Promise.all(pending);
  } });
}
