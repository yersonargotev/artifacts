import type { APIRoute } from 'astro';
import { getRuntime } from '../../../runtime.ts';
import { artifactErrorResponse, publicationReadSchema, publicationServiceAuthorized } from '../../../publication.ts';

export const POST: APIRoute = async ({ request }) => {
  if (!publicationServiceAuthorized(request, process.env.PUBLICATION_SERVICE_SECRET)) return new Response('Access denied', { status: 403, headers: { 'cache-control': 'private, no-store' } });
  try {
    const { viewer, ...input } = publicationReadSchema.parse(await request.json());
    return Response.json(await (await getRuntime()).artifacts.readPublished(viewer, input));
  } catch (error) { return artifactErrorResponse(error); }
};
