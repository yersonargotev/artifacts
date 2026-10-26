import { z } from 'zod';

const identifier = z.string().min(1).max(128);
const requestId = z.string().min(8).max(128);
const fileSchema = z.strictObject({
  path: z.string().min(1).max(240).refine((path) => path === path.normalize('NFC') && !/[:\\%\x00-\x1f\x7f]/.test(path) && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..'), 'Use a normalized relative file path'),
  mediaType: z.string().max(128).regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/),
  encoding: z.enum(['utf8', 'base64']),
  data: z.string().max(1_398_104).refine((data) => data.isWellFormed(), 'File text must contain well-formed Unicode'),
}).superRefine((file, context) => {
  if (file.encoding === 'base64' && Buffer.from(file.data, 'base64').toString('base64') !== file.data) context.addIssue({ code: 'custom', path: ['data'], message: 'Use canonical padded base64' });
});

export const snapshotSchema = z.strictObject({
  metadata: z.strictObject({ title: z.string().min(1).max(256), description: z.string().max(8192), custom: z.json().optional() }),
  content: z.strictObject({ kind: z.enum(['html', 'markdown', 'text']), text: z.string().max(1_048_576).refine((text) => text.isWellFormed(), 'Content must contain well-formed Unicode') }),
  files: z.array(fileSchema).max(32),
}).superRefine((snapshot, context) => {
  const paths = snapshot.files.map((file) => file.path);
  if (paths.some((path, index) => paths.some((other, otherIndex) => index !== otherIndex && (path === other || other.startsWith(`${path}/`))))) context.addIssue({ code: 'custom', path: ['files'], message: 'File paths must be unique and cannot contain another file' });
  const bytes = Buffer.byteLength(JSON.stringify(snapshot.metadata)) + Buffer.byteLength(snapshot.content.text) + snapshot.files.reduce((total, file) => total + Buffer.byteLength(file.path) + Buffer.byteLength(file.mediaType) + decodeFile(file).length, 0);
  if (bytes > 1_048_576) context.addIssue({ code: 'custom', message: 'A revision must fit within 1 MiB of decoded content and metadata' });
});

export const projectNameSchema = z.string().normalize('NFC').trim().min(1).max(80).refine((name) => name.isWellFormed() && !/\p{Cc}/u.test(name), 'Use a project name without control characters');
const response = z.enum(['full', 'compact']).optional();
export const createSchema = z.strictObject({ requestId, snapshot: snapshotSchema, project: projectNameSchema.optional(), response });
export const readSchema = z.strictObject({ artifactId: identifier, revisionId: identifier.optional(), response });
export const updateSchema = z.strictObject({ requestId, artifactId: identifier, expectedRevisionId: identifier, snapshot: snapshotSchema, response });
export const publishSchema = z.strictObject({ requestId, artifactId: identifier, revisionId: identifier, expectedPublicationVersion: z.number().int().nonnegative() });
export const deleteSchema = z.strictObject({ requestId, artifactId: identifier, expectedRevisionId: identifier, expectedPublicationVersion: z.number().int().nonnegative() });
export const deleteResultSchema = z.strictObject({ artifactId: identifier });
export type DeleteInput = z.infer<typeof deleteSchema>;
export type DeleteResult = z.infer<typeof deleteResultSchema>;
export const moveSchema = z.strictObject({ requestId, artifactId: identifier, project: projectNameSchema.nullable() });
export const moveResultSchema = z.strictObject({ artifactId: identifier, project: z.string().nullable() });
export type MoveResult = z.infer<typeof moveResultSchema>;
export const shareSchema = z.strictObject({ requestId, artifactId: identifier, email: z.string().trim().toLowerCase().pipe(z.email().max(254)).meta({ format: 'email', description: 'Email address, trimmed and lowercased; at most 254 characters after trimming' }) });
export const unshareSchema = z.strictObject({ requestId, artifactId: identifier, shareId: identifier });
export const listSharesSchema = z.strictObject({ artifactId: identifier });
export const shareResultSchema = z.strictObject({ shareId: identifier, artifactId: identifier, kind: z.literal('email'), value: z.email(), createdAt: z.iso.datetime() });
export const unshareResultSchema = z.strictObject({ artifactId: identifier, shareId: identifier });
export type Share = z.infer<typeof shareResultSchema>;
export type UnshareResult = z.infer<typeof unshareResultSchema>;
export const exportSchema = z.strictObject({ artifactId: identifier, revisionId: identifier });
export const listSchema = z.strictObject({ limit: z.number().int().min(1).max(100).default(25), cursor: identifier.optional(), project: projectNameSchema.optional() });
export const libraryQuerySchema = z.strictObject({
  q: z.string().trim().max(256).default(''),
  status: z.enum(['all', 'published', 'unpublished', 'pending']).default('all'),
  project: projectNameSchema.optional(),
  cursor: identifier.optional(),
});
export const historySchema = z.strictObject({ artifactId: identifier, limit: z.number().int().min(1).max(10).default(5), beforeSequence: z.number().int().positive().optional(), response: z.enum(['full', 'summary']).optional() });
export const issueGrantSchema = z.strictObject({ artifactId: identifier, state: z.string().min(16).max(256) });
export const consumeGrantSchema = issueGrantSchema.extend({ code: z.string().min(32).max(128) });
export const viewerSchema = z.strictObject({ artifactId: identifier, userId: identifier, sessionId: identifier, expiresAt: z.number().int().positive() });

