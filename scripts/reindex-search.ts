import { existsSync } from 'node:fs';
import { reindexSearch } from '../packages/artifacts/src/index.ts';
import { openDatabase } from '../packages/db/src/index.ts';

if (existsSync('.env')) process.loadEnvFile();
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const { db, client } = await openDatabase({ url: process.env.DATABASE_URL, authToken: process.env.DATABASE_AUTH_TOKEN });
try {
  console.log(`Search index rebuilt for ${await reindexSearch(db)} artifacts`);
} finally {
  client.close();
}
