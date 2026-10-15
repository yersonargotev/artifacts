import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import * as oidc from 'openid-client';
import { canonicalResource, identitySchema, protectedResourceMetadataUrl, restBase, type Identity } from '@artifacts/contracts/http';
import { z } from 'zod';
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

async function boundedFetch(url: URL | string, options: RequestInit = {}): Promise<Response> {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(networkTimeout)]) : AbortSignal.timeout(networkTimeout);
  const response = await fetch(url, { ...options, redirect: 'manual', signal });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error('Authentication redirects are not allowed');
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
        if (size > 1024 * 1024) throw new Error('Authentication response is too large');
        chunks.push(chunk.value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
  }
  return new Response(size ? Buffer.concat(chunks) : null, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function discoveryOptions(issuer: string, signal?: AbortSignal): oidc.DiscoveryRequestOptions {
  endpoint(issuer);
  return {
    timeout: networkTimeout / 1000,
    execute: [...(new URL(issuer).protocol === 'http:' ? [oidc.allowInsecureRequests] : []), oidc.enableNonRepudiationChecks],
    [oidc.customFetch]: (url, options) => boundedFetch(endpoint(url, issuer), { ...options, signal: signal && options.signal ? AbortSignal.any([signal, options.signal]) : signal ?? options.signal, body: options.body instanceof Uint8Array ? Uint8Array.from(options.body) : options.body }),
  };
}

function validateConfiguration(config: oidc.Configuration, issuer: string): void {
  const metadata = config.serverMetadata();
  if (metadata.issuer !== issuer) throw new Error('OAuth issuer metadata does not match the configured issuer');
  for (const [key, value] of Object.entries(metadata)) {
    if ((key.endsWith('_endpoint') || key === 'jwks_uri') && typeof value === 'string') endpoint(value, issuer);
  }
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) throw new Error('OAuth metadata is missing authorization or token endpoints');
  if (config.clientMetadata().client_secret || config.clientMetadata().token_endpoint_auth_method !== 'none') throw new Error('The CLI requires a public OAuth client without a secret');
}

async function configuration(registration: Registration, signal?: AbortSignal): Promise<oidc.Configuration> {
  const config = await oidc.discovery(new URL(registration.issuer), registration.clientId, { token_endpoint_auth_method: 'none', id_token_signed_response_alg: 'EdDSA' }, oidc.None(), discoveryOptions(registration.issuer, signal));
  validateConfiguration(config, registration.issuer);
  return config;
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
    const response = await boundedFetch(protectedResourceMetadataUrl(resource));
    if (!response.ok) throw new Error('Cannot discover the protected resource');
    const metadata = resourceMetadata.parse(await response.json());
    if (metadata.resource !== resource) throw new Error('Protected resource metadata does not match the exact server URL');
    const issuer = metadata.authorization_servers[0]!;
    endpoint(issuer);
    listener = await callback();
    const { redirectUri, signal } = listener;
    const config = await store.exclusive(async () => {
      const profile = store.read(resource);
      if (profile.epoch !== epoch) throw new Error('Login was superseded by another login or logout');
      if (profile.registration?.issuer === issuer) return configuration(profile.registration, signal);
      const registered = await oidc.dynamicClientRegistration(new URL(issuer), {
        client_name: 'Artifacts CLI', application_type: 'native', token_endpoint_auth_method: 'none', id_token_signed_response_alg: 'EdDSA',
        redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: scopes,
      }, oidc.None(), discoveryOptions(issuer, signal));
      validateConfiguration(registered, issuer);
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
    return await store.exclusive(async () => {
      const profile = store.read(resource);
      if (profile.epoch !== epoch) throw new Error('Login was superseded by another login or logout');
      const tokens = await oidc.authorizationCodeGrant(config, currentUrl, { expectedState: state, expectedNonce: nonce, pkceCodeVerifier: verifier, idTokenExpected: true }, { resource });
      const credentials = tokenRecord(tokens);
      const identityResponse = await boundedFetch(`${restBase(resource)}/identity`, { signal, headers: { authorization: `Bearer ${credentials.accessToken}` } });
      if (!identityResponse.ok) throw new Error('The OAuth grant cannot access this Artifacts server');
      const identity = identitySchema.parse(await identityResponse.json());
      const claims = tokens.claims()!;
      if (claims.sub !== identity.userId || (claims.sid !== undefined && claims.sid !== identity.sessionId)) throw new Error('OAuth identity does not match the Artifacts session');
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
