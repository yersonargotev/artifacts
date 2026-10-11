import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { openDatabase } from './index.ts';

export async function migrateDatabase(url: string, authToken?: string) {
  const connection = await openDatabase({ url, authToken });
  try {
    await migrate(connection.db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  } finally {
    connection.client.close();
  }
}

if (import.meta.main) {
  process.loadEnvFile();
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  await migrateDatabase(process.env.DATABASE_URL, process.env.DATABASE_AUTH_TOKEN);
  console.log('Database migrations applied');
}
