import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { identityScope, scopes, type mcpConfig } from '@artifacts/config';
import { createMcpAuthorizer } from './identity.ts';
import { ArtifactError, batchSchema, createSchema, exportSchema, historySchema, listSchema, listSharesSchema, moveSchema, publishSchema, readSchema, searchSchema, shareSchema, unshareSchema, updateSchema, type ArtifactStore } from '@artifacts/artifacts';
import { compactArtifactRead, summarizeRevision } from '@artifacts/artifacts/workflow';

export function createMcpApp(config: ReturnType<typeof mcpConfig>, artifacts?: ArtifactStore) {
  const authorize = createMcpAuthorizer(config);
  const resource = new URL(config.resource);
  const metadataPath = `/.well-known/oauth-protected-resource${resource.pathname}`;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.host !== resource.host) return new Response('Invalid host', { status: 400 });
    if (url.pathname === metadataPath || url.pathname === '/.well-known/oauth-protected-resource') return Response.json({ resource: config.resource, authorization_servers: [config.issuer], ...(config.apiResource ? { artifacts_rest_resource: config.apiResource } : {}), scopes_supported: scopes, bearer_methods_supported: ['header'] });
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
          title: 'Create artifact', description: 'Create an immutable snapshot with metadata, HTML, Markdown, text, or a design, and downloadable attachments. A design is a canvas of HTML boards. Its content.text is the canvas index JSON {"v":1,"boards":{PATH:{x,y,w,h,title?,page?}},"order":[PATH],"notes"?:{ID:{x,y,text,w?,page?}},"pages"?:[{id,name}]}, and a field outside this shape is rejected at every level. A design has 1 to 32 boards, at most 200 notes, and at most 32 pages. order lists each board exactly once, from back to front. Each PATH is boards/NAME.html, where NAME starts with a letter, digit, or underscore and holds only letters, digits, underscores, dots, and hyphens, and each PATH needs a file with mediaType text/html and utf8 encoding. Note ids, page ids, and page references match [A-Za-z0-9_-]{1,40} and are not __proto__. Page ids are unique, and a board or note page must be declared in pages. x and y are -1000000 to 1000000, w and h are 40 to 8000, and a title or page name is 1 to 256 characters. Limit 1 MiB decoded total and 32 files, boards included. Published HTML and boards must be self-contained. Requires artifacts:write. Retry with the same requestId and arguments. Optional project files the artifact under a project name of up to 80 characters: an existing project with the same name in any letter case is reused with its stored spelling, otherwise the project is created. Optional slug names the artifact within its project, or within the unfiled namespace without a project, for reads by { project, slug }: 1 to 160 characters of lowercase kebab-case segments separated by /, such as concepts/rag, with no .md suffix. A slug already used in that project fails with slug_conflict and the artifactId that holds it. The slug lives outside the snapshot and never changes digests, exports, or publications. Optional response=compact omits content, custom metadata, and file data from the result.',
          inputSchema: createSchema, annotations: mutation,
        }, async (input) => execute(async () => {
          const result = await artifacts.create(principal, input);
          return input.response === 'compact' ? compactArtifactRead(result) : result;
        }));
        server.registerTool('artifacts_read', {
          title: 'Read artifact', description: 'Read an owned artifact head or an explicit retained revision, including all metadata and file bytes. Address it by exactly one of artifactId or slug. A slug resolves within project, matched case-insensitively, or within the unfiled artifacts when project is omitted; project is accepted only with slug. An unknown ID or a locator with no artifact fails with not_found. Optional response=compact returns identity, metadata summary, content size, and attachment digests without payloads.',
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
        server.registerTool('artifacts_batch', {
          title: 'Apply artifact batch', description: 'Apply 1 to 25 create, update, and move operations as one all-or-nothing command with one receipt. Each operation has op create, with the artifacts_create snapshot, project, and slug, op update, with a complete next snapshot, or op move, with the artifacts_move project and slug. An update addresses its artifact by exactly one of artifactId or slug, with project only alongside slug. A move addresses its artifact by exactly one of artifactId or from { project, slug }, needs project, slug, or both, keeps an absent field, and clears a null one. A slug may name a page created earlier in the same batch, and later operations address a moved page by its new slug. expectedRevisionId must equal the head at that point in the batch. Omit it only for a page that an earlier operation in this batch created or updated; otherwise the update fails with conflict and currentRevisionId. The first failure commits nothing and returns its error, such as conflict, slug_conflict, or not_found, with index, the 0-based position of the failing operation. Each snapshot keeps the 1 MiB and 32-file limits, and the whole batch has a 4 MiB ceiling of decoded content and metadata. The result lists { index, artifactId, revisionId } for every operation, and a move reports the head it left in place. Search reflects the batch when it commits. A batch never publishes. Requires artifacts:write. Retry with the same requestId and arguments.',
          inputSchema: batchSchema, annotations: mutation,
        }, async (input) => execute(() => artifacts.batch(principal, input)));
        server.registerTool('artifacts_publish', {
          title: 'Publish artifact revision', description: 'Select a retained revision at a stable protected URL. Requires artifacts:publish and the current expectedPublicationVersion, or zero if unpublished. Published HTML and design boards are self-contained, and every file, boards included, downloads as an attachment. Retry with the same requestId and arguments.',
          inputSchema: publishSchema, annotations: mutation,
        }, async (input) => execute(() => artifacts.publish(principal, input)));
        server.registerTool('artifacts_share', {
          title: 'Share artifact', description: 'Let one person view the published revision of an owned artifact and its attachments at the publication URL. The person signs in with an Artifacts account whose verified email equals the shared address. The address is trimmed and stored in lowercase. Sharing an address that already has a share returns the existing share. Optional notify=true requests one email attempt, subject to 100 invitations per owner per UTC day. A fresh request can notify existing access; an exact retry never sends again. A requested result is not delivery confirmation, and a crash after commit may lose the email. Optional requireNew=true atomically refuses existing access with conflict. New grants are limited to 100 per artifact and 1000 per owner. On an unpublished artifact the share takes effect when a revision is published, and publishing another revision keeps every share. Viewers never get history, export, editing, the project, or the slug. Requires artifacts:publish. Retry with the same requestId and arguments.',
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
          title: 'List artifacts', description: 'List owned artifacts in stable ID order with bounded cursor pagination. Each item includes its project name and slug, or null. Optional project returns only artifacts in that project, matched case-insensitively.',
          inputSchema: listSchema, annotations: readOnly,
        }, async (input) => execute(() => artifacts.list(principal, input)));
        server.registerTool('artifacts_search', {
          title: 'Search artifacts', description: 'Search owned artifacts at their head revision. Markdown and text match by title, description, and content, HTML by title, description, and visible text, and design by title and description only. The query is plain text of up to 256 characters: every whitespace-separated term must match, letter case and accents are ignored, and operators or punctuation are treated as text. Attachments and artifacts shared with you are not searched. Results are ordered by relevance, best first, then by artifactId, and each item has artifactId, project, slug, title, a snippet with matches in **bold**, and rank, where lower is more relevant. Optional project limits results to that project, matched case-insensitively. limit is 1 to 25, default 10; pass nextCursor as cursor for the next page.',
          inputSchema: searchSchema, annotations: readOnly,
        }, async (input) => execute(() => artifacts.search(principal, input)));
        server.registerTool('artifacts_move', {
          title: 'Move or rename artifact', description: 'Set or clear the project and the slug of an owned artifact. Give project, slug, or both. An omitted field keeps its value, null clears it, and a value sets it. A project name is reused case-insensitively with its stored spelling, or created; a project disappears when its last artifact leaves. A move to another project keeps the slug. The move fails with slug_conflict, naming the holder, when the target project already uses the target slug, and then changes nothing. Moving never creates a revision and never changes the publication. Moving to the current project and slug succeeds without change. Requires artifacts:write. Retry with the same requestId and arguments.',
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
