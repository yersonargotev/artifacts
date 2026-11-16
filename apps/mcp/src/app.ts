import type { mcpConfig } from '@artifacts/config';
import type { ArtifactStore } from '@artifacts/artifacts';
import { createArtifactRestApp, type ReportError } from '@artifacts/rest';
import { restBase } from '@yargote/artifacts-contracts/http';
import { createMcpApp } from './http.ts';

export function createResourceApp(config: ReturnType<typeof mcpConfig>, artifacts: ArtifactStore, options: { reportError?: ReportError } = {}) {
  const mcp = createMcpApp(config, artifacts, options);
  const restResource = config.apiResource ?? config.resource;
  const rest = createArtifactRestApp({ ...config, resource: restResource }, artifacts, options);
  const base = new URL(restBase(restResource)).pathname;
  return (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    return path === base || path.startsWith(`${base}/`) || (config.apiResource && path === '/.well-known/oauth-protected-resource') ? rest(request) : mcp(request);
  };
}
