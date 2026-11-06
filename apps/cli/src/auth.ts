import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import * as oidc from 'openid-client';
import { canonicalResource, httpErrorSchema, identitySchema, protectedResourceMetadataUrl, restBase, type Identity } from '@yargote/artifacts-contracts/http';
import { z } from 'zod';
import { HttpError } from '@yargote/artifacts-client';
import { CredentialStore, type Registration, type Tokens } from './credentials.ts';

const networkTimeout = 10_000;
const callbackTimeout = 180_000;
const scopes = 'openid profile offline_access artifacts:read artifacts:write artifacts:publish';
const resourceMetadata = z.object({ resource: z.string(), authorization_servers: z.array(z.string()).min(1) });

function endpoint(value: string, issuer?: string): URL {
  const url = new URL(value);
  const loopback = /^http:\/\/(?:127\.0\.0\.1|\[::1\]|localhost)(?::[0-9]+)?(?:\/|$)/.test(value);
  if (value.trim() !== value || url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) throw new Error('OAuth URLs require HTTPS or an exact loopback HTTP host, without credentials, query, or fragment');
  if (issuer && url.origin !== new URL(issuer).origin) throw new Error('OAuth endpoints must use the issuer origin');
  return url;
}

type RequestContext = { phase: 'resource_metadata' | 'rest_preflight' | 'oauth' | 'authenticated_identity'; method: string; url: URL | string };
type IdentityRequest = { kind: 'anonymous' } | { kind: 'authenticated'; accessToken: string; signal: AbortSignal; claims: { sub: string; sid?: unknown } };

class AuthTransportError extends Error {}

function safeUrl(value: URL | string): string {
  try { const url = new URL(value); return `${url.origin}${url.pathname}`; }
  catch { return '[invalid endpoint]'; }
}

function authFailure(context: RequestContext, code: string, explanation: string, status?: number): Error {
  const message = `${context.phase} ${context.method} ${safeUrl(context.url)}${status === undefined ? '' : ` HTTP ${status}`}: ${explanation}`;
  return status === undefined ? new AuthTransportError(message) : new HttpError(status, code, message);
}

