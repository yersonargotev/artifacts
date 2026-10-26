import { AsyncLocalStorage } from 'node:async_hooks';
import { getIP } from 'better-auth/api';

const ipHeader = 'x-artifacts-client-ip';
type EmailCodeRequest = { ip: string; schedule: (task: Promise<void>) => void };
const requests = new AsyncLocalStorage<EmailCodeRequest>();

export function withEmailCodeRequest<T>(request: Request, address: string | undefined, schedule: EmailCodeRequest['schedule'], handle: (request: Request) => T): T {
  const headers = new Headers(request.headers);
  headers.delete(ipHeader);
  if (address) headers.set(ipHeader, address);
  const ip = address ? getIP(headers, { advanced: { ipAddress: { ipAddressHeaders: [ipHeader], ipv6Subnet: 64 } } }) : null;
  return requests.run({ ip: ip ?? 'no-trusted-ip', schedule }, () => handle(new Request(request, { headers })));
}

export function emailCodeIp() { return requests.getStore()?.ip ?? 'no-trusted-ip'; }

export async function deliverEmailCode(task: () => Promise<void>) {
  const scope = requests.getStore();
  const work = async () => {
    try { await task(); } catch { console.error('Email code delivery failed'); }
  };
  if (!scope) { await work(); return; }
  const tracked = Promise.withResolvers<void>();
  scope.schedule(tracked.promise);
  void work().then(tracked.resolve, tracked.reject);
}
