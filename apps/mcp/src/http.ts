import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { identityScope, scopes, type mcpConfig } from '@artifacts/config';
import { createMcpAuthorizer } from './identity.ts';
import { ArtifactError, createSchema, exportSchema, historySchema, listSchema, listSharesSchema, moveSchema, publishSchema, readSchema, shareSchema, unshareSchema, updateSchema, type ArtifactStore } from '@artifacts/artifacts';
import { compactArtifactRead, summarizeRevision } from '@artifacts/artifacts/workflow';

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
          title: 'Create artifact', description: 'Create an immutable snapshot with metadata, HTML, Markdown, or text and downloadable attachments. Limit 1 MiB decoded total and 32 files. Published HTML must be self-contained. Requires artifacts:write. Retry with the same requestId and arguments. Optional project files the artifact under a project name of up to 80 characters: an existing project with the same name in any letter case is reused with its stored spelling, otherwise the project is created. Optional response=compact omits content, custom metadata, and file data from the result.',
          inputSchema: createSchema, annotations: mutation,
        }, async (input) => execute(async () => {
          const result = await artifacts.create(principal, input);
          return input.response === 'compact' ? compactArtifactRead(result) : result;
        }));
        server.registerTool('artifacts_read', {
          title: 'Read artifact', description: 'Read an owned artifact head or an explicit retained revision, including all metadata and file bytes. Optional response=compact returns identity, metadata summary, content size, and attachment digests without payloads.',
          inputSchema: readSchema, annotations: readOnly,
        }, async (input) => execute(async () => {
          const result = await artifacts.read(principal, input);
          return input.response === 'compact' ? compactArtifactRead(result) : result;
        }));
        server.registerTool('artifacts_update', {
          title: 'Update artifact', description: 'Read the current head with a full response, preserve untouched metadata including custom, content, and files, then send the complete next snapshot with that head as expectedRevisionId. Requires artifacts:write. Retry transport failures with the same requestId and arguments. A conflict stops the edit and requires a deliberate new operation. Optional response=compact omits content, custom metadata, and file data from the result; use a full read for byte verification.',
          inputSchema: updateSchema, annotations: mutation,
        }, async (input) => execute(async () => {
          const result = await artifacts.update(principal, input);
          return input.response === 'compact' ? compactArtifactRead(result) : result;
        }));
        server.registerTool('artifacts_publish', {
          title: 'Publish artifact revision', description: 'Select a retained revision at a stable protected URL. Requires artifacts:publish and the current expectedPublicationVersion, or zero if unpublished. Published HTML is self-contained with downloadable attachments. Retry with the same requestId and arguments.',
          inputSchema: publishSchema, annotations: mutation,
        }, async (input) => execute(() => artifacts.publish(principal, input)));
        server.registerTool('artifacts_share', {
          title: 'Share artifact', description: 'Let one person view the published revision of an owned artifact and its attachments at the publication URL. The person signs in with an Artifacts account whose verified email equals the shared address. The address is trimmed and stored in lowercase. Sharing an address that already has a share returns the existing share. Optional notify=true requests one email attempt, subject to 100 invitations per owner per UTC day. A fresh request can notify existing access; an exact retry never sends again. A requested result is not delivery confirmation, and a crash after commit may lose the email. Optional requireNew=true atomically refuses existing access with conflict. New grants are limited to 100 per artifact and 1000 per owner. On an unpublished artifact the share takes effect when a revision is published, and publishing another revision keeps every share. Viewers never get history, export, editing, or the project. Requires artifacts:publish. Retry with the same requestId and arguments.',
          inputSchema: shareSchema, annotations: { ...mutation, openWorldHint: true },
        }, async (input) => execute(() => artifacts.share(principal, input)));
        server.registerTool('artifacts_unshare', {
          title: 'Revoke artifact share', description: 'Remove one share of an owned artifact by the shareId from artifacts_share or artifacts_shares_list. The person loses access on their next request, including on an open publication page. Requires artifacts:publish. Retry with the same requestId and arguments. A new requestId for a share that is already removed fails with not_found.',
          inputSchema: unshareSchema, annotations: { ...mutation, destructiveHint: true },
        }, async (input) => execute(() => artifacts.unshare(principal, input)));
        server.registerTool('artifacts_shares_list', {
          title: 'List artifact shares', description: 'List the email shares of an owned artifact ordered by address, each with the shareId that artifacts_unshare takes. Requires artifacts:publish.',
          inputSchema: listSharesSchema, annotations: readOnly,
        }, async (input) => execute(() => artifacts.listShares(principal, input)));
        server.registerTool('artifacts_export', {
          title: 'Export artifact revision', description: 'Return a deterministic provider-neutral ZIP as base64, its filename, media type, and SHA-256. Includes artifact.json, content, and every attachment from the explicit retained revision.',
          inputSchema: exportSchema, annotations: readOnly,
        }, async (input) => execute(() => artifacts.export(principal, input)));
        server.registerTool('artifacts_list', {
          title: 'List artifacts', description: 'List owned artifacts in stable ID order with bounded cursor pagination. Each item includes its project name or null. Optional project returns only artifacts in that project, matched case-insensitively.',
          inputSchema: listSchema, annotations: readOnly,
        }, async (input) => execute(() => artifacts.list(principal, input)));
        server.registerTool('artifacts_move', {
          title: 'Move artifact to project', description: 'Set or clear the project of an owned artifact. A project name is reused case-insensitively with its stored spelling, or created; null removes the artifact from its project. A project disappears when its last artifact leaves. Moving never creates a revision and never changes the publication. Moving to the current project succeeds without change. Requires artifacts:write. Retry with the same requestId and arguments.',
          inputSchema: moveSchema, annotations: mutation,
        }, async (input) => execute(() => artifacts.move(principal, input)));
        server.registerTool('projects_list', {
          title: 'List projects', description: 'List the owner\'s projects with their artifact counts, ordered by name without regard to letter case. Projects exist only while they contain artifacts. Use artifacts_list with project to list a project\'s artifacts.',
          inputSchema: z.object({}), annotations: readOnly,
        }, async () => execute(() => artifacts.projects(principal)));
        server.registerTool('artifacts_history', {
          title: 'Read artifact history', description: 'Read retained revisions newest first with bounded beforeSequence pagination. Optional response=summary omits content, custom metadata, and file data from each revision.',
          inputSchema: historySchema, annotations: readOnly,
        }, async (input) => execute(async () => {
          const result = await artifacts.history(principal, input);
          return input.response === 'summary' ? { ...result, items: await Promise.all(result.items.map(summarizeRevision)) } : result;
        }));
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
