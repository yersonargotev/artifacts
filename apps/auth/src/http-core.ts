import type { Database } from '@artifacts/db';
import type { authConfig } from '@artifacts/config';
import type { Auth } from './auth-core.ts';
import { revokeUserIdentity } from './revocation.ts';
import { authPage } from './pages.ts';

export function createAuthHandler(db: Database, config: ReturnType<typeof authConfig>, auth: Auth) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.host !== new URL(config.origin).host) return new Response('Invalid host', { status: 400 });
    if (url.pathname === '/health') return Response.json({ status: 'ok' });
    if (url.pathname === '/revoke-all' && request.method === 'POST') {
      if (request.headers.get('origin') !== config.origin) return new Response('Origin denied', { status: 403 });
      const current = await auth.api.getSession({ headers: request.headers });
      if (!current) return new Response('Sign in required', { status: 401 });
      await revokeUserIdentity(db, current.user.id);
      const signedOut = await auth.api.signOut({ headers: request.headers, returnHeaders: true });
      signedOut.headers.set('location', `${config.dashboard}/?revoked=1`);
      return new Response(null, { status: 303, headers: signedOut.headers });
    }
    if (['/', '/sign-in', '/consent', '/revoke-all'].includes(url.pathname) && request.method === 'GET') {
      const current = await auth.api.getSession({ headers: request.headers });
      if (url.pathname === '/revoke-all' && !current) return Response.redirect(`${config.origin}/sign-in`, 303);
      return authPage(url, config.dashboard, current?.user.name, Boolean(config.email && config.email.transport !== 'disabled'));
    }
    if (url.pathname === '/api/auth/oauth2/register' && request.method === 'POST') {
      const body: unknown = await request.clone().json().catch(() => null);
      if (body && typeof body === 'object' && 'redirect_uris' in body && Array.isArray(body.redirect_uris) && 'token_endpoint_auth_method' in body && body.token_endpoint_auth_method === 'none' && !('application_type' in body) && body.redirect_uris.length && body.redirect_uris.every((uri: unknown) => {
        if (typeof uri !== 'string') return false;
        try { const parsed = new URL(uri); return parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) && !parsed.username && !parsed.password && !parsed.hash; } catch { return false; }
      })) {
        request = new Request(request, { body: JSON.stringify({ ...body, application_type: 'native' }), headers: { ...Object.fromEntries(request.headers), 'content-type': 'application/json' } });
      }
    }
    return auth.handler(request);
  };
}
