import { serve } from '@hono/node-server';
import { authConfig, listener, required } from '@artifacts/config';
import { openDatabase } from '@artifacts/db';
import { createAuthApp } from './http.ts';

process.loadEnvFile();
const config = authConfig();
const { db, client } = await openDatabase({ url: required('DATABASE_URL'), authToken: process.env.DATABASE_AUTH_TOKEN });
const app = createAuthApp(db, config);
const server = serve({ fetch: app, ...listener('AUTH', 4100) });
async function shutdown() {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await app.drain();
  client.close();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
console.log(`Authorization listening at ${config.origin}`);
