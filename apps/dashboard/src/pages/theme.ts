import type { APIRoute } from 'astro';
import { readForm } from '../form.ts';
import { localReturnPath } from '../identity.ts';
import { getRuntime } from '../runtime.ts';
import { isTheme, themeCookie } from '../theme.ts';

export const POST: APIRoute = async ({ cookies, request, redirect }) => {
  const fields = await readForm(request, { theme: [1, 1], return: [1, 1] }, 4096);
  const theme = fields?.get('theme');
  if (!fields || !isTheme(theme)) return new Response('Solicitud no válida.', { status: 400 });
  const { config } = await getRuntime();
  let target = '/';
  try { target = localReturnPath(fields.get('return')!, config.origin); } catch {}
  cookies.set(themeCookie, theme, { path: '/', maxAge: 31_536_000, sameSite: 'lax', secure: config.origin.startsWith('https:') });
  return redirect(target, 303);
};
