import type { ClientMetadataTransport } from './auth-core.ts';

const metadataResources = new Set([
  'https://chatgpt.com/oauth/codex/client.json',
  'https://claude.ai/oauth/claude-code-client-metadata',
]);

export function isMetadataDocumentUrlAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && metadataResources.has(url.href);
  } catch {
    return false;
  }
}

export const fetchClientMetadataResource: ClientMetadataTransport['fetchClientMetadataResource'] = async (input, init) => {
  const request = new Request(input, { ...init, redirect: 'manual' });
  if (!isMetadataDocumentUrlAllowed(request.url)) throw new TypeError('CIMD resource is not approved');
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new TypeError('CIMD supports GET and HEAD only');
  const response = await fetch(request);
  if (response.status >= 300 && response.status < 400 && response.status !== 304) {
    await response.body?.cancel();
    throw new TypeError('CIMD redirects are forbidden');
  }
  return response;
};
