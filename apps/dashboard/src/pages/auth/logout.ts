import type { APIRoute } from 'astro';
import { panelCookie } from '../../identity.ts';
import { getRuntime } from '../../runtime.ts';

export const POST: APIRoute = async ({ cookies, redirect }) => {
  const { identity } = await getRuntime();
  await identity.logout(cookies.get(panelCookie)?.value);
  cookies.delete(panelCookie, { path: '/' });
  return redirect('/', 303);
};
