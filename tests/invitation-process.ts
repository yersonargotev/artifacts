import { createRequire } from 'node:module';
import { serve } from '@hono/node-server';
import { openDatabase } from '../packages/db/src/index.ts';
import { createArtifactStore } from '../packages/artifacts/src/index.ts';
import { fileEmailSender } from '../packages/config/src/email-node.ts';
import { createArtifactRestApp, type BearerConfig } from '../packages/rest/src/index.ts';

export type InvitationProcessEvent = { actor: number; time: string; event: string; detail: Record<string, unknown> };
process.once('message', async (input: { databaseUrl: string; sink: string; config: BearerConfig; crashAfterCommit?: boolean; holdTransaction?: boolean }) => {
  const report = (event: string, detail: Record<string, unknown> = {}) => process.send!({ actor: process.pid, time: new Date().toISOString(), event, detail } satisfies InvitationProcessEvent);
  const connection = await openDatabase({ url: input.databaseUrl });
  let released = false;
  let release: (() => void) | undefined;
  process.on('message', (message: { releaseTransaction?: boolean }) => {
    if (message.releaseTransaction) { released = true; release?.(); }
  });
  const transaction = connection.client.transaction.bind(connection.client);
  connection.client.transaction = async (mode?: 'write' | 'read' | 'deferred') => {
    report('begin', { mode });
    let tx;
    try { tx = await transaction(mode); report('begin_ok'); }
    catch (error) { report('begin_failed', { code: error instanceof Error && 'code' in error ? error.code : undefined }); throw error; }
    if (input.holdTransaction && !released) {
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('The contention fixture did not release the acquired transaction')), 5000);
          release = () => { clearTimeout(timer); resolve(); };
        });
      } catch (error) { await tx.rollback(); throw error; }
    }
    for (const action of ['commit', 'rollback'] as const) {
      const operation = tx[action].bind(tx);
      tx[action] = async () => {
        report(action);
        try { await operation(); report(`${action}_ok`); }
        catch (error) { report(`${action}_failed`, { code: error instanceof Error && 'code' in error ? error.code : undefined }); throw error; }
      };
    }
    return tx;
  };
  if (input.crashAfterCommit) {
    const transaction = connection.db.transaction.bind(connection.db);
    connection.db.transaction = async <T>(work: (tx: Parameters<Parameters<typeof connection.db.transaction>[0]>[0]) => Promise<T>) => {
      const result = await transaction(work);
      if (result && typeof result === 'object' && 'fresh' in result && result.fresh) process.exit(73);
      return result;
    };
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (String(args[0]).endsWith('/oauth2/introspect')) report('introspection_response', { status: response.status });
    return response;
  };
  const store = createArtifactStore(connection.db, { publishOrigin: 'https://published.example.test', sendInvitation: fileEmailSender(input.sink) });
  const share = store.share.bind(store);
  store.share = async (actor, command) => {
    report('share_enter', { requestId: command.requestId });
    try { return await share(actor, command); }
    finally { report('share_finished', { requestId: command.requestId }); }
  };
  const handler = createArtifactRestApp(input.config, store);
  const require = createRequire(import.meta.url);
  const databaseEntry = import.meta.url.endsWith('.ts') ? new URL('../packages/db/src/index.ts', import.meta.url) : require.resolve('@artifacts/db');
  const sdk = createRequire(databaseEntry).resolve('@libsql/client');
  const wrapper = createRequire(sdk).resolve('libsql');
  const server = serve({ fetch: (request) => handler(new Request(new URL(new URL(request.url).pathname, input.config.resource), request)), hostname: '127.0.0.1', port: 0 }, (address) => report('ready', { port: address.port, sdk, wrapper }));
  process.once('SIGTERM', () => {
    if ('closeAllConnections' in server) server.closeAllConnections();
    server.close(() => { connection.client.close(); process.exit(0); });
  });
});
