import type { APIRoute } from 'astro';
import { exportSchema } from '@artifacts/artifacts/contracts';
import { inertPreviewPolicy, previewPolicy, previewDocument, supportsInteractiveHtml } from '../../../../../publication/src/document.ts';
import { getRuntime } from '../../../runtime.ts';
import { artifactErrorResponse, panelActor } from '../../../publication.ts';

export const GET: APIRoute = async ({ locals, params, url, request }) => {
  if (!locals.identity) return new Response('Acceso denegado', { status: 401 });
  if (request.headers.get('sec-fetch-dest') !== 'iframe') return new Response('La vista previa solo está disponible dentro del panel.', { status: 403 });
  try {
    const input = exportSchema.parse({ artifactId: params.artifactId, revisionId: url.searchParams.get('revisionId') });
    const artifact = await (await getRuntime()).artifacts.read(panelActor(locals.identity), input);
    const interactive = supportsInteractiveHtml(request.headers.get('user-agent'));
    return new Response(previewDocument(artifact, interactive), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'content-security-policy': interactive ? previewPolicy : inertPreviewPolicy, 'connection-allowlist': '()', 'x-dns-prefetch-control': 'off', vary: 'User-Agent' } });
  } catch (error) { return artifactErrorResponse(error); }
};
