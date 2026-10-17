import { z } from 'zod';
import { artifactReadSchema, publicationSchema, revisionSchema, snapshotSchema } from './index.ts';

const identifier = z.string().min(1).max(128);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const identitySchema = z.strictObject({ userId: identifier, sessionId: identifier, clientId: identifier, scopes: z.array(z.string()) });
export type Identity = z.infer<typeof identitySchema>;
export const attachmentSummarySchema = z.strictObject({ path: z.string(), mediaType: z.string(), encoding: z.enum(['utf8', 'base64']), decodedBytes: z.number().int().nonnegative(), sha256: digest });
export const revisionSummarySchema = revisionSchema.omit({ snapshot: true }).extend({
  metadata: snapshotSchema.shape.metadata.pick({ title: true, description: true }),
  content: z.strictObject({ kind: snapshotSchema.shape.content.shape.kind, utf8Bytes: z.number().int().nonnegative() }),
  files: z.array(attachmentSummarySchema).max(32),
});
export const compactArtifactReadSchema = artifactReadSchema.omit({ revision: true }).extend({ revision: revisionSummarySchema });
export const artifactSummarySchema = z.strictObject({ artifactId: identifier, title: z.string(), headRevisionId: identifier, createdAt: z.iso.datetime(), project: z.string().nullable(), publication: publicationSchema.nullable() });
export const listResultSchema = z.strictObject({ items: z.array(artifactSummarySchema).max(100), nextCursor: identifier.nullable() });
export const projectSummarySchema = z.strictObject({ name: z.string(), artifactCount: z.number().int().positive() });
export const projectsResultSchema = z.strictObject({ items: z.array(projectSummarySchema) });
export const historyResultSchema = z.strictObject({ items: z.array(revisionSchema).max(10), nextBeforeSequence: z.number().int().positive().nullable() });
export const summaryHistoryResultSchema = historyResultSchema.extend({ items: z.array(revisionSummarySchema).max(10) });
export const httpErrorSchema = z.strictObject({ error: z.strictObject({ code: z.string().min(1), message: z.string(), details: z.record(z.string(), z.unknown()) }) });

export function canonicalResource(value: string): string {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) throw new TypeError('The server requires HTTPS, or HTTP on an exact loopback host, without credentials, query, or fragment');
  if ((url.href !== value && url.href.replace(/\/$/, '') !== value) || (url.pathname !== '/' && url.pathname.endsWith('/'))) throw new TypeError('Use the exact canonical resource URL without a trailing slash');
  return value;
}

export function protectedResourceMetadataUrl(resource: string): URL {
  const url = new URL(canonicalResource(resource));
  return new URL(`/.well-known/oauth-protected-resource${url.pathname === '/' ? '' : url.pathname}`, url.origin);
}

export function restBase(resource: string): string {
  return `${canonicalResource(resource).replace(/\/$/, '')}/v1`;
}
