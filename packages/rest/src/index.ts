import { z } from 'zod';
import { scopes } from '@artifacts/config';
import { ArtifactError, createSchema, exportSchema, historySchema, listSchema, publishSchema, readSchema, updateSchema } from '@yargote/artifacts-contracts';
import { canonicalResource, protectedResourceMetadataUrl, restBase } from '@yargote/artifacts-contracts/http';
import { compactArtifactRead, summarizeRevision } from '@yargote/artifacts-contracts/workflow';
import type { ArtifactStore } from '@artifacts/artifacts';
import { createBearerAuthorizer, type BearerConfig } from './identity.ts';

export { createBearerAuthorizer, type AccessDecision, type BearerConfig, type Principal } from './identity.ts';

const bodyLimit = 8_388_608;
class HttpFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: Record<string, unknown> = {}) { super(message); }
}

function failure(status: number, code: string, message: string, details: Record<string, unknown> = {}, headers?: HeadersInit): Response {
  return Response.json({ error: { code, message, details } }, { status, headers: { 'cache-control': 'no-store', ...Object.fromEntries(new Headers(headers)) } });
}

async function body(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpFailure(415, 'unsupported_media_type', 'Use application/json');
  const length = request.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > bodyLimit) throw new HttpFailure(413, 'request_too_large', 'Request body exceeds 8 MiB');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpFailure(400, 'invalid_input', 'A JSON command body is required');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > bodyLimit) {
        await reader.cancel();
        throw new HttpFailure(413, 'request_too_large', 'Request body exceeds 8 MiB');
      }
      chunks.push(chunk.value);
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new HttpFailure(400, 'invalid_input', 'The command body must be valid UTF-8 JSON'); }
  } finally { reader.releaseLock(); }
}

function query(url: URL, allowed: readonly string[], integers: readonly string[] = []): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(result, key)) throw new HttpFailure(400, 'invalid_input', 'Unknown or repeated query parameter', { parameter: key });
    if (integers.includes(key)) {
      if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new HttpFailure(400, 'invalid_input', 'Use an integer query parameter', { parameter: key });
      result[key] = Number(value);
    } else result[key] = value;
  }
  return result;
}

