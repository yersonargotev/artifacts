import type { APIRoute } from 'astro';
import { exportSchema } from '@artifacts/artifacts/contracts';
import { getRuntime } from '../../../runtime.ts';
import { artifactErrorResponse, panelActor } from '../../../publication.ts';

export const GET: APIRoute = async ({ locals, params, url }) => {
  if (!locals.identity) return new Response('Acceso denegado', { status: 401 });
  try {
    const input = exportSchema.parse({ artifactId: params.artifactId, revisionId: url.searchParams.get('revisionId') });
    const archive = await (await getRuntime()).artifacts.export(panelActor(locals.identity), input);
    return new Response(Buffer.from(archive.base64, 'base64'), { headers: { 'content-type': archive.mediaType, 'content-disposition': `attachment; filename="${archive.filename}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  } catch (error) { return artifactErrorResponse(error); }
};
