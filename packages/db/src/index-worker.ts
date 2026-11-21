import type { Config } from '@libsql/client';
import { waitUntil } from 'cloudflare:workers';
import { isRetryableRead } from './exchange.ts';
import { openDatabase as open } from './index.ts';

const exchangeTimeoutMs = 5000;
// A read gets a second attempt inside the same five seconds that bound any other exchange.
const firstReadTimeoutMs = 2000;
const retriedReadTimeoutMs = 3000;

export function openDatabase(config: Config) {
  const transport = config.fetch ?? fetch;
  return open({
    ...config,
    // The client's slot limiter frees a slot in the continuation of the request that took it, and workerd drops that continuation when the request is cancelled, so the slots leak until every query queues forever.
    concurrency: Infinity,
    fetch(request: Request) {
      const attempt = async (body: ArrayBuffer | null, deadline: number) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new DOMException('Database HTTP exchange timed out', 'TimeoutError')), deadline);
        const signal = AbortSignal.any([request.signal, controller.signal]);
        try {
          const response: Response = await transport(new Request(request.url, { method: request.method, headers: request.headers, body, signal }));
          const received = response.body === null ? null : await response.arrayBuffer();
          return new Response(received, { status: response.status, statusText: response.statusText, headers: response.headers });
        } finally { clearTimeout(timeout); }
      };
      const exchange = (async () => {
        const body = request.body === null ? null : await request.arrayBuffer();
        if (body === null || !isRetryableRead(new TextDecoder().decode(body))) return attempt(body, exchangeTimeoutMs);
        const started = Date.now();
        try {
          return await attempt(body, firstReadTimeoutMs);
        } catch (error) {
          if (request.signal.aborted || !(error instanceof DOMException && error.name === 'TimeoutError')) throw error;
        }
        try {
          const response = await attempt(body, retriedReadTimeoutMs);
          retried(started, true);
          return response;
        } catch (error) {
          retried(started, false);
          throw error;
        }
      })();
      waitUntil(exchange.then(() => undefined, () => undefined));
      return exchange;
    },
  });
}

function retried(started: number, recovered: boolean) {
  console.warn({ message: 'Database read retried after a timeout', service: process.env.WORKER_NAME, attempt: 2, durationMs: Date.now() - started, recovered });
}

export type { Database } from './index.ts';
