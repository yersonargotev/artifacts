import { defineMiddleware } from 'astro:middleware';
import { panelCookie } from './identity.ts';
import { getRuntime } from './runtime.ts';

export const onRequest = defineMiddleware(async (context, next) => {
  try {
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
    return response;
  } catch {
    return new Response('El servicio no está disponible. Inténtalo de nuevo.', { status: 503, headers: { 'cache-control': 'no-store' } });
  }
});
