import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { identityScope, scopes, type mcpConfig } from '@artifacts/config';
import { createMcpAuthorizer } from './identity.ts';

export function createMcpApp(config: ReturnType<typeof mcpConfig>) {
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
      return server;
    }, { legacy: 'stateless' });
    return handler.fetch(request);
  };
}
