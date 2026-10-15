import { defineMiddleware } from 'astro:middleware';
import { serviceUrl } from '@artifacts/config';
import { panelCookie } from './identity.ts';
import { getRuntime } from './runtime.ts';
import { publicationServiceAuthorized, servicePaths } from './publication.ts';

export const onRequest = defineMiddleware(async (context, next) => {
  try {
    if (servicePaths.has(context.url.pathname)) {
      if (!publicationServiceAuthorized(context.request, process.env.PUBLICATION_SERVICE_SECRET)) return new Response('Access denied', { status: 403, headers: { 'cache-control': 'private, no-store' } });
      if (context.url.origin !== serviceUrl('DASHBOARD_URL')) return new Response('Invalid host', { status: 400 });
      const response = await next();
      response.headers.set('cache-control', 'private, no-store');
      response.headers.set('x-content-type-options', 'nosniff');
      return response;
    }
    const { config, identity } = await getRuntime();
    if (context.url.host !== new URL(config.origin).host) return new Response('Invalid host', { status: 400 });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(context.request.method) && context.request.headers.get('origin') !== config.origin) return new Response('Origin denied', { status: 403 });
    const token = context.cookies.get(panelCookie)?.value;
    context.locals.identity = await identity.load(token);
    if (token && !context.locals.identity) context.cookies.delete(panelCookie, { path: '/' });
    const response = await next();
    response.headers.set('cache-control', 'no-store');
    response.headers.set('referrer-policy', 'same-origin');
    response.headers.set('x-content-type-options', 'nosniff');
    response.headers.set('cross-origin-opener-policy', 'same-origin');
    if (!response.headers.has('content-security-policy')) response.headers.set('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    return response;
  } catch {
    return new Response('El servicio no está disponible. Inténtalo de nuevo.', { status: 503, headers: { 'cache-control': 'no-store' } });
  }
});
