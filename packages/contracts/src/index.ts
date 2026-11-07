import { z } from 'zod';

const identifier = z.string().min(1).max(128);
const requestId = z.string().min(8).max(128);
export const contentKinds = ['html', 'markdown', 'text', 'design'] as const;
const fileSchema = z.strictObject({
  path: z.string().min(1).max(240).refine((path) => path === path.normalize('NFC') && !/[:\\%\x00-\x1f\x7f]/.test(path) && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..'), 'Use a normalized relative file path'),
  mediaType: z.string().max(128).regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/),
  encoding: z.enum(['utf8', 'base64']),
  data: z.string().max(1_398_104).refine((data) => data.isWellFormed(), 'File text must contain well-formed Unicode'),
}).superRefine((file, context) => {
  if (file.encoding === 'base64' && Buffer.from(file.data, 'base64').toString('base64') !== file.data) context.addIssue({ code: 'custom', path: ['data'], message: 'Use canonical padded base64' });
});

const canvasId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Use 1 to 40 letters, digits, underscores, or hyphens').refine((id) => id !== '__proto__', 'Use an id other than __proto__');
const boardPath = z.string().regex(/^boards\/[A-Za-z0-9_][A-Za-z0-9_.-]*\.html$/, 'Use a board path such as boards/Home.html');
const coordinate = z.number().min(-1_000_000).max(1_000_000);
const extent = z.number().min(40).max(8000);
const label = z.string().min(1).max(256);

// An oversized count or a bad key aborts before any entry is parsed, so an oversized collection reports one issue.
// Keys are read from the raw object because a zod record skips a __proto__ key without checking it.
function keyed<T extends z.ZodType>(key: z.ZodType<string>, value: T, max: number, noun: string) {
  return z.unknown().superRefine((input, context) => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return;
    const keys = Object.keys(input);
    if (keys.length > max) {
      context.addIssue({ code: 'too_big', origin: 'object', maximum: max, inclusive: true, input, continue: false, message: `A canvas holds at most ${max} ${noun}` });
      return;
    }
    for (const name of keys) {
      const result = key.safeParse(name);
      if (!result.success) context.addIssue({ code: 'invalid_key', origin: 'record', issues: result.error.issues, input: name, path: [name], continue: false, message: result.error.issues[0]!.message });
    }
  }).pipe(z.record(z.string(), value));
}

export const canvasIndexSchema = z.strictObject({
  v: z.literal(1),
  boards: keyed(boardPath, z.strictObject({ x: coordinate, y: coordinate, w: extent, h: extent, title: label.optional(), page: canvasId.optional() }), 32, 'boards'),
  order: z.array(z.unknown()).min(1, 'A canvas needs at least one board').max(32, { message: 'A canvas holds at most 32 boards', abort: true }).pipe(z.array(boardPath)),
  notes: keyed(canvasId, z.strictObject({ x: coordinate, y: coordinate, text: z.string(), w: extent.optional(), page: canvasId.optional() }), 200, 'notes').optional(),
  pages: z.array(z.unknown()).max(32, { message: 'A canvas holds at most 32 pages', abort: true }).pipe(z.array(z.strictObject({ id: canvasId, name: label }))).optional(),
}).superRefine((index, context) => {
  const ordered = new Set<string>();
  index.order.forEach((path, position) => {
    if (!Object.hasOwn(index.boards, path)) context.addIssue({ code: 'custom', path: ['order', position], message: `Canvas order names ${path}, which is not a board` });
    else if (ordered.has(path)) context.addIssue({ code: 'custom', path: ['order', position], message: `Canvas order lists ${path} more than once` });
    ordered.add(path);
  });
  for (const path of Object.keys(index.boards)) if (!ordered.has(path)) context.addIssue({ code: 'custom', path: ['order'], message: `Canvas order omits board ${path}` });
  const pages = new Set<string>();
  index.pages?.forEach(({ id }, position) => {
    if (pages.has(id)) context.addIssue({ code: 'custom', path: ['pages', position, 'id'], message: `Canvas page ${id} is declared more than once` });
    pages.add(id);
  });
  for (const [path, board] of Object.entries(index.boards)) if (board.page !== undefined && !pages.has(board.page)) context.addIssue({ code: 'custom', path: ['boards', path, 'page'], message: `Canvas board ${path} names unknown page ${board.page}` });
  for (const [id, note] of Object.entries(index.notes ?? {})) if (note.page !== undefined && !pages.has(note.page)) context.addIssue({ code: 'custom', path: ['notes', id, 'page'], message: `Canvas note ${id} names unknown page ${note.page}` });
});

