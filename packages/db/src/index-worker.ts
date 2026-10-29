import type { Config } from '@libsql/client';
import { waitUntil } from 'cloudflare:workers';
import { openDatabase as open } from './index.ts';

const httpExchangeTimeoutMs = 5000;

export function openDatabase(config: Config) {
  const transport = config.fetch ?? fetch;
  return open({
    ...config,
    fetch(request: Request) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new DOMException('Database HTTP exchange timed out', 'TimeoutError')), httpExchangeTimeoutMs);
      const signal = AbortSignal.any([request.signal, controller.signal]);
      const exchange = (async () => {
        try {
          const response: Response = await transport(new Request(request, { signal }));
          const body = response.body === null ? null : await response.arrayBuffer();
          return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
        } finally { clearTimeout(timeout); }
      })();
      waitUntil(exchange.then(() => undefined, () => undefined));
      return exchange;
    },
  });
}

export type { Database } from './index.ts';
