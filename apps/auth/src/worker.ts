import { authConfig, type AuthWorkerEnvironment } from '@artifacts/config';
import { openDatabase } from '@artifacts/db';
import { createAuth } from './auth-core.ts';
import { createAuthHandler } from './http-core.ts';
import { fetchClientMetadataResource, isMetadataDocumentUrlAllowed } from './metadata-worker.ts';

const runtimes = new WeakMap<AuthWorkerEnvironment, Promise<ReturnType<typeof createAuthHandler>>>();

async function createRuntime(env: AuthWorkerEnvironment) {
  const config = authConfig(env);
  const { db } = await openDatabase({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
  const auth = createAuth(db, config, { fetchClientMetadataResource, isMetadataDocumentUrlAllowed });
  await auth.$context;
  return createAuthHandler(db, config, auth);
}

export default {
  async fetch(request: Request, env: AuthWorkerEnvironment): Promise<Response> {
    let runtime = runtimes.get(env);
    if (!runtime) {
      runtime = createRuntime(env).catch((error) => { runtimes.delete(env); throw error; });
      runtimes.set(env, runtime);
    }
    try {
      return await (await runtime)(request);
    } catch {
      return new Response('Authorization unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
    }
  },
};