export const snapshotSchema = z.strictObject({
  metadata: z.strictObject({ title: z.string().min(1).max(256), description: z.string().max(8192), custom: z.json().optional() }),
  content: z.strictObject({ kind: z.enum(contentKinds), text: z.string().max(1_048_576).refine((text) => text.isWellFormed(), 'Content must contain well-formed Unicode') }),
  files: z.array(fileSchema).max(32),
}).superRefine((snapshot, context) => {
  const paths = snapshot.files.map((file) => file.path);
  if (paths.some((path, index) => paths.some((other, otherIndex) => index !== otherIndex && (path === other || other.startsWith(`${path}/`))))) context.addIssue({ code: 'custom', path: ['files'], message: 'File paths must be unique and cannot contain another file' });
  const bytes = snapshotBytes(snapshot);
  if (bytes > 1_048_576) context.addIssue({ code: 'custom', message: 'A revision must fit within 1 MiB of decoded content and metadata' });
  // A request body can reach 8 MiB, so the index of an oversized design is not parsed.
  if (snapshot.content.kind !== 'design' || bytes > 1_048_576) return;
  const canvas = readCanvas(snapshot);
  if (!canvas.success) for (const issue of canvas.issues) context.addIssue({ ...issue });
});

export function snapshotBytes(snapshot: Snapshot): number {
  return Buffer.byteLength(JSON.stringify(snapshot.metadata)) + Buffer.byteLength(snapshot.content.text) + snapshot.files.reduce((total, file) => total + Buffer.byteLength(file.path) + Buffer.byteLength(file.mediaType) + decodeFile(file).length, 0);
}

export type CanvasIndex = z.infer<typeof canvasIndexSchema>;
export type CanvasBoard = CanvasIndex['boards'][string] & { path: string; html: string };
export type Canvas = { index: CanvasIndex; boards: CanvasBoard[] };

function readCanvas({ content, files }: Pick<Snapshot, 'content' | 'files'>): { success: true; data: Canvas } | { success: false; issues: z.core.$ZodIssue[] } {
  let value: unknown;
  try {
    value = JSON.parse(content.text);
  } catch {
    return { success: false, issues: [{ code: 'custom', path: ['content', 'text'], message: 'Design content must be a canvas index in JSON' }] };
  }
  const index = canvasIndexSchema.safeParse(value);
  if (!index.success) return { success: false, issues: index.error.issues.map((issue) => ({ ...issue, path: ['content', 'text', ...issue.path] })) };
  const positions = new Map(files.map((file, position) => [file.path, position]));
  const boards: CanvasBoard[] = [];
  const issues: z.core.$ZodIssue[] = [];
  for (const path of index.data.order) {
    const position = positions.get(path);
    if (position === undefined) {
      issues.push({ code: 'custom', path: ['content', 'text', 'boards', path], message: `Canvas board ${path} has no matching file` });
      continue;
    }
    const file = files[position]!;
    if (file.mediaType !== 'text/html' || file.encoding !== 'utf8') issues.push({ code: 'custom', path: ['files', position], message: `Canvas board ${path} must be a text/html file with utf8 encoding` });
    else boards.push({ ...index.data.boards[path]!, path, html: file.data });
  }
  return issues.length ? { success: false, issues } : { success: true, data: { index: index.data, boards } };
}

export function parseCanvas(snapshot: Pick<Snapshot, 'content' | 'files'>): Canvas {
  if (snapshot.content.kind !== 'design') throw new TypeError('Only a design snapshot has a canvas');
  const canvas = readCanvas(snapshot);
  if (!canvas.success) throw new z.ZodError(canvas.issues);
  return canvas.data;
}

