import type { APIRoute } from 'astro';
import { panelCookie, transactionCookie } from '../../identity.ts';
import { getRuntime } from '../../runtime.ts';

export const GET: APIRoute = async ({ cookies, url, redirect }) => {
  const { identity, cookieOptions } = await getRuntime();
  const name = transactionCookie(url.searchParams.get('state'));
  const transaction = name ? cookies.get(name)?.value : undefined;
  if (name) cookies.delete(name, { path: '/' });
  try {
    const session = await identity.completeLogin(url, transaction);
    cookies.set(panelCookie, session.token, { ...cookieOptions, expires: session.expiresAt });
    return redirect(session.returnPath, 303);
  } catch {
    return redirect('/?login=failed', 303);
  }
};