export function createArtifactRestApp(config: BearerConfig, artifacts: ArtifactStore) {
  const resource = new URL(canonicalResource(config.resource));
  canonicalResource(config.issuer);
  const base = new URL(restBase(config.resource)).pathname;
  const metadataPath = protectedResourceMetadataUrl(config.resource).pathname;
  const authorize = createBearerAuthorizer(config);
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (url.host !== resource.host) return failure(400, 'invalid_host', 'Invalid host');
      if (request.headers.has('origin') && request.headers.get('origin') !== resource.origin) return failure(403, 'forbidden', 'Origin denied');
      if (url.pathname === metadataPath || url.pathname === '/.well-known/oauth-protected-resource') {
        if (request.method !== 'GET') return failure(405, 'method_not_allowed', 'Use GET', {}, { allow: 'GET' });
        query(url, []);
        return Response.json({ resource: config.resource, authorization_servers: [config.issuer], scopes_supported: scopes, bearer_methods_supported: ['header'] });
      }
      if (url.pathname === '/health') {
        if (request.method !== 'GET') return failure(405, 'method_not_allowed', 'Use GET', {}, { allow: 'GET' });
        return Response.json({ status: 'ok' });
      }
      if (!url.pathname.startsWith(`${base}/`)) return failure(404, 'not_found', 'Route not found');
      let segments: string[];
      try { segments = url.pathname.slice(base.length + 1).split('/').map(decodeURIComponent); }
      catch { return failure(400, 'invalid_input', 'Malformed route identifier'); }
      const [collection, artifactId, section, revisionId, action] = segments;
      const route = collection === 'identity' && segments.length === 1 ? 'identity'
        : collection !== 'artifacts' ? null
        : segments.length === 1 ? 'collection'
        : segments.length === 2 && artifactId ? 'artifact'
        : segments.length === 3 && artifactId && section === 'history' ? 'history'
        : segments.length === 3 && artifactId && section === 'publication' ? 'publication'
        : segments.length === 5 && artifactId && section === 'revisions' && revisionId && action === 'export' ? 'export' : null;
      if (!route) return failure(404, 'not_found', 'Route not found');
      const allowed = route === 'collection' ? ['GET', 'POST'] : route === 'artifact' ? ['GET', 'PUT'] : route === 'publication' ? ['PUT'] : ['GET'];
      if (!allowed.includes(request.method)) return failure(405, 'method_not_allowed', 'Unsupported method', {}, { allow: allowed.join(', ') });
      const scope = route === 'publication' ? 'artifacts:publish' : request.method === 'PUT' || request.method === 'POST' ? 'artifacts:write' : 'artifacts:read';
      const decision = await authorize(request, [scope]);
      if (decision.kind !== 'authorized') {
        if (decision.kind === 'unavailable') return failure(503, 'unavailable', 'Identity service unavailable');
        const insufficient = decision.kind === 'insufficient-scope';
        return failure(insufficient ? 403 : 401, insufficient ? 'forbidden' : 'unauthenticated', insufficient ? 'Required scope is missing' : 'A valid bearer token is required', insufficient ? { requiredScopes: decision.required } : {}, {
          'www-authenticate': `Bearer error="${insufficient ? 'insufficient_scope' : 'invalid_token'}", scope="${scope}"`,
        });
      }
      const actor = decision.principal;
      const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
      if (route === 'identity') { query(url, []); return json({ userId: actor.userId, sessionId: actor.sessionId, clientId: actor.clientId, scopes: actor.scopes }); }
      if (route === 'collection' && request.method === 'GET') return json(await artifacts.list(actor, listSchema.parse(query(url, ['limit', 'cursor'], ['limit']))));
      if (route === 'artifact' && request.method === 'GET') {
        const input = readSchema.parse({ artifactId, ...query(url, ['revisionId', 'response']) });
        const result = await artifacts.read(actor, input);
        return json(input.response === 'compact' ? await compactArtifactRead(result) : result);
      }
      if (route === 'history') {
        const input = historySchema.parse({ artifactId, ...query(url, ['limit', 'beforeSequence', 'response'], ['limit', 'beforeSequence']) });
        const result = await artifacts.history(actor, input);
        return json(input.response === 'summary' ? { ...result, items: await Promise.all(result.items.map(summarizeRevision)) } : result);
      }
      query(url, []);
      if (route === 'export') {
        const result = await artifacts.export(actor, exportSchema.parse({ artifactId, revisionId }));
        return new Response(Buffer.from(result.base64, 'base64'), { headers: { 'cache-control': 'no-store', 'content-type': result.mediaType, 'content-disposition': `attachment; filename="${result.filename}"`, 'x-artifact-sha256': result.sha256, 'x-content-type-options': 'nosniff' } });
      }
      if (route === 'collection') {
        const input = createSchema.parse(await body(request));
        const result = await artifacts.create(actor, input);
        return json(input.response === 'compact' ? await compactArtifactRead(result) : result, 201);
      }
      if (route === 'artifact') {
        const input = updateSchema.parse(await body(request));
        if (input.artifactId !== artifactId) throw new HttpFailure(400, 'invalid_input', 'Route and command artifact IDs must match');
        const result = await artifacts.update(actor, input);
        return json(input.response === 'compact' ? await compactArtifactRead(result) : result);
      }
      const input = publishSchema.parse(await body(request));
      if (input.artifactId !== artifactId) throw new HttpFailure(400, 'invalid_input', 'Route and command artifact IDs must match');
      return json(await artifacts.publish(actor, input));
    } catch (error) {
      if (error instanceof HttpFailure) return failure(error.status, error.code, error.message, error.details);
      if (error instanceof z.ZodError) return failure(400, 'invalid_input', 'Input does not match the command schema', { issues: error.issues.map(({ code, path, message }) => ({ code, path, message })) });
      if (error instanceof ArtifactError) return failure(error.code === 'forbidden' ? 403 : error.code === 'not_found' ? 404 : error.code === 'invalid_grant' ? 400 : 409, error.code, error.message, error.details);
      return failure(503, 'unavailable', 'Artifact service unavailable');
    }
  };
}