export type Snapshot = z.infer<typeof snapshotSchema>;
export type ReadonlyJsonValue = string | number | boolean | null | { readonly [key: string]: ReadonlyJsonValue } | readonly ReadonlyJsonValue[];
export type UpdateInput = {
  readonly requestId: string;
  readonly artifactId: string;
  readonly expectedRevisionId: string;
  readonly snapshot: {
    readonly metadata: { readonly title: string; readonly description: string; readonly custom?: ReadonlyJsonValue };
    readonly content: Readonly<Snapshot['content']>;
    readonly files: readonly Readonly<Snapshot['files'][number]>[];
  };
  readonly response?: 'full' | 'compact';
};
export type Actor = Readonly<{ userId: string; sessionId: string; clientId: string; scopes: readonly string[] }>;
export type Viewer = z.infer<typeof viewerSchema>;
export type Publication = z.infer<typeof publicationSchema>;
export type Revision = z.infer<typeof revisionSchema>;
export type ArtifactRead = z.infer<typeof artifactReadSchema>;
export type SharedRead = z.infer<typeof sharedReadSchema>;
export type ArtifactSummary = { artifactId: string; title: string; headRevisionId: string; createdAt: string; project: string | null; publication: Publication | null };
export type ProjectSummary = { name: string; artifactCount: number };
export type ArtifactLibraryQuery = z.infer<typeof libraryQuerySchema>;
export type ArtifactLibraryPage = {
  items: ArtifactSummary[];
  nextCursor: string | null;
  counts: { all: number; published: number; unpublished: number; pending: number };
};
export type Archive = { filename: string; mediaType: 'application/zip'; base64: string; sha256: string };
export type ArtifactErrorCode = 'forbidden' | 'not_found' | 'conflict' | 'request_conflict' | 'invalid_grant';
export class ArtifactError extends Error {
  readonly code: ArtifactErrorCode;
  readonly details: Record<string, unknown>;
  constructor(code: ArtifactErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function decodeFile(file: { encoding: 'utf8' | 'base64'; data: string }): Uint8Array {
  return Buffer.from(file.data, file.encoding === 'utf8' ? 'utf8' : 'base64');
}

export const publicationSchema = z.strictObject({ revisionId: identifier, version: z.number().int().positive(), url: z.url() });
export const revisionSchema = z.strictObject({ id: identifier, parentRevisionId: identifier.nullable(), sequence: z.number().int().positive(), authorUserId: identifier, authorClientId: identifier, createdAt: z.iso.datetime(), sha256: z.string().regex(/^[a-f0-9]{64}$/), snapshot: snapshotSchema });
export const artifactReadSchema = z.strictObject({ artifactId: identifier, ownerId: identifier, headRevisionId: identifier, project: z.string().nullable(), publication: publicationSchema.nullable(), revision: revisionSchema });
export const sharedReadSchema = z.strictObject({ artifactId: identifier, publication: publicationSchema, revision: revisionSchema.pick({ id: true, createdAt: true, sha256: true, snapshot: true }) });
export const publishResultSchema = publicationSchema.extend({ artifactId: identifier });
