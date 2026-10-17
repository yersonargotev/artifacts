import { z } from 'zod';
import { artifactReadSchema, createSchema, exportSchema, historySchema, listSchema, moveResultSchema, moveSchema, publishResultSchema, publishSchema, readSchema, updateSchema, type ArtifactRead, type UpdateInput } from '@yargote/artifacts-contracts';
import { compactArtifactReadSchema, historyResultSchema, httpErrorSchema, identitySchema, listResultSchema, projectsResultSchema, restBase, summaryHistoryResultSchema, type Identity } from '@yargote/artifacts-contracts/http';
import type { CompactArtifactRead } from '@yargote/artifacts-contracts/workflow';

export type { ArtifactRead, Snapshot, UpdateInput } from '@yargote/artifacts-contracts';
export type { Identity } from '@yargote/artifacts-contracts/http';
export type { CompactArtifactRead, RevisionSummary } from '@yargote/artifacts-contracts/workflow';
export { prepareArtifactEdit } from '@yargote/artifacts-contracts/workflow';

export type CreateInput = z.input<typeof createSchema>;
export type ReadInput = z.input<typeof readSchema>;
export type PublishInput = z.input<typeof publishSchema>;
export type ListInput = z.input<typeof listSchema>;
export type MoveInput = z.input<typeof moveSchema>;
export type MoveResult = z.infer<typeof moveResultSchema>;
export type ProjectsResult = z.infer<typeof projectsResultSchema>;
export type HistoryInput = z.input<typeof historySchema>;
export type ExportInput = z.input<typeof exportSchema>;
export type ArtifactArchive = { filename: string; mediaType: 'application/zip'; bytes: Uint8Array; sha256: string };
export type HistoryResult = z.infer<typeof historyResultSchema>;
export type SummaryHistoryResult = z.infer<typeof summaryHistoryResultSchema>;

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ArtifactHttpClient {
  identity(): Promise<Identity>;
  create(input: CreateInput & { response: 'compact' }): Promise<CompactArtifactRead>;
  create(input: CreateInput & { response?: 'full' }): Promise<ArtifactRead>;
  create(input: CreateInput): Promise<ArtifactRead | CompactArtifactRead>;
  list(input?: ListInput): Promise<z.infer<typeof listResultSchema>>;
  projects(): Promise<ProjectsResult>;
  read(input: ReadInput & { response: 'compact' }): Promise<CompactArtifactRead>;
  read(input: ReadInput & { response?: 'full' }): Promise<ArtifactRead>;
  read(input: ReadInput): Promise<ArtifactRead | CompactArtifactRead>;
  update(input: UpdateInput & { response: 'compact' }): Promise<CompactArtifactRead>;
  update(input: UpdateInput & { response?: 'full' }): Promise<ArtifactRead>;
  update(input: UpdateInput): Promise<ArtifactRead | CompactArtifactRead>;
  history(input: HistoryInput & { response: 'summary' }): Promise<SummaryHistoryResult>;
  history(input: HistoryInput & { response?: 'full' }): Promise<HistoryResult>;
  history(input: HistoryInput): Promise<HistoryResult | SummaryHistoryResult>;
  publish(input: PublishInput): Promise<z.infer<typeof publishResultSchema>>;
  move(input: MoveInput): Promise<MoveResult>;
  export(input: ExportInput): Promise<ArtifactArchive>;
}

const maxJsonBytes = 64 * 1024 * 1024;
const maxArchiveBytes = 8 * 1024 * 1024;

async function boundedBytes(response: Response, maximum: number): Promise<Uint8Array> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) {
    await response.body?.cancel();
    throw new HttpError(response.status, 'response_too_large', 'The server response exceeds the size limit');
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new HttpError(response.status, 'response_too_large', 'The server response exceeds the size limit');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function query(values: Record<string, unknown>): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) parameters.set(key, String(value));
  const encoded = parameters.toString();
  return encoded ? `?${encoded}` : '';
}

function parseResponse<S extends z.ZodType>(schema: S, value: unknown, status: number): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(status, 'invalid_response', 'The server returned an invalid response');
  return result.data;
}

