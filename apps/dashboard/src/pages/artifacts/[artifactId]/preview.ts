import type { APIRoute } from 'astro';
import { exportSchema } from '@yargote/artifacts-contracts';
import { getRuntime } from '../../../runtime.ts';
import { artifactErrorResponse, panelActor } from '../../../publication.ts';
import { framedPreviewError, previewResponse } from '../../../preview.ts';

export const GET: APIRoute = async ({ locals, params, url, request }) => {
  if (!locals.identity) return framedPreviewError(new Response('Acceso denegado', { status: 401 }));
  if (request.headers.get('sec-fetch-dest') !== 'iframe') return framedPreviewError(new Response('La vista previa solo está disponible dentro del panel.', { status: 403 }));
  try {
    const input = exportSchema.parse({ artifactId: params.artifactId, revisionId: url.searchParams.get('revisionId') });
    const preview = await (await getRuntime()).panel.preview(panelActor(locals.identity), input);
    return previewResponse(preview, request.headers.get('user-agent'));
  } catch (error) { return framedPreviewError(artifactErrorResponse(error)); }
};
