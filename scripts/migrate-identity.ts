import { readFile } from 'node:fs/promises';
import { parseArgs, parseEnv } from 'node:util';
import { createClient, type Config, type Transaction, type Value } from '@libsql/client';

export type Snapshot = {
  tables: { name: string; columns: string[]; rows: Value[][] }[];
};

function identifier(name: string) {
  return `"${name.replaceAll('"', '""')}"`;
}

function rowKey(row: Value[]) {
  return JSON.stringify(row.map((value) => {
    if (value instanceof ArrayBuffer) return ['blob', Buffer.from(value).toString('base64')];
    if (typeof value === 'bigint') return ['integer', value.toString()];
    if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : value.toString()];
    return [typeof value, value];
  }));
}

function rowCounts(rows: Value[][]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = rowKey(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

async function readTable(transaction: Transaction, name: string) {
  const result = await transaction.execute(`SELECT * FROM ${identifier(name)}`);
  return { name, columns: result.columns, rows: result.rows.map((row) => result.columns.map((_, index) => row[index])) };
}

async function readSnapshot(transaction: Transaction): Promise<Snapshot> {
  const tables = await transaction.execute("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name <> '__drizzle_migrations' ORDER BY name");
  const snapshot: Snapshot = { tables: [] };
  for (const table of tables.rows) snapshot.tables.push(await readTable(transaction, String(table.name)));
  return snapshot;
}

function missingRows(source: Snapshot['tables'][number], target: Snapshot['tables'][number]) {
  if (source.columns.length !== target.columns.length || source.columns.some((column, index) => column !== target.columns[index])) {
    throw new Error(`Target schema differs for table ${source.name}`);
  }
  const remaining = rowCounts(source.rows);
  for (const row of target.rows) {
    const key = rowKey(row);
    const count = remaining.get(key) ?? 0;
    if (count === 0) throw new Error(`Target contains conflicting data in table ${source.name}`);
    remaining.set(key, count - 1);
  }
  return source.rows.filter((row) => {
    const key = rowKey(row);
    const count = remaining.get(key) ?? 0;
    if (count === 0) return false;
    remaining.set(key, count - 1);
    return true;
  });
}

export async function migrateIdentity(sourceConfig: Config, targetConfig: Config) {
  if (sourceConfig.url === targetConfig.url) throw new Error('Source and target databases must be different');
  const source = createClient({ ...sourceConfig, intMode: 'bigint' });
  try {
    const read = await source.transaction('read');
    let snapshot: Snapshot;
    try {
      snapshot = await readSnapshot(read);
      await read.commit();
    } finally {
      read.close();
    }
    if (snapshot.tables.length === 0) throw new Error('Source has no application tables');

    const target = createClient({ ...targetConfig, intMode: 'bigint' });
    try {
      await target.execute('PRAGMA foreign_keys = ON');
      const write = await target.transaction('write');
      try {
        if (Number((await write.execute('PRAGMA foreign_keys')).rows[0]?.foreign_keys) !== 1) {
          throw new Error('Target must enforce foreign keys');
        }
        await write.execute('PRAGMA defer_foreign_keys = ON');
        if (Number((await write.execute('PRAGMA defer_foreign_keys')).rows[0]?.defer_foreign_keys) !== 1) {
          throw new Error('Target must support deferred foreign keys');
        }
        const tables = [];
        for (const table of snapshot.tables) {
          const rows = missingRows(table, await readTable(write, table.name));
          const sql = `INSERT INTO ${identifier(table.name)} (${table.columns.map(identifier).join(', ')}) VALUES (${table.columns.map(() => '?').join(', ')})`;
          if (rows.length !== 0) await write.batch(rows.map((args) => ({ sql, args })));
          tables.push({ name: table.name, rows: table.rows.length, inserted: rows.length });
        }
        for (const table of snapshot.tables) {
          const copied = await readTable(write, table.name);
          if (copied.rows.length !== table.rows.length || missingRows(table, copied).length !== 0) {
            throw new Error(`Target verification failed for table ${table.name}`);
          }
        }
        if ((await write.execute('PRAGMA foreign_key_check')).rows.length !== 0) {
          throw new Error('Target foreign key verification failed');
        }
        await write.commit();
        return { tables };
      } catch (error) {
        if (!write.closed) await write.rollback();
        throw error;
      } finally {
        write.close();
      }
    } finally {
      target.close();
    }
  } finally {
    source.close();
  }
}

async function databaseConfig(envFile: string): Promise<Config> {
  const env = parseEnv(await readFile(envFile, 'utf8'));
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required in each environment file');
  return { url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN || undefined };
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({ options: { 'source-env': { type: 'string' }, 'target-env': { type: 'string' } } });
    if (!values['source-env'] || !values['target-env']) {
      throw new Error('Usage: tsx scripts/migrate-identity.ts --source-env .env --target-env .env.turso');
    }
    const source = await databaseConfig(values['source-env']);
    const target = await databaseConfig(values['target-env']);
    const result = await migrateIdentity(source, target);
    console.log(`Identity migration verified ${result.tables.length} tables and ${result.tables.reduce((count, table) => count + table.rows, 0)} rows.`);
  } catch {
    console.error('Identity migration failed. Use --source-env and --target-env with compatible databases and no conflicting target rows.');
    process.exitCode = 1;
  }
}
