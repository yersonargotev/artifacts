import type { APIRoute } from 'astro';
import { exportSchema } from '@artifacts/artifacts/contracts';
import { previewPolicy, previewDocument } from '../../../../../publication/src/document.ts';
import { getRuntime } from '../../../runtime.ts';
import { artifactErrorResponse, panelActor } from '../../../publication.ts';

export const GET: APIRoute = async ({ locals, params, url }) => {
  if (!locals.identity) return new Response('Acceso denegado', { status: 401 });
  try {
    const input = exportSchema.parse({ artifactId: params.artifactId, revisionId: url.searchParams.get('revisionId') });
    const artifact = await (await getRuntime()).artifacts.read(panelActor(locals.identity), input);
    return new Response(previewDocument(artifact), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'content-security-policy': previewPolicy } });
  } catch (error) { return artifactErrorResponse(error); }
};