export function createArtifactHttpClient(options: {
  resource: string;
  accessToken: string | (() => Promise<string>);
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}): ArtifactHttpClient {
  const base = restBase(options.resource);
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new TypeError('timeoutMs must be a positive integer no greater than 2147483647');

  async function request<T>(path: string, method: string, parse: (response: Response, bytes: Uint8Array) => Promise<T> | T, input?: unknown, maximum = maxJsonBytes): Promise<T> {
    const token = typeof options.accessToken === 'string' ? options.accessToken : await options.accessToken();
    if (!token || /[\r\n]/.test(token)) throw new TypeError('A nonempty access token is required');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(`${base}${path}`, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, accept: maximum === maxArchiveBytes ? 'application/zip, application/json' : 'application/json', ...(input === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new HttpError(response.status, 'redirect_refused', 'The server attempted to redirect an authenticated request');
      }
      const bytes = await boundedBytes(response, response.ok ? maximum : Math.min(maximum, 1024 * 1024));
      if (!response.ok) {
        let value: unknown;
        try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
        catch { throw new HttpError(response.status, 'invalid_response', 'The server returned an invalid error response'); }
        const { error } = parseResponse(httpErrorSchema, value, response.status);
        throw new HttpError(response.status, error.code, error.message, error.details);
      }
      const expectedStatus = method === 'POST' ? 201 : 200;
      if (response.status !== expectedStatus) throw new HttpError(response.status, 'invalid_response', `The server returned status ${response.status}, expected ${expectedStatus}`);
      return await parse(response, bytes);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (controller.signal.aborted) throw new HttpError(0, 'timeout', 'The server request timed out', {}, { cause: error });
      throw new HttpError(0, 'network_error', 'The server request failed', {}, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  function json<S extends z.ZodType>(path: string, method: string, schema: S, input?: unknown): Promise<z.output<S>> {
    return request(path, method, (response, bytes) => {
      if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(response.status, 'invalid_response', 'The server did not return JSON');
      let value: unknown;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw new HttpError(response.status, 'invalid_response', 'The server returned invalid JSON'); }
      return parseResponse(schema, value, response.status);
    }, input);
  }

  const client = {
    identity: () => json('/identity', 'GET', identitySchema),
    create(value: CreateInput) {
      const input = createSchema.parse(value);
      return json('/artifacts', 'POST', input.response === 'compact' ? compactArtifactReadSchema : artifactReadSchema, input);
    },
    list(value: ListInput = {}) {
      return json(`/artifacts${query(listSchema.parse(value))}`, 'GET', listResultSchema);
    },
    projects: () => json('/projects', 'GET', projectsResultSchema),
    read(value: ReadInput) {
      const { artifactId, ...parameters } = readSchema.parse(value);
      return json(`/artifacts/${encodeURIComponent(artifactId)}${query(parameters)}`, 'GET', parameters.response === 'compact' ? compactArtifactReadSchema : artifactReadSchema);
    },
    update(value: UpdateInput) {
      const input = updateSchema.parse(value);
      return json(`/artifacts/${encodeURIComponent(input.artifactId)}`, 'PUT', input.response === 'compact' ? compactArtifactReadSchema : artifactReadSchema, input);
    },
    history(value: HistoryInput) {
      const { artifactId, ...parameters } = historySchema.parse(value);
      return json(`/artifacts/${encodeURIComponent(artifactId)}/history${query(parameters)}`, 'GET', parameters.response === 'summary' ? summaryHistoryResultSchema : historyResultSchema);
    },
    publish(value: PublishInput) {
      const input = publishSchema.parse(value);
      return json(`/artifacts/${encodeURIComponent(input.artifactId)}/publication`, 'PUT', publishResultSchema, input);
    },
    move(value: MoveInput) {
      const input = moveSchema.parse(value);
      return json(`/artifacts/${encodeURIComponent(input.artifactId)}/project`, 'PUT', moveResultSchema, input);
    },
    export(value: ExportInput) {
      const input = exportSchema.parse(value);
      return request(`/artifacts/${encodeURIComponent(input.artifactId)}/revisions/${encodeURIComponent(input.revisionId)}/export`, 'GET', async (response, bytes) => {
        const disposition = response.headers.get('content-disposition');
        const filename = /^attachment; filename="([A-Za-z0-9._-]+\.zip)"$/.exec(disposition ?? '')?.[1];
        const digest = response.headers.get('x-artifact-sha256');
        if (!filename || !digest || !/^[a-f0-9]{64}$/.test(digest) || response.headers.get('content-type')?.split(';')[0].trim() !== 'application/zip') throw new HttpError(response.status, 'invalid_response', 'The server returned invalid archive headers');
        const actualDigest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), (byte) => byte.toString(16).padStart(2, '0')).join('');
        if (actualDigest !== digest) throw new HttpError(response.status, 'archive_digest_mismatch', 'The archive SHA-256 does not match its response header');
        return { filename, mediaType: 'application/zip' as const, bytes, sha256: digest };
      }, undefined, maxArchiveBytes);
    },
  };
  return client as ArtifactHttpClient;
}
