import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { identityScope, scopes, type mcpConfig } from '@artifacts/config';
import { createMcpAuthorizer } from './identity.ts';
import { ArtifactError, createSchema, exportSchema, historySchema, listSchema, publishSchema, readSchema, updateSchema, type ArtifactStore } from '@artifacts/artifacts';

export function createMcpApp(config: ReturnType<typeof mcpConfig>, artifacts?: ArtifactStore) {
  const authorize = createMcpAuthorizer(config);
  const resource = new URL(config.resource);
  const metadataPath = `/.well-known/oauth-protected-resource${resource.pathname}`;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.host !== resource.host) return new Response('Invalid host', { status: 400 });
    if (url.pathname === metadataPath || url.pathname === '/.well-known/oauth-protected-resource') return Response.json({ resource: config.resource, authorization_servers: [config.issuer], scopes_supported: scopes, bearer_methods_supported: ['header'] });
    if (url.pathname === '/health') return Response.json({ status: 'ok' });
    if (url.pathname !== resource.pathname) return new Response('Not found', { status: 404 });
    if (request.headers.has('origin') && request.headers.get('origin') !== resource.origin) return new Response('Origin denied', { status: 403 });
    const decision = await authorize(request, [identityScope]);
    if (decision.kind !== 'authorized') {
      const status = decision.kind === 'unavailable' ? 503 : decision.kind === 'insufficient-scope' ? 403 : 401;
      const headers: Record<string, string> = { 'cache-control': 'no-store' };
      if (status !== 503) headers['www-authenticate'] = `Bearer resource_metadata="${resource.origin}${metadataPath}", ${decision.kind === 'insufficient-scope' ? `error="insufficient_scope", scope="${decision.required.join(' ')}"` : `scope="${identityScope}"`}`;
      return Response.json({ error: decision.kind }, { status, headers });
    }
    const { principal } = decision;
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: 'artifacts', version: '0.1.0' });
      server.registerTool('whoami', {
        title: 'Current identity', description: 'Return the verified Artifacts account, session, OAuth client, and granted scopes.',
        inputSchema: z.object({}), annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      }, async () => {
        const identity = { userId: principal.userId, sessionId: principal.sessionId, clientId: principal.clientId, scopes: principal.scopes };
        return { content: [{ type: 'text', text: JSON.stringify(identity) }], structuredContent: identity };
      });
      if (artifacts) {
        const execute = async (operation: () => Promise<Record<string, unknown>>) => {
          try {
            const result = await operation();
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
          } catch (error) {
            const result = error instanceof ArtifactError
              ? { error: error.code, message: error.message, ...error.details }
              : { error: 'unavailable', message: 'Artifact service unavailable' };
            return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
          }
        };
        const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
        const mutation = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
        server.registerTool('artifacts_create', {
          title: 'Create artifact', description: 'Create an immutable snapshot with metadata, HTML, Markdown, or text and downloadable attachments. Limit 1 MiB decoded total and 32 files. Published HTML must be self-contained. Requires artifacts:write. Retry with the same requestId and arguments.',
          inputSchema: createSchema, annotations: mutation,
        }, async (input) => execute(() => artifacts.create(principal, input)));
        server.registerTool('artifacts_read', {
          title: 'Read artifact', description: 'Read an owned artifact head or an explicit retained revision, including all metadata and file bytes.',
          inputSchema: readSchema, annotations: readOnly,
        }, async (input) => execute(() => artifacts.read(principal, input)));
        server.registerTool('artifacts_update', {
          title: 'Update artifact', description: 'Save a complete new snapshot only if expectedRevisionId is the current head. Existing revisions remain immutable. Requires artifacts:write. Retry with the same requestId and arguments.',
          inputSchema: updateSchema, annotations: mutation,
        }, async (input) => execute(() => artifacts.update(principal, input)));
        server.registerTool('artifacts_publish', {
          title: 'Publish artifact revision', description: 'Select a retained revision at a stable protected URL. Requires artifacts:publish and the current expectedPublicationVersion, or zero if unpublished. Published HTML is self-contained with downloadable attachments. Retry with the same requestId and arguments.',
          inputSchema: publishSchema, annotations: mutation,
        }, async (input) => execute(() => artifacts.publish(principal, input)));
        server.registerTool('artifacts_export', {
          title: 'Export artifact revision', description: 'Return a deterministic provider-neutral ZIP as base64, its filename, media type, and SHA-256. Includes artifact.json, content, and every attachment from the explicit retained revision.',
          inputSchema: exportSchema, annotations: readOnly,
        }, async (input) => execute(() => artifacts.export(principal, input)));
        server.registerTool('artifacts_list', {
          title: 'List artifacts', description: 'List owned artifacts in stable ID order with bounded cursor pagination.',
          inputSchema: listSchema, annotations: readOnly,
        }, async (input) => execute(() => artifacts.list(principal, input)));
        server.registerTool('artifacts_history', {
          title: 'Read artifact history', description: 'Read retained revisions newest first with bounded beforeSequence pagination.',
          inputSchema: historySchema, annotations: readOnly,
        }, async (input) => execute(() => artifacts.history(principal, input)));
      }
      return server;
    }, { legacy: 'stateless' });
    if (!request.body) return handler.fetch(request);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8_388_608) {
        await reader.cancel();
        return Response.json({ error: 'request_too_large' }, { status: 413 });
      }
      chunks.push(value);
    }
    return handler.fetch(new Request(request, { body: Buffer.concat(chunks) }));
  };
}
