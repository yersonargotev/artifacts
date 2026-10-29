import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { authConfig, dashboardConfig, mcpConfig, publicationConfig, type Environment } from '../packages/config/src/index.ts';
import { emailTransportConfiguration } from '../packages/config/src/email.ts';
import auth from '../apps/auth/cloudflare.config.ts';
import mcp from '../apps/mcp/cloudflare.config.ts';
import panel from '../apps/dashboard/cloudflare.config.ts';
import view from '../apps/publication/cloudflare.config.ts';
import { workerOrigins } from './cloudflare.ts';

const services = { auth, mcp, view, panel };
type Service = keyof typeof services;
const releaseOrder = Object.keys(services) as Service[];
type RuntimeSecrets = Record<string, string>;
type ReleaseOptions = {
  environment?: Environment;
  root?: string;
  temporaryRoot?: string;
  dryRun?: boolean;
  deployWorker?: (service: Service, secretsFile: string, dryRun: boolean) => Promise<void>;
  verifyAccount?: () => Promise<void>;
  currentMain?: () => Promise<string>;
  smoke?: (serviceSecret: string) => Promise<void>;
};
type SmokeOptions = { request?: typeof fetch; attempts?: number; delayMs?: number };

export function projectRuntimeSecrets(environment: Environment): Record<Service, RuntimeSecrets> {
  let input: unknown;
  try { input = JSON.parse(environment.ARTIFACTS_RUNTIME_SECRETS ?? ''); }
  catch { throw new Error('ARTIFACTS_RUNTIME_SECRETS must be a JSON object'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('ARTIFACTS_RUNTIME_SECRETS must be a JSON object');
  const bindings = Object.fromEntries(releaseOrder.map((service) => [service, Object.entries(services[service].worker.env).filter(([, binding]) => binding.type === 'secret').map(([name]) => name)])) as Record<Service, string[]>;
  const required = new Set(Object.values(bindings).flat());
  const entries = Object.entries(input);
  if (entries.some(([name]) => !required.has(name))) throw new Error('ARTIFACTS_RUNTIME_SECRETS contains undeclared bindings');
  const values = Object.fromEntries(entries);
  for (const name of required) {
    if (typeof values[name] !== 'string' || !values[name].trim() || /[\x00-\x1f\x7f]/.test(values[name])) throw new Error(`${name} must be a nonempty string without control characters`);
  }
  const secrets = values as RuntimeSecrets;
  const projected = Object.fromEntries(releaseOrder.map((service) => [service, Object.fromEntries(bindings[service].map((name) => [name, secrets[name]!]))])) as Record<Service, RuntimeSecrets>;
  const effective = (service: Service) => ({ ...Object.fromEntries(Object.entries(services[service].worker.env).flatMap(([name, binding]) => binding.type === 'text' ? [[name, binding.value]] : [])), ...projected[service] });
  authConfig(effective('auth'));
  mcpConfig(effective('mcp'));
  dashboardConfig(effective('panel'));
  publicationConfig(effective('view'));
  for (const service of ['mcp', 'panel'] as const) emailTransportConfiguration(effective(service), workerOrigins.AUTH_URL);
  let database: URL;
  try { database = new URL(secrets.DATABASE_URL!); }
  catch { throw new Error('DATABASE_URL must be a remote libSQL URL'); }
  if (!['libsql:', 'https:'].includes(database.protocol) || !database.hostname || database.username || database.password || database.search || database.hash) throw new Error('DATABASE_URL must be a remote libSQL URL without credentials, query, or fragment');
  return projected;
}

function cloudflareCredentials(environment: Environment) {
  const token = environment.CLOUDFLARE_API_TOKEN;
  const accountId = environment.CLOUDFLARE_ACCOUNT_ID;
  if (!token || /[\s\x00-\x1f\x7f]/.test(token)) throw new Error('CLOUDFLARE_API_TOKEN is missing or malformed');
  if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('CLOUDFLARE_ACCOUNT_ID must contain 32 hexadecimal characters');
  return { token, accountId: accountId.toLowerCase() };
}

export async function verifyCloudflareAccount(environment: Environment, request: typeof fetch = fetch) {
  const { token, accountId } = cloudflareCredentials(environment);
  try {
    const response = await request(`https://api.cloudflare.com/client/v4/accounts/${accountId}`, { redirect: 'error', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    const body = await response.json() as { success?: boolean; result?: { id?: string } };
    if (!response.ok || body.success !== true || body.result?.id !== accountId) throw new Error('Account verification failed');
  } catch { throw new Error('Cloudflare token could not read the configured account'); }
}

async function validateBundles(root: string) {
  for (const service of releaseOrder) {
    const directory = join(root, 'dist/workers', service);
    const output = join(directory, '.cloudflare/output/v0');
    const { entrypoint: _entrypoint, ...worker } = services[service].worker;
    const expected = {
      ...worker,
      ...(service === 'panel' ? { env: { ...worker.env, ASSETS: { type: 'assets' } }, assets: { runWorkerFirst: true } } : {}),
      manifest: { type: 'complete', mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm' } } },
    };
    const config: unknown = JSON.parse(await readFile(join(output, 'workers/default/worker.config.json'), 'utf8'));
    const build: unknown = JSON.parse(await readFile(join(output, 'config.json'), 'utf8'));
    const generated = await readFile(join(directory, 'cloudflare.config.ts'), 'utf8');
    const source: unknown = JSON.parse(generated.replace(/^export default /, '').replace(/;\s*$/, ''));
    if (!isDeepStrictEqual(config, expected) || !isDeepStrictEqual(build, { buildContext: { isPreview: false } }) || !isDeepStrictEqual(source, services[service])) throw new Error(`${service} bundle configuration does not match the checked source`);
    const bundle = await stat(join(output, 'workers/default/bundle/worker.mjs'));
    if (!bundle.isFile() || bundle.size === 0) throw new Error(`${service} Worker bundle is empty`);
    if (service === 'panel' && (await readdir(join(output, 'workers/default/assets'))).length === 0) throw new Error('Panel assets are missing');
  }
}

function githubRelease(environment: Environment) {
  if (environment.GITHUB_EVENT_NAME !== 'push' || environment.GITHUB_REF !== 'refs/heads/main') throw new Error('Production releases require a push to main');
  if (!environment.GITHUB_SHA || !/^[a-f0-9]{40}$/.test(environment.GITHUB_SHA)) throw new Error('GITHUB_SHA is missing or malformed');
  if (!environment.GITHUB_REPOSITORY || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(environment.GITHUB_REPOSITORY) || !environment.GITHUB_TOKEN) throw new Error('GitHub repository and read token are required');
  return { sha: environment.GITHUB_SHA, repository: environment.GITHUB_REPOSITORY, token: environment.GITHUB_TOKEN };
}

export async function releaseProduction(options: ReleaseOptions = {}) {
  const environment = options.environment ?? process.env;
  const root = options.root ?? fileURLToPath(new URL('..', import.meta.url));
  const projected = projectRuntimeSecrets(environment);
  const github = options.dryRun ? undefined : githubRelease(environment);
  if (github) cloudflareCredentials(environment);
  await validateBundles(root);
  if (github) await (options.verifyAccount ?? (() => verifyCloudflareAccount(environment)))();
  const directory = await mkdtemp(join(options.temporaryRoot ?? environment.RUNNER_TEMP ?? tmpdir(), 'artifacts-release-'));
  try {
    const files = {} as Record<Service, string>;
    for (const service of releaseOrder) {
      files[service] = join(directory, `${service}.json`);
      await writeFile(files[service], JSON.stringify(projected[service]), { mode: 0o600, flag: 'wx' });
    }
    const deployWorker = options.deployWorker ?? (async (service: Service, secretsFile: string, dryRun: boolean) => {
      const { ARTIFACTS_RUNTIME_SECRETS: _runtime, GITHUB_TOKEN: _github, ...childEnvironment } = environment;
      await new Promise<void>((accept, reject) => {
        const child = spawn('pnpm', ['deploy:worker', service, '--secrets-file', secretsFile, ...(dryRun ? ['--dry-run'] : [])], { cwd: root, env: childEnvironment, stdio: 'ignore', timeout: 240_000 });
        child.on('error', () => reject(new Error(`${service} deployment command could not start`)));
        child.on('exit', (code) => code === 0 ? accept() : reject(new Error(`${service} ${dryRun ? 'dry run' : 'deployment'} failed`)));
      });
    });
    for (const service of releaseOrder) {
      await deployWorker(service, files[service], true);
      console.log(`Dry run passed for ${service}`);
    }
    if (!github) return;
    const current = options.currentMain ? await options.currentMain() : await (async () => {
      const response = await fetch(`https://api.github.com/repos/${github.repository}/git/ref/heads/main`, { redirect: 'error', headers: { authorization: `Bearer ${github.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('Could not verify current main');
      const body = await response.json() as { object?: { sha?: unknown } };
      return body.object?.sha;
    })();
    if (typeof current !== 'string' || !/^[a-f0-9]{40}$/.test(current)) throw new Error('Could not verify current main');
    if (current !== github.sha) {
      console.log('Skipped superseded release. The revision is no longer current main.');
      return;
    }
    for (const service of releaseOrder) {
      await deployWorker(service, files[service], false);
      console.log(`Deployed ${service}`);
    }
    await (options.smoke ?? smokeProduction)(projected.view.PUBLICATION_SERVICE_SECRET!);
    console.log('Production read-only smoke passed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function smokeProduction(serviceSecret: string, options: SmokeOptions = {}) {
  const request = options.request ?? fetch;
  const issuer = `${workerOrigins.AUTH_URL}/api/auth`;
  const artifactId = randomUUID();
  const send = (url: string, init: RequestInit = {}) => request(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(5000) });
  const expect = (condition: unknown) => { if (!condition) throw new Error('Unexpected production response'); };
  async function probe(name: string, check: () => Promise<void>) {
    for (let attempt = 1; attempt <= (options.attempts ?? 4); attempt++) {
      try { await check(); return; }
      catch {
        if (attempt === (options.attempts ?? 4)) throw new Error(`Production smoke failed for ${name}`);
        await new Promise((accept) => setTimeout(accept, options.delayMs ?? 1500));
      }
    }
  }
  for (const origin of [workerOrigins.AUTH_URL, new URL(workerOrigins.MCP_URL).origin]) {
    await probe(`${origin}/health`, async () => {
      const response = await send(`${origin}/health`);
      expect(response.status === 200 && (await response.json()).status === 'ok');
    });
  }
  await probe('OIDC discovery', async () => {
    const response = await send(`${issuer}/.well-known/openid-configuration`);
    const body = await response.json();
    expect(response.status === 200 && body.issuer === issuer);
    for (const name of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
      const endpoint = new URL(body[name]);
      expect(endpoint.origin === workerOrigins.AUTH_URL && endpoint.pathname.startsWith('/api/auth/'));
    }
  });
  const metadata = `${new URL(workerOrigins.MCP_URL).origin}/.well-known/oauth-protected-resource${new URL(workerOrigins.MCP_URL).pathname}`;
  await probe('MCP discovery', async () => {
    const response = await send(metadata);
    const body = await response.json();
    expect(response.status === 200 && body.resource === workerOrigins.MCP_URL && isDeepStrictEqual(body.authorization_servers, [issuer]));
  });
  await probe('anonymous MCP denial', async () => {
    const response = await send(workerOrigins.MCP_URL);
    expect(response.status === 401 && (await response.json()).error === 'unauthenticated' && response.headers.get('www-authenticate')?.includes(`resource_metadata="${metadata}"`));
  });
  await probe('REST discovery', async () => {
    const response = await send(`${workerOrigins.API_URL}/.well-known/oauth-protected-resource`);
    const body = await response.json();
    expect(response.status === 200 && body.resource === workerOrigins.API_URL && isDeepStrictEqual(body.authorization_servers, [issuer]));
  });
  await probe('anonymous REST denial', async () => {
    const response = await send(`${workerOrigins.API_URL}/v1/identity`);
    const body = await response.json();
    expect(response.status === 401 && body.error?.code === 'unauthenticated');
  });
  await probe('panel and assets', async () => {
    const response = await send(workerOrigins.DASHBOARD_URL);
    const html = await response.text();
    expect(response.status === 200 && html.includes('href="/auth/login"') && response.headers.get('cache-control') === 'no-store');
    const css = [...html.matchAll(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/g)].map((match) => new URL(match[1]!, workerOrigins.DASHBOARD_URL)).find((url) => url.origin === workerOrigins.DASHBOARD_URL && url.pathname.startsWith('/_astro/') && url.pathname.endsWith('.css'));
    if (css) {
      const asset = await send(css.href);
      expect(asset.status === 200 && asset.headers.get('content-type')?.includes('text/css') && (await asset.text()).trim().length > 0);
    } else {
      expect([...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].some((match) => match[1]!.trim().length > 0));
    }
  });
  await probe('publication transaction', async () => {
    const response = await send(`${workerOrigins.PUBLISH_URL}/a/${artifactId}`);
    const target = new URL(response.headers.get('location')!);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(response.status === 303 && target.origin === workerOrigins.DASHBOARD_URL && target.pathname === '/publication/open' && target.searchParams.size === 2 && target.searchParams.get('artifactId') === artifactId && /^[A-Za-z0-9_-]{43}$/.test(target.searchParams.get('state') ?? ''));
    expect(cookie.startsWith('__Host-artifacts-publication-transaction=') && /; Path=\//.test(cookie) && /; Secure; HttpOnly; SameSite=Lax/.test(cookie) && !/Domain=/i.test(cookie) && response.headers.get('cache-control') === 'private, no-store');
  });
  await probe('anonymous attachment denial', async () => {
    const response = await send(`${workerOrigins.PUBLISH_URL}/a/${artifactId}/r/${randomUUID()}/files/probe.txt`);
    expect(response.status === 401 && await response.text() === 'Acceso denegado');
  });
  await probe('anonymous callback denial', async () => {
    const response = await send(`${workerOrigins.PUBLISH_URL}/callback`);
    expect(response.status === 403);
  });
  await probe('anonymous internal service denial', async () => {
    const response = await send(`${workerOrigins.DASHBOARD_URL}/internal/publication/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status === 403 && await response.text() === 'Access denied');
  });
  await probe('database-backed absent-session denial', async () => {
    const response = await send(`${workerOrigins.DASHBOARD_URL}/internal/publication/read`, {
      method: 'POST', headers: { authorization: `Bearer ${serviceSecret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ artifactId, viewer: { artifactId, userId: randomUUID(), sessionId: randomUUID(), expiresAt: Date.now() + 60_000 } }),
    });
    expect(response.status === 403 && await response.text() === 'No se puede abrir este artefacto.' && response.headers.get('cache-control') === 'private, no-store' && response.headers.get('x-content-type-options') === 'nosniff');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--dry-run') || args.length > 1) throw new Error('Use release:production with optional --dry-run');
  await releaseProduction({ dryRun: args.includes('--dry-run') });
}