export const projectNameSchema = z.string().normalize('NFC').trim().min(1).max(80).refine((name) => name.isWellFormed() && !/\p{Cc}/u.test(name), 'Use a project name without control characters');
const response = z.enum(['full', 'compact']).optional();
// The .md check aborts so a file-style name gets the suffix hint instead of the generic pattern message.
export const slugSchema = z.string().min(1).max(160)
  .refine((slug) => !slug.endsWith('.md'), { message: 'Remove the .md suffix: a slug names a page, not a file', abort: true })
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*$/, 'Use lowercase kebab-case segments separated by /, such as concepts/rag');
export const createSchema = z.strictObject({ requestId, snapshot: snapshotSchema, project: projectNameSchema.optional(), slug: slugSchema.optional(), response });
export const readByIdSchema = z.strictObject({ artifactId: identifier, revisionId: identifier.optional(), response });
export const locator = { artifactId: identifier.optional(), project: projectNameSchema.optional(), slug: slugSchema.optional() };
export const locatorRule = [(input: { artifactId?: string; project?: string; slug?: string }) => (input.artifactId === undefined) !== (input.slug === undefined) && (input.project === undefined || input.slug !== undefined), 'Specify exactly one of artifactId or slug; project applies only with slug'] as const;
export const readSchema = z.strictObject({ ...locator, revisionId: identifier.optional(), response }).refine(...locatorRule);
export const updateSchema = z.strictObject({ requestId, artifactId: identifier, expectedRevisionId: identifier, snapshot: snapshotSchema, response });
export const batchOperationSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('create'), snapshot: snapshotSchema, project: createSchema.shape.project, slug: createSchema.shape.slug }),
  z.strictObject({ op: z.literal('update'), ...locator, expectedRevisionId: identifier.optional(), snapshot: snapshotSchema }).refine(...locatorRule),
  z.strictObject({ op: z.literal('move'), artifactId: identifier.optional(), from: z.strictObject({ project: projectNameSchema.optional(), slug: slugSchema }).optional(), project: projectNameSchema.nullable().optional(), slug: slugSchema.nullable().optional() })
    .refine((input) => (input.artifactId === undefined) !== (input.from === undefined), 'Specify exactly one of artifactId or from')
    .refine((input) => input.project !== undefined || input.slug !== undefined, 'Specify project, slug, or both; null clears either'),
]);
const batchCeiling = 4_194_304;
export const batchSchema = z.strictObject({ requestId, operations: z.array(batchOperationSchema).min(1).max(25) }).superRefine((batch, context) => {
  if (batch.operations.reduce((total, operation) => total + (operation.op === 'move' ? 0 : snapshotBytes(operation.snapshot)), 0) > batchCeiling) context.addIssue({ code: 'custom', path: ['operations'], message: 'A batch must fit within the 4 MiB ceiling of decoded content and metadata across its operations' });
});
export const batchResultSchema = z.strictObject({ results: z.array(z.strictObject({ index: z.number().int().nonnegative(), artifactId: identifier, revisionId: identifier })) });
export type BatchOperation = z.infer<typeof batchOperationSchema>;
export type BatchInput = z.infer<typeof batchSchema>;
export type BatchResult = z.infer<typeof batchResultSchema>;
export const publishSchema = z.strictObject({ requestId, artifactId: identifier, revisionId: identifier, expectedPublicationVersion: z.number().int().nonnegative() });
export const deleteSchema = z.strictObject({ requestId, artifactId: identifier, expectedRevisionId: identifier, expectedPublicationVersion: z.number().int().nonnegative() });
export const deleteResultSchema = z.strictObject({ artifactId: identifier });
export type DeleteInput = z.infer<typeof deleteSchema>;
export type DeleteResult = z.infer<typeof deleteResultSchema>;
export const moveSchema = z.strictObject({ requestId, artifactId: identifier, project: projectNameSchema.nullable().optional(), slug: slugSchema.nullable().optional() })
  .refine((input) => input.project !== undefined || input.slug !== undefined, 'Specify project, slug, or both; null clears either');
