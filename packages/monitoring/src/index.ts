import { captureException, withSentry, type Breadcrumb, type CloudflareOptions, type ErrorEvent } from '@sentry/cloudflare';

export type MonitoringEnvironment = { SENTRY_DSN?: string };

const keptHeaders = new Set(['user-agent', 'cf-ray']);
const emailAddress = /[^\s"'<>()[\]{},;:@\\]+@[^\s"'<>()[\]{},;:@\\]+\.[A-Za-z]{2,}/g;
const urlQuery = /(https?:\/\/[^\s"'?#]+)[?#][^\s"']*/g;

function withoutQuery(url: string) {
  return url.replace(/[?#].*$/s, '');
}

function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  const data = breadcrumb.data;
  if (!data) return breadcrumb;
  if (Object.keys(data).some((key) => /body/i.test(key) && !key.endsWith('_size'))) return null;
  return { ...breadcrumb, data: typeof data.url === 'string' ? { ...data, url: withoutQuery(data.url) } : data };
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const { request, user, breadcrumbs, ...rest } = event;
  const scrubbed: ErrorEvent = { ...rest };
  if (request) {
    const headers = Object.fromEntries(Object.entries(request.headers ?? {}).filter(([name]) => keptHeaders.has(name.toLowerCase())));
    scrubbed.request = { ...(request.method ? { method: request.method } : {}), ...(request.url ? { url: withoutQuery(request.url) } : {}), headers };
  }
  if (user?.id !== undefined) scrubbed.user = { id: user.id };
  if (breadcrumbs) scrubbed.breadcrumbs = breadcrumbs.map(scrubBreadcrumb).filter((breadcrumb) => breadcrumb !== null);
  return JSON.parse(JSON.stringify(scrubbed).replace(urlQuery, '$1').replace(emailAddress, '[email]'));
}

export function sentryOptions(service: string) {
  return (env: MonitoringEnvironment): CloudflareOptions => ({
    dsn: env.SENTRY_DSN,
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
    tracesSampleRate: 0,
    initialScope: { tags: { service } },
    beforeSend: scrubEvent,
  });
}

type ExecutionContext = { waitUntil(task: Promise<unknown>): void };
type FetchHandler<Env> = { fetch(request: Request, env: Env, context?: ExecutionContext): Promise<Response> };

export function withMonitoring<Env extends MonitoringEnvironment>(service: string, handler: FetchHandler<Env>): FetchHandler<Env> {
  const monitored = withSentry<Env>(sentryOptions(service), { fetch: handler.fetch });
  return { fetch: (request, env, context) => env.SENTRY_DSN ? monitored.fetch(request, env, context) : handler.fetch(request, env, context) };
}

export function reportError(error: unknown) {
  console.error(error);
  captureException(error);
}