async function boundedFetch(context: RequestContext, options: RequestInit = {}): Promise<Response> {
  const timeout = AbortSignal.timeout(networkTimeout);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try { response = await fetch(context.url, { ...options, redirect: 'manual', signal }); }
  catch {
    throw authFailure(context, 'network_error', timeout.aborted || (options.signal?.aborted && options.signal.reason instanceof DOMException && options.signal.reason.name === 'TimeoutError') ? 'Request timed out' : options.signal?.aborted ? 'Request cancelled' : 'Network request failed');
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    throw authFailure(context, 'redirect_refused', 'Redirect refused', response.status);
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 1024 * 1024) throw new Error('too large');
        chunks.push(chunk.value);
      }
    } catch {
      await reader.cancel().catch(() => {});
      throw authFailure(context, 'invalid_response', timeout.aborted || (options.signal?.aborted && options.signal.reason instanceof DOMException && options.signal.reason.name === 'TimeoutError') ? 'Response timed out' : options.signal?.aborted ? 'Request cancelled' : 'Cannot read response', response.status);
    } finally { reader.releaseLock(); }
  }
  return new Response(size ? Buffer.concat(chunks) : null, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function jsonResponse(response: Response, context: RequestContext): Promise<unknown> {
  if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw authFailure(context, 'invalid_response', 'Expected a JSON response', response.status);
  return response.json().catch(() => { throw authFailure(context, 'invalid_response', 'Invalid JSON response', response.status); });
}

async function discoverResource(resource: string): Promise<string> {
  const context: RequestContext = { phase: 'resource_metadata', method: 'GET', url: protectedResourceMetadataUrl(resource) };
  const response = await boundedFetch(context);
  if (!response.ok) throw authFailure(context, response.status >= 500 ? 'service_error' : 'incompatible_resource', response.status >= 500 ? 'Resource metadata service failed' : 'Cannot discover the protected resource. Confirm the configured REST URL', response.status);
  const parsed = resourceMetadata.safeParse(await jsonResponse(response, context));
  if (!parsed.success) throw authFailure(context, 'invalid_response', 'Invalid protected resource metadata', response.status);
  if (parsed.data.resource !== resource) throw authFailure(context, 'invalid_response', 'Protected resource metadata does not match the exact server URL', response.status);
  const issuer = parsed.data.authorization_servers[0]!;
  try { endpoint(issuer); } catch { throw authFailure(context, 'invalid_response', 'Invalid authorization server URL in protected resource metadata', response.status); }
  return issuer;
}

function compatibleChallenge(value: string | null): boolean {
  if (!value) return false;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  if (!match) return false;
  const parameters = new Map<string, string>();
  const input = match[1]!;
  const parameter = /\s*([!#$%&'*+.^_`|~0-9A-Za-z-]+)\s*=\s*(?:"((?:[^"\\]|\\[\x20-\x7e])*)"|([!#$%&'*+.^_`|~0-9A-Za-z-]+))\s*(,|$)/gy;
  let position = 0;
  while (position < input.length) {
    parameter.lastIndex = position;
    const param = parameter.exec(input);
    if (!param || (param[4] === ',' && parameter.lastIndex === input.length)) return false;
    const key = param[1]!.toLowerCase();
    if (parameters.has(key)) return false;
    parameters.set(key, param[2] === undefined ? param[3]! : param[2].replace(/\\([\x20-\x7e])/g, '$1'));
    position = parameter.lastIndex;
  }
  return parameters.get('error') === 'invalid_token' && (parameters.get('scope')?.split(/\s+/).includes('artifacts:read') ?? false);
}

function checkIdentity(resource: string, request: { kind: 'anonymous' }): Promise<void>;
function checkIdentity(resource: string, request: Extract<IdentityRequest, { kind: 'authenticated' }>): Promise<Identity>;
async function checkIdentity(resource: string, request: IdentityRequest): Promise<void | Identity> {
  const context: RequestContext = { phase: request.kind === 'anonymous' ? 'rest_preflight' : 'authenticated_identity', method: 'GET', url: `${restBase(resource)}/identity` };
  const response = await boundedFetch(context, request.kind === 'anonymous' ? {} : { signal: request.signal, headers: { authorization: `Bearer ${request.accessToken}` } });
  if (request.kind === 'anonymous') {
    if (response.status === 401) {
      const body = httpErrorSchema.safeParse(await jsonResponse(response, context));
      if (body.success && body.data.error.code === 'unauthenticated' && compatibleChallenge(response.headers.get('www-authenticate'))) return;
    }
    throw authFailure(context, response.status >= 500 ? 'service_error' : 'incompatible_resource', response.status >= 500 ? 'REST identity service failed' : 'REST identity route is incompatible. Confirm the configured REST URL', response.status);
  }
  if (!response.ok) throw authFailure(context, response.status >= 500 ? 'service_error' : response.status === 401 || response.status === 403 ? 'access_denied' : 'incompatible_resource', response.status >= 500 ? 'REST identity service failed' : response.status === 401 || response.status === 403 ? 'OAuth grant cannot access this Artifacts server' : 'REST identity route is unavailable. Confirm the configured REST URL', response.status);
  const parsed = identitySchema.safeParse(await jsonResponse(response, context));
  if (!parsed.success) throw authFailure(context, 'invalid_response', 'Invalid REST identity response', response.status);
  if (request.claims.sub !== parsed.data.userId || (request.claims.sid !== undefined && request.claims.sid !== parsed.data.sessionId)) throw authFailure(context, 'invalid_response', 'OAuth identity does not match the Artifacts session', response.status);
  return parsed.data;
}

type OAuthObservation = { context: RequestContext; response: Response };

async function oauth<T>(issuer: string, signal: AbortSignal | undefined, operation: (options: oidc.DiscoveryRequestOptions) => Promise<T>): Promise<T> {
  const observations: OAuthObservation[] = [];
  try {
    const result = await operation(discoveryOptions(issuer, signal, observations));
    if (result instanceof oidc.Configuration) {
      validateConfiguration(result, issuer, observations);
      result[oidc.customFetch] = discoveryOptions(issuer, signal)[oidc.customFetch]!;
    }
    return result;
  }
  catch (error) {
    let cause: unknown = error;
    let observed: OAuthObservation | undefined;
    for (let depth = 0; depth < 5; depth++) {
      if (cause instanceof HttpError || cause instanceof AuthTransportError) throw cause;
      const response = cause instanceof Response ? cause : cause instanceof Error && 'response' in cause ? cause.response : undefined;
      if (response instanceof Response) observed = observations.find((item) => item.response === response);
      if (observed || !(cause instanceof Error)) break;
      cause = cause.cause;
    }
    observed ??= observations.at(-1);
    if (observed) throw authFailure(observed.context, 'invalid_response', 'OAuth protocol validation failed', observed.response.status);
    throw new Error('OAuth protocol validation failed');
  }
}

function discoveryOptions(issuer: string, signal?: AbortSignal, observations?: OAuthObservation[]): oidc.DiscoveryRequestOptions {
  endpoint(issuer);
  return {
    timeout: networkTimeout / 1000,
    execute: [...(new URL(issuer).protocol === 'http:' ? [oidc.allowInsecureRequests] : []), oidc.enableNonRepudiationChecks],
    [oidc.customFetch]: async (url, options) => {
      const context: RequestContext = { phase: 'oauth', method: options.method ?? 'GET', url };
      try { endpoint(url, issuer); } catch { throw authFailure({ ...context, url: issuer }, 'invalid_response', 'Invalid OAuth endpoint'); }
      const response = await boundedFetch(context, { ...options, signal: signal && options.signal ? AbortSignal.any([signal, options.signal]) : signal ?? options.signal, body: options.body instanceof Uint8Array ? Uint8Array.from(options.body) : options.body });
      if (!response.ok) throw authFailure(context, response.status >= 500 ? 'service_error' : 'oauth_error', response.status >= 500 ? 'OAuth service failed' : 'OAuth request failed', response.status);
      observations?.push({ context, response });
      return response;
    },
  };
}

function validateConfiguration(config: oidc.Configuration, issuer: string, observations: OAuthObservation[]): void {
  const discovery = observations.find((item) => item.context.method === 'GET');
  const registration = observations.find((item) => item.context.method === 'POST');
  if (!discovery) throw new Error('OAuth discovery response was not observed');
  const failDiscovery = (message: string): Error => authFailure(discovery.context, 'invalid_response', message, discovery.response.status);
  const metadata = config.serverMetadata();
  if (metadata.issuer !== issuer) throw failDiscovery('OAuth issuer metadata does not match the configured issuer');
  for (const [key, value] of Object.entries(metadata)) {
    if ((key.endsWith('_endpoint') || key === 'jwks_uri') && typeof value === 'string') {
      try { endpoint(value, issuer); } catch (error) {
        const message = error instanceof Error && error.message === 'OAuth endpoints must use the issuer origin' ? error.message : 'OAuth URLs require HTTPS or an exact loopback HTTP host, without credentials, query, or fragment';
        throw failDiscovery(message);
      }
    }
  }
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) throw failDiscovery('OAuth metadata is missing authorization or token endpoints');
  if (config.clientMetadata().client_secret || config.clientMetadata().token_endpoint_auth_method !== 'none') {
    const message = 'The CLI requires a public OAuth client without a secret';
    throw registration ? authFailure(registration.context, 'invalid_response', message, registration.response.status) : new Error(message);
  }
}

async function configuration(registration: Registration, signal?: AbortSignal): Promise<oidc.Configuration> {
  return oauth(registration.issuer, signal, (options) => oidc.discovery(new URL(registration.issuer), registration.clientId, { token_endpoint_auth_method: 'none', id_token_signed_response_alg: 'EdDSA' }, oidc.None(), options));
}

function tokenRecord(tokens: Awaited<ReturnType<typeof oidc.refreshTokenGrant>>, previousRefresh?: string): Tokens {
  if (typeof tokens.expires_in !== 'number' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new Error('OAuth token response is missing a valid expiration');
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? previousRefresh, expiresAt: Date.now() + tokens.expires_in * 1000 };
}

async function callback() {
  const controller = new AbortController();
  let accept: ((url: URL) => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  let expectedState: string | undefined;
  let expectedIssuer: string | undefined;
  let redirectUri = '';
  let settled = false;
  const result = new Promise<URL>((resolve, fail) => { accept = resolve; reject = fail; });
  void result.catch(() => {});
  const server = createServer((request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('content-type', 'text/plain; charset=utf-8');
    if (request.method !== 'GET' || !request.url || request.url.length > 8192 || request.headers.host !== new URL(redirectUri).host || request.url.split('?')[0] !== '/oauth/callback') {
      response.writeHead(404).end('Not found');
      return;
    }
    const url = new URL(request.url, redirectUri);
    if (settled || !expectedState || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== expectedState || url.searchParams.getAll('iss').length !== 1 || url.searchParams.get('iss') !== expectedIssuer || url.searchParams.getAll('code').length + url.searchParams.getAll('error').length !== 1) {
      response.writeHead(400).end('Invalid OAuth callback');
      return;
    }
    settled = true;
    response.end('Authorization received. Return to the terminal to check the result.');
    accept!(url);
  });
  await new Promise<void>((resolve, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', fail); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Cannot bind the OAuth loopback callback');
  redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
  const fail = (error: Error) => { controller.abort(error); reject!(error); };
  const timer = setTimeout(() => fail(new Error('Login timed out. Run artifacts login again')), callbackTimeout);
  const cancel = () => fail(new Error('Login cancelled'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  return {
    redirectUri, signal: controller.signal,
    wait(state: string, issuer: string) { expectedState = state; expectedIssuer = issuer; return result; },
    async close() {
      clearTimeout(timer);
      process.removeListener('SIGINT', cancel);
      process.removeListener('SIGTERM', cancel);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function openBrowser(url: string): Promise<void> {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', () => reject(new Error('Cannot open a browser. Run artifacts login with --no-browser')));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

export async function login(options: { resource: string; stateDir: string; noBrowser: boolean; onAuthorizationUrl: (url: string) => void }): Promise<Identity> {
  const resource = canonicalResource(options.resource);
  const store = await CredentialStore.open(options.stateDir);
  let listener: Awaited<ReturnType<typeof callback>> | undefined;
  try {
    const epoch = await store.exclusive(() => {
      const profile = store.read(resource);
      store.write(resource, { ...profile, epoch: profile.epoch + 1 });
      return profile.epoch + 1;
    });
    const issuer = await discoverResource(resource);
    await checkIdentity(resource, { kind: 'anonymous' });
    listener = await callback();
    const { redirectUri, signal } = listener;
    const config = await store.exclusive(async () => {
      const profile = store.read(resource);
      if (profile.epoch !== epoch) throw new Error('Login was superseded by another login or logout');
      if (profile.registration?.issuer === issuer) return configuration(profile.registration, signal);
      const registered = await oauth(issuer, signal, (options) => oidc.dynamicClientRegistration(new URL(issuer), {
        client_name: 'Artifacts CLI', application_type: 'native', token_endpoint_auth_method: 'none', id_token_signed_response_alg: 'EdDSA',
        redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: scopes,
      }, oidc.None(), options));
      store.write(resource, { ...profile, registration: { issuer, clientId: registered.clientMetadata().client_id }, tokens: null, refreshAttempt: null });
      return registered;
    });
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const authorizationUrl = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri, response_type: 'code', scope: scopes, resource,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256', state, nonce,
    }).href;
    const authorization = listener.wait(state, issuer);
    options.onAuthorizationUrl(authorizationUrl);
    if (!options.noBrowser) await openBrowser(authorizationUrl);
    const currentUrl = await authorization;
    if (currentUrl.searchParams.has('error')) throw new Error(currentUrl.searchParams.get('error') === 'access_denied' ? 'Authorization denied' : 'Authorization failed');
    return await store.exclusive(async () => {
      const profile = store.read(resource);
      if (profile.epoch !== epoch) throw new Error('Login was superseded by another login or logout');
      const tokens = await oauth(issuer, signal, (options) => {
        config[oidc.customFetch] = options[oidc.customFetch]!;
        return oidc.authorizationCodeGrant(config, currentUrl, { expectedState: state, expectedNonce: nonce, pkceCodeVerifier: verifier, idTokenExpected: true }, { resource });
      });
      const credentials = tokenRecord(tokens);
      const identity = await checkIdentity(resource, { kind: 'authenticated', accessToken: credentials.accessToken, signal, claims: tokens.claims()! });
      signal.throwIfAborted();
      store.write(resource, { ...profile, tokens: credentials, refreshAttempt: null });
      return identity;
    });
  } finally { await listener?.close(); store.close(); }
}

export async function accessToken(options: { resource: string; stateDir: string }): Promise<string> {
  const resource = canonicalResource(options.resource);
  const automationToken = process.env.ARTIFACTS_ACCESS_TOKEN;
  if (automationToken !== undefined) {
    if (!/^[A-Za-z0-9._~+/-]+=*$/.test(automationToken)) throw new Error('ARTIFACTS_ACCESS_TOKEN must contain a nonempty bearer token');
    return automationToken;
  }
  const store = await CredentialStore.open(options.stateDir);
  try {
    return await store.exclusive(async () => {
      const profile = store.read(resource);
      const required = `Run artifacts login --server ${resource}`;
      if (!profile.tokens || !profile.registration) throw new Error(`You are not signed in. ${required}`);
      if (profile.refreshAttempt) throw new Error(`The previous token refresh has an uncertain result. ${required}`);
      if (profile.tokens.expiresAt > Date.now() + 30_000) return profile.tokens.accessToken;
      if (!profile.tokens.refreshToken) throw new Error(`Your session expired. ${required}`);
      const config = await configuration(profile.registration);
      // The separate SQLite lock survives this commit and releases automatically on process death.
      store.write(resource, { ...profile, refreshAttempt: randomUUID() });
      try {
        const tokens = await oidc.refreshTokenGrant(config, profile.tokens.refreshToken, { resource });
        const credentials = tokenRecord(tokens, profile.tokens.refreshToken);
        store.write(resource, { ...profile, tokens: credentials, refreshAttempt: null });
        return credentials.accessToken;
      } catch { throw new Error(`Token refresh failed and its result is uncertain. ${required}`); }
    });
  } finally { store.close(); }
}

export async function logout(options: { resource: string; stateDir: string }): Promise<{ signedOut: true; remoteRevocation: 'confirmed' | 'unconfirmed' | 'not-needed' }> {
  const resource = canonicalResource(options.resource);
  const store = await CredentialStore.open(options.stateDir);
  let previous;
  try {
    previous = await store.exclusive(() => {
      const profile = store.read(resource);
      store.write(resource, { ...profile, epoch: profile.epoch + 1, tokens: null, refreshAttempt: null });
      return profile;
    });
  } finally { store.close(); }
  if (!previous.tokens?.refreshToken || !previous.registration) return { signedOut: true, remoteRevocation: 'not-needed' };
  try {
    const config = await configuration(previous.registration);
    await oidc.tokenRevocation(config, previous.tokens.refreshToken, { token_type_hint: 'refresh_token' });
    return { signedOut: true, remoteRevocation: previous.refreshAttempt ? 'unconfirmed' : 'confirmed' };
  } catch { return { signedOut: true, remoteRevocation: 'unconfirmed' }; }
}
