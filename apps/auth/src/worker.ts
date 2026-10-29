import { authConfig, type AuthWorkerEnvironment } from '@artifacts/config';
import { resendEmailSender, type EmailEnvironment } from '@artifacts/config/email';
import { withEmailCodeRequest } from './email-code-context.ts';
import { openDatabase } from '@artifacts/db';
import { createAuth } from './auth-core.ts';
import { createAuthHandler } from './http-core.ts';
import { fetchClientMetadataResource, isMetadataDocumentUrlAllowed } from './metadata-worker.ts';

type AuthRuntimeEnvironment = AuthWorkerEnvironment & EmailEnvironment;
const runtimes = new WeakMap<AuthRuntimeEnvironment, ReturnType<typeof createRuntime>>();

async function createRuntime(env: AuthRuntimeEnvironment) {
  const config = authConfig(env);
  if (config.email?.transport === 'file') throw new Error('File email delivery is only available in Node');
  const { db } = await openDatabase({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
  const sender = config.email?.transport === 'resend' ? resendEmailSender(config.email) : undefined;
  const auth = createAuth(db, config, { fetchClientMetadataResource, isMetadataDocumentUrlAllowed }, false, sender);
  await auth.$context;
  return { handler: createAuthHandler(db, config, auth), emailEnabled: Boolean(sender) };
}

export default {
  async fetch(request: Request, env: AuthRuntimeEnvironment, context?: { waitUntil(task: Promise<void>): void }): Promise<Response> {
    let runtime = runtimes.get(env);
    if (!runtime) {
      runtime = createRuntime(env).catch((error) => { runtimes.delete(env); throw error; });
      runtimes.set(env, runtime);
    }
    context?.waitUntil(runtime.then(() => undefined, () => undefined));
    try {
      const current = await runtime;
      if (current.emailEnabled && !context) throw new Error('Email delivery requires a request execution context');
      return await withEmailCodeRequest(request, request.headers.get('cf-connecting-ip') ?? undefined, (task) => context!.waitUntil(task), current.handler);
    } catch {
      return new Response('Authorization unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
    }
  },
};
