import { captureException, withSentry, type Breadcrumb, type CloudflareOptions, type ErrorEvent } from '@sentry/cloudflare';

export type MonitoringEnvironment = { SENTRY_DSN?: string };

const keptHeaders = new Set(['user-agent', 'cf-ray']);
const redactions: [RegExp, string][] = [
  [/(\nparams: )[\s\S]*$/, '$1[redacted]'],
  [/\b(Bearer|Basic)\s+[\w~+/=.-]+/gi, '$1 [token]'],
  [/(https?:\/\/[^\s"'<>?#]+)[?#][^\s"'<>]*/g, '$1'],
  [/\?[\w.~%-]+=[^\s"'<>]*/g, ''],
  [/[^\s"'<>()[\]{},;:@\\]+@[^\s"'<>()[\]{},;:@\\]+\.[A-Za-z]{2,}/g, '[email]'],
];

function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') return redactions.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubValue(item)]));
  return value;
}

function keepBreadcrumb(breadcrumb: Breadcrumb) {
  return breadcrumb.category !== 'console' && !Object.keys(breadcrumb.data ?? {}).some((key) => /body/i.test(key) && !key.endsWith('_size'));
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const { request, user, breadcrumbs, ...rest } = event;
  const scrubbed: ErrorEvent = { ...rest };
  if (request) {
    const headers = Object.fromEntries(Object.entries(request.headers ?? {}).filter(([name]) => keptHeaders.has(name.toLowerCase())));
    scrubbed.request = { ...(request.method ? { method: request.method } : {}), ...(request.url ? { url: request.url.replace(/[?#].*$/s, '') } : {}), headers };
  }
  if (user?.id !== undefined) scrubbed.user = { id: user.id };
  if (breadcrumbs) scrubbed.breadcrumbs = breadcrumbs.filter(keepBreadcrumb);
  return { ...(scrubValue(scrubbed) as ErrorEvent), type: undefined };
}

export function sentryOptions(service: string) {
  return (env: MonitoringEnvironment): CloudflareOptions => ({
    dsn: env.SENTRY_DSN,
    release: process.env.SENTRY_RELEASE,
    environment: 'production',
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: [...keptHeaders] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    integrations: (defaults) => defaults.filter((integration) => integration.name !== 'Console'),
    initialScope: { tags: { service } },
    beforeSend: scrubEvent,
  });
}

type ExecutionContext = { waitUntil(task: Promise<unknown>): void };
type FetchHandler<Env> = { fetch(request: Request, env: Env, context?: ExecutionContext): Promise<Response> };

export function withMonitoring<Env extends MonitoringEnvironment>(service: string, handler: FetchHandler<Env>): FetchHandler<Env> {
  const environments = new WeakMap<Request, Env>();
  const inner: FetchHandler<Env> = { fetch: (request, env, context) => handler.fetch(request, environments.get(request) ?? env, context) };
  const monitored = withSentry<Env>(sentryOptions(service), inner);
  return {
    fetch: (request, env, context) => {
      if (!env.SENTRY_DSN) return handler.fetch(request, env, context);
      environments.set(request, env);
      return monitored.fetch(request, env, context);
    },
  };
}

export function reportError(error: unknown) {
  console.error(error);
  captureException(error);
}
