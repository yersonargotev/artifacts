import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { session } from './auth-schema.ts';

export * from './auth-schema.ts';

export const panelSession = sqliteTable('panel_session', {
  tokenHash: text('token_hash').primaryKey(),
  authSessionId: text('auth_session_id').notNull().references(() => session.id, { onDelete: 'cascade' }),
  issuer: text('issuer').notNull(),
  subject: text('subject').notNull(),
  clientId: text('client_id').notNull(),
  scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [index('panel_session_auth_session_idx').on(table.authSessionId)]);

export const oidcTransaction = sqliteTable('oidc_transaction', {
  tokenHash: text('token_hash').primaryKey(),
  state: text('state').notNull().unique(),
  nonce: text('nonce').notNull(),
  verifier: text('verifier').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
});
