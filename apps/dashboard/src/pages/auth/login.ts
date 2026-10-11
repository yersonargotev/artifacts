import type { APIRoute } from 'astro';
import { transactionCookie } from '../../identity.ts';
import { getRuntime } from '../../runtime.ts';

export const GET: APIRoute = async ({ cookies, url, redirect }) => {
  const { identity, cookieOptions } = await getRuntime();
  const login = await identity.startLogin(url.searchParams.get('returnTo') ?? '/');
  cookies.set(transactionCookie, login.token, { ...cookieOptions, maxAge: 600 });
  return redirect(login.url.toString(), 303);
};
