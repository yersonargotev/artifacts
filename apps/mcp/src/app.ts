import type { mcpConfig } from '@artifacts/config';
import type { ArtifactStore } from '@artifacts/artifacts';
import { createArtifactRestApp } from '@artifacts/rest';
import { restBase } from '@yargote/artifacts-contracts/http';
import { createMcpApp } from './http.ts';

export function createResourceApp(config: ReturnType<typeof mcpConfig>, artifacts: ArtifactStore) {
  const mcp = createMcpApp(config, artifacts);
  const rest = createArtifactRestApp(config, artifacts);
  const base = new URL(restBase(config.resource)).pathname;
  return (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    return path === base || path.startsWith(`${base}/`) ? rest(request) : mcp(request);
  };
}
