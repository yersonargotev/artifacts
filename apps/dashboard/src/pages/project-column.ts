import type { APIRoute } from 'astro';
import { readForm } from '../form.ts';
import { localReturnPath } from '../identity.ts';
import { getRuntime } from '../runtime.ts';
import { isProjectSort, projectColumnCookie, projectSortCookie } from '../urls.ts';

/** Without JavaScript the project column's sort and collapse buttons post here; the script writes the same cookies itself. */
export const POST: APIRoute = async ({ cookies, request, redirect }) => {
  const fields = await readForm(request, { sort: [0, 1], column: [0, 1], return: [1, 1] }, 4096);
  const sort = fields?.get('sort');
  const column = fields?.get('column');
  if (!fields || (sort === null) === (column === null) || (sort !== null && !isProjectSort(sort)) || (column !== null && column !== 'collapsed' && column !== 'expanded')) return new Response('Solicitud no válida.', { status: 400 });
  const { config } = await getRuntime();
  let target = '/';
  try { target = localReturnPath(fields.get('return')!, config.origin); } catch {}
  const options = { path: '/', maxAge: 31_536_000, sameSite: 'lax', secure: config.origin.startsWith('https:') } as const;
  if (sort) cookies.set(projectSortCookie, sort, options);
  if (column) cookies.set(projectColumnCookie, column, options);
  return redirect(target, 303);
};
