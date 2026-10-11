import type { APIRoute } from 'astro';
import { issueGrantSchema } from '@artifacts/artifacts/contracts';
import { required, serviceUrl } from '@artifacts/config';
import { getRuntime } from '../../runtime.ts';
import { artifactErrorResponse, panelActor } from '../../publication.ts';

export const GET: APIRoute = async ({ locals, url, redirect }) => {
  try {
    const input = issueGrantSchema.parse(Object.fromEntries(url.searchParams));
    if (url.searchParams.size !== 2) return new Response('Invalid publication request', { status: 400 });
    if (!locals.identity) return redirect(`/auth/login?${new URLSearchParams({ returnTo: `${url.pathname}${url.search}` })}`, 303);
    const grant = await (await getRuntime()).artifacts.issuePublicationGrant(panelActor(locals.identity), input);
    const callback = new URL('/callback', serviceUrl('PUBLISH_URL', { PUBLISH_URL: required('PUBLISH_URL') }));
    callback.search = new URLSearchParams({ ...input, code: grant.code }).toString();
    return redirect(callback.href, 303);
  } catch (error) { return artifactErrorResponse(error); }
};
