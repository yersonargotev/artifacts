import { createClient, type Config } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.ts';

export async function openDatabase(config: Config) {
  const client = createClient(config);
  await client.execute('PRAGMA foreign_keys = ON');
  const result = await client.execute('PRAGMA foreign_keys');
  if (Number(result.rows[0]?.foreign_keys) !== 1) {
    client.close();
    throw new Error('Database must enforce foreign keys');
  }
  return { client, db: drizzle(client, { schema }) };
}

export type Database = Awaited<ReturnType<typeof openDatabase>>['db'];
