import { foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex, type SQLiteTableExtraConfigValue } from 'drizzle-orm/sqlite-core';
import { session, user } from './auth-schema.ts';

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
  returnPath: text('return_path').notNull().default('/'),
  verifier: text('verifier').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
});

export const artifact = sqliteTable('artifact', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  headRevisionId: text('head_revision_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  project: text('project'),
}, (table): SQLiteTableExtraConfigValue[] => [
  index('artifact_owner_idx').on(table.ownerId, table.id),
  index('artifact_owner_project_idx').on(table.ownerId, table.project),
  foreignKey({ columns: [table.id, table.headRevisionId], foreignColumns: [artifactRevision.artifactId, artifactRevision.id], name: 'artifact_head_membership_fk' }),
]);

export const artifactRevision = sqliteTable('artifact_revision', {
  id: text('id').primaryKey(),
  artifactId: text('artifact_id').notNull().references(() => artifact.id, { onDelete: 'cascade' }),
  parentRevisionId: text('parent_revision_id'),
  sequence: integer('sequence').notNull(),
  authorUserId: text('author_user_id').notNull().references(() => user.id),
  authorClientId: text('author_client_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  sha256: text('sha256').notNull(),
  snapshot: text('snapshot').notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  uniqueIndex('artifact_revision_membership_idx').on(table.artifactId, table.id),
  uniqueIndex('artifact_revision_sequence_idx').on(table.artifactId, table.sequence),
  foreignKey({ columns: [table.artifactId, table.parentRevisionId], foreignColumns: [table.artifactId, table.id], name: 'artifact_parent_membership_fk' }),
]);

export const artifactPublication = sqliteTable('artifact_publication', {
  artifactId: text('artifact_id').primaryKey().references(() => artifact.id, { onDelete: 'cascade' }),
  revisionId: text('revision_id').notNull(),
  version: integer('version').notNull(),
}, (table) => [foreignKey({ columns: [table.artifactId, table.revisionId], foreignColumns: [artifactRevision.artifactId, artifactRevision.id], name: 'artifact_publication_membership_fk' })]);

export const artifactShare = sqliteTable('artifact_share', {
  id: text('id').primaryKey(),
  artifactId: text('artifact_id').notNull().references(() => artifact.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['email'] }).notNull(),
  value: text('value').notNull(),
  createdBy: text('created_by').notNull().references(() => user.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  uniqueIndex('artifact_share_value_idx').on(table.artifactId, table.kind, table.value),
  index('artifact_share_recipient_idx').on(table.kind, table.value),
]);

export const artifactCommand = sqliteTable('artifact_command', {
  ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  requestId: text('request_id').notNull(),
  payloadHash: text('payload_hash').notNull(),
  result: text('result').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [primaryKey({ columns: [table.ownerId, table.requestId] })]);

export const publicationGrant = sqliteTable('publication_grant', {
  codeHash: text('code_hash').primaryKey(),
  state: text('state').notNull(),
  artifactId: text('artifact_id').notNull().references(() => artifact.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull().references(() => session.id, { onDelete: 'cascade' }),
  callback: text('callback').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
});
