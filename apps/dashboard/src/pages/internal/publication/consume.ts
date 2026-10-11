import type { APIRoute } from 'astro';
import { consumeGrantSchema } from '@artifacts/artifacts/contracts';
import { getRuntime } from '../../../runtime.ts';
import { artifactErrorResponse } from '../../../publication.ts';

export const POST: APIRoute = async ({ request }) => {
  try {
    const input = consumeGrantSchema.parse(await request.json());
    return Response.json(await (await getRuntime()).artifacts.consumePublicationGrant(input));
  } catch (error) { return artifactErrorResponse(error); }
};
