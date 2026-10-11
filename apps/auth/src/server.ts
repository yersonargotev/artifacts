import { serve } from '@hono/node-server';
import { authConfig, listener, required } from '@artifacts/config';
import { openDatabase } from '@artifacts/db';
import { createAuthApp } from './http.ts';

process.loadEnvFile();
const config = authConfig();
const { db } = await openDatabase({ url: required('DATABASE_URL'), authToken: process.env.DATABASE_AUTH_TOKEN });
serve({ fetch: createAuthApp(db, config), ...listener('AUTH', 4100) });
console.log(`Authorization listening at ${config.origin}`);
