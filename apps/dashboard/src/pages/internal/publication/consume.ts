import type { APIRoute } from 'astro';
import { consumeGrantSchema } from '@artifacts/artifacts/contracts';
import { getRuntime } from '../../../runtime.ts';
import { artifactErrorResponse, publicationServiceAuthorized } from '../../../publication.ts';

export const POST: APIRoute = async ({ request }) => {
  if (!publicationServiceAuthorized(request, process.env.PUBLICATION_SERVICE_SECRET)) return new Response('Access denied', { status: 403, headers: { 'cache-control': 'private, no-store' } });
  try {
    const input = consumeGrantSchema.parse(await request.json());
    return Response.json(await (await getRuntime()).artifacts.consumePublicationGrant(input));
  } catch (error) { return artifactErrorResponse(error); }
};
