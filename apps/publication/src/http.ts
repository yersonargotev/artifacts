import { EncryptJWT, jwtDecrypt } from 'jose';
import { publicationConfig } from '@artifacts/config';
import { z } from 'zod';
import { artifactReadSchema, consumeGrantSchema, readSchema, viewerSchema } from '@artifacts/artifacts/contracts';
import type { ArtifactRead, Viewer } from '@artifacts/artifacts/contracts';
import { attachmentResponse, documentPolicy, publicationDocument } from './document.ts';

export type PublicationEnvironment = { DASHBOARD_URL: string; PUBLISH_URL: string; PUBLICATION_SERVICE_SECRET: string; PUBLICATION_COOKIE_SECRET: string };
const transactionSchema = z.strictObject({ purpose: z.literal('transaction'), artifactId: z.string().min(1).max(128), state: z.string().min(32).max(128), expiresAt: z.number().int().positive() });
const viewerCookieSchema = z.strictObject({ purpose: z.literal('viewer'), viewer: viewerSchema });
const transactionCookie = '__Host-artifacts-publication-transaction';
const cookieName = (artifactId: string) => `__Host-artifacts-viewer-${base64url(new TextEncoder().encode(artifactId))}`;
const base64url = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const privateHeaders = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };

function cookie(request: Request, name: string) {
  return request.headers.get('cookie')?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function setCookie(name: string, value: string, expiresAt: number) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))}`;
}

export function createPublicationApp(environment: PublicationEnvironment, fetchBackend: typeof fetch = fetch) {
  const config = publicationConfig(environment);
  const dashboardOrigin = config.dashboard;
  const publishOrigin = config.origin;
  const key = crypto.subtle.digest('SHA-256', new TextEncoder().encode(config.cookieSecret)).then((digest) => new Uint8Array(digest));
  async function encrypt(payload: object, expiresAt: number) {
    return new EncryptJWT({ data: payload }).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).setIssuedAt().setExpirationTime(Math.floor(expiresAt / 1000)).setIssuer(publishOrigin).setAudience(publishOrigin).encrypt(await key);
  }
  async function decrypt(value: string | undefined) {
    if (!value || value.length > 4096) throw new Error('Invalid publication cookie');
    return (await jwtDecrypt(value, await key, { issuer: publishOrigin, audience: publishOrigin, keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'] })).payload.data;
  }
  async function backend(path: string, body: object) {
    try {
      const response = await fetchBackend(`${dashboardOrigin}/internal/publication/${path}`, { method: 'POST', redirect: 'manual', headers: { authorization: `Bearer ${config.serviceSecret}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
      if (response.status !== 200) {
        if ([401, 403, 404, 409].includes(response.status)) return { denied: true as const };
        throw new Error('Publication backend unavailable');
      }
      return { value: await response.json() as unknown };
    } catch { throw new Error('Publication backend unavailable'); }
  }
  async function admit(request: Request, artifactId: string): Promise<Viewer | undefined> {
    try {
      const credential = viewerCookieSchema.parse(await decrypt(cookie(request, cookieName(artifactId))));
      if (credential.viewer.artifactId !== artifactId || credential.viewer.expiresAt <= Date.now()) return;
      return credential.viewer;
    } catch { return; }
  }
  async function begin(artifactId: string) {
    const transaction = transactionSchema.parse({ purpose: 'transaction', artifactId, state: random(), expiresAt: Date.now() + 300_000 });
    const target = new URL('/publication/open', dashboardOrigin);
    target.search = new URLSearchParams({ artifactId, state: transaction.state }).toString();
    return new Response(null, { status: 303, headers: { ...privateHeaders, location: target.href, 'set-cookie': setCookie(transactionCookie, await encrypt(transaction, transaction.expiresAt), transaction.expiresAt) } });
  }
  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.origin !== publishOrigin) return new Response('Invalid host', { status: 400, headers: privateHeaders });
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { ...privateHeaders, allow: 'GET' } });
      if (url.pathname === '/callback') {
        try {
          const parameters = consumeGrantSchema.parse(Object.fromEntries(url.searchParams));
          if (url.searchParams.size !== 3) throw new Error('Invalid callback');
          const transaction = transactionSchema.parse(await decrypt(cookie(request, transactionCookie)));
          if (transaction.expiresAt <= Date.now() || parameters.artifactId !== transaction.artifactId || parameters.state !== transaction.state) throw new Error('Invalid callback transaction');
          const result = await backend('consume', parameters);
          if ('denied' in result) throw new Error('Invalid publication grant');
          const viewer = viewerSchema.parse(result.value);
          if (viewer.artifactId !== transaction.artifactId || viewer.expiresAt <= Date.now()) throw new Error('Invalid publication viewer');
          const headers = new Headers({ ...privateHeaders, location: `${publishOrigin}/a/${encodeURIComponent(viewer.artifactId)}` });
          headers.append('set-cookie', setCookie(transactionCookie, '', 0));
          headers.append('set-cookie', setCookie(cookieName(viewer.artifactId), await encrypt({ purpose: 'viewer', viewer }, viewer.expiresAt), viewer.expiresAt));
          return new Response(null, { status: 303, headers });
        } catch (error) {
          if (error instanceof Error && error.message === 'Publication backend unavailable') throw error;
          return new Response('El enlace de acceso ha vencido. Abre de nuevo la publicación.', { status: 403, headers: { ...privateHeaders, 'set-cookie': setCookie(transactionCookie, '', 0) } });
        }
      }
      const route = /^\/a\/([^/]+)(?:\/r\/([^/]+)\/files\/(.+))?$/.exec(url.pathname);
      if (!route || url.search) return new Response('No encontrado', { status: 404, headers: privateHeaders });
      const { artifactId, revisionId } = readSchema.parse({ artifactId: decodeURIComponent(route[1]!), ...(route[2] ? { revisionId: decodeURIComponent(route[2]) } : {}) });
      const path = route[3] ? decodeURIComponent(route[3]) : undefined;
      const viewer = await admit(request, artifactId);
      if (!viewer) return path ? new Response('Acceso denegado', { status: 401, headers: privateHeaders }) : await begin(artifactId);
      const result = await backend('read', { viewer, artifactId, ...(revisionId ? { revisionId } : {}) });
      if ('denied' in result) return new Response('Tu sesión o esta publicación ya no están disponibles.', { status: 403, headers: { ...privateHeaders, 'set-cookie': setCookie(cookieName(artifactId), '', 0) } });
      const artifact: ArtifactRead = artifactReadSchema.parse(result.value);
      if (artifact.artifactId !== artifactId || artifact.ownerId !== viewer.userId || !artifact.publication || artifact.revision.id !== artifact.publication.revisionId || (revisionId && artifact.revision.id !== revisionId)) throw new Error('Invalid published artifact');
      if (path) {
        const file = artifact.revision.snapshot.files.find((candidate) => candidate.path === path);
        return file ? attachmentResponse(file) : new Response('Archivo no encontrado', { status: 404, headers: privateHeaders });
      }
      return new Response(publicationDocument(artifact, (file) => `/a/${encodeURIComponent(artifactId)}/r/${encodeURIComponent(artifact.revision.id)}/files/${file.split('/').map(encodeURIComponent).join('/')}`), { headers: { ...privateHeaders, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': documentPolicy } });
    } catch {
      return new Response('El servicio no está disponible. Inténtalo de nuevo.', { status: 503, headers: privateHeaders });
    }
  };
}
