import type { APIRoute } from 'astro';
import { getRuntime } from '../../../runtime.ts';
import { artifactErrorResponse, publicationReadSchema } from '../../../publication.ts';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { viewer, ...input } = publicationReadSchema.parse(await request.json());
    return Response.json(await (await getRuntime()).artifacts.readPublished(viewer, input));
  } catch (error) { return artifactErrorResponse(error); }
};