export const moveResultSchema = z.strictObject({ artifactId: identifier, project: z.string().nullable() });
export type MoveResult = z.infer<typeof moveResultSchema>;
export const shareSchema = z.strictObject({ requestId, artifactId: identifier, email: z.string().trim().toLowerCase().pipe(z.email().max(254)).meta({ format: 'email', description: 'Email address, trimmed and lowercased; at most 254 characters after trimming' }), notify: z.boolean().optional(), requireNew: z.literal(true).optional() });
export const unshareSchema = z.strictObject({ requestId, artifactId: identifier, shareId: identifier });
export const listSharesSchema = z.strictObject({ artifactId: identifier });
export const shareResultSchema = z.strictObject({ shareId: identifier, artifactId: identifier, kind: z.literal('email'), value: z.email(), createdAt: z.iso.datetime() });
export const notificationSchema = z.union([
  z.strictObject({ status: z.literal('requested') }),
  z.strictObject({ status: z.literal('skipped'), reason: z.literal('disabled') }),
  z.strictObject({ status: z.literal('skipped'), reason: z.literal('rate_limited'), retryAt: z.iso.datetime() }),
]);
export const shareCommandResultSchema = shareResultSchema.extend({ notification: notificationSchema.optional() });
export const unshareResultSchema = z.strictObject({ artifactId: identifier, shareId: identifier });
export type Share = z.infer<typeof shareResultSchema>;
export type ShareResult = z.infer<typeof shareCommandResultSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type UnshareResult = z.infer<typeof unshareResultSchema>;
export const exportSchema = z.strictObject({ artifactId: identifier, revisionId: identifier });
export const listSchema = z.strictObject({ limit: z.number().int().min(1).max(100).default(25), cursor: identifier.optional(), project: projectNameSchema.optional() });
export const searchSchema = z.strictObject({
  query: z.string().trim().min(1).max(256),
  project: projectNameSchema.optional(),
  limit: z.number().int().min(1).max(25).default(10),
  cursor: z.string().regex(/^\d{1,6}$/, 'Use the nextCursor from a previous search').optional(),
});
export const searchHitSchema = z.strictObject({ artifactId: identifier, project: z.string().nullable(), slug: z.string().nullable(), title: z.string(), snippet: z.string(), rank: z.number() });
export const searchResultSchema = z.strictObject({ items: z.array(searchHitSchema).max(25), nextCursor: z.string().nullable() });
export type SearchHit = z.infer<typeof searchHitSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
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
export type SharedArtifactSummary = Readonly<{ artifactId: string; title: string; ownerName: string; url: string }>;
export type ArtifactSummary = { artifactId: string; title: string; headRevisionId: string; createdAt: string; project: string | null; slug: string | null; publication: Publication | null };
export type ProjectSummary = { name: string; artifactCount: number };
export type ArtifactLibraryQuery = z.infer<typeof libraryQuerySchema>;
export type ArtifactLibraryPage = {
  items: ArtifactSummary[];
  nextCursor: string | null;
  counts: { all: number; published: number; unpublished: number; pending: number };
};
export type Archive = { filename: string; mediaType: 'application/zip'; base64: string; sha256: string };
export type ArtifactErrorCode = 'forbidden' | 'not_found' | 'conflict' | 'request_conflict' | 'slug_conflict' | 'invalid_grant';
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
export const artifactReadSchema = z.strictObject({ artifactId: identifier, ownerId: identifier, headRevisionId: identifier, project: z.string().nullable(), slug: z.string().nullable(), publication: publicationSchema.nullable(), revision: revisionSchema });
export const sharedReadSchema = z.strictObject({ artifactId: identifier, ownerName: z.string().default('Usuario de Artifacts'), publication: publicationSchema, revision: revisionSchema.pick({ id: true, createdAt: true, sha256: true, snapshot: true }) });
export const publishResultSchema = publicationSchema.extend({ artifactId: identifier });
