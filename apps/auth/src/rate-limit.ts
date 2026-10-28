import { sql } from 'drizzle-orm';
import type { Database } from '@artifacts/db';

export function authRateStorage(db: Database) {
  return {
    async consume(value: string, rule: { window: number; max: number }) {
      const key = `artifacts:auth-rate:${value}`;
      const window = rule.window * 1000;
      const now = sql`cast(unixepoch('subsecond') * 1000 as integer)`;
      const accepted = await db.all<{ count: number }>(sql`
        INSERT INTO verification (id, identifier, value, created_at, updated_at, expires_at)
        VALUES (${key}, ${key}, '1', ${now}, ${now}, ${now} + max(${window}, 604800000))
        ON CONFLICT (id) DO UPDATE SET
          value = CASE WHEN updated_at <= ${now} - ${window} THEN '1' ELSE cast(cast(value as integer) + 1 as text) END,
          updated_at = ${now}, expires_at = ${now} + max(${window}, 604800000)
        WHERE updated_at <= ${now} - ${window} OR cast(value as integer) < ${rule.max}
        RETURNING cast(value as integer) AS count
      `);
      if (accepted.length) return { allowed: true, retryAfter: null };
      const [remaining] = await db.all<{ seconds: number }>(sql`SELECT max(1, cast((updated_at + ${window} - ${now} + 999) / 1000 as integer)) AS seconds FROM verification WHERE id = ${key}`);
      return { allowed: false, retryAfter: remaining?.seconds ?? rule.window };
    },
  };
}
