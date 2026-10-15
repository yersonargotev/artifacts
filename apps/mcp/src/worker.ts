import { mcpConfig, required, serviceUrl, type McpWorkerEnvironment } from '@artifacts/config';
import { openDatabase } from '@artifacts/db';
import { createArtifactStore } from '@artifacts/artifacts';
import { createResourceApp } from './app.ts';

const runtimes = new WeakMap<McpWorkerEnvironment, Promise<ReturnType<typeof createResourceApp>>>();

async function createRuntime(env: McpWorkerEnvironment) {
  const config = mcpConfig(env);
  const { db } = await openDatabase({ url: required('DATABASE_URL', env), authToken: env.DATABASE_AUTH_TOKEN });
  return createResourceApp(config, createArtifactStore(db, { publishOrigin: serviceUrl('PUBLISH_URL', env) }));
}

export default {
  async fetch(request: Request, env: McpWorkerEnvironment): Promise<Response> {
    let runtime = runtimes.get(env);
    if (!runtime) {
      runtime = createRuntime(env).catch((error) => { runtimes.delete(env); throw error; });
      runtimes.set(env, runtime);
    }
    try {
      return await (await runtime)(request);
    } catch {
      return new Response('MCP unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
    }
  },
};
