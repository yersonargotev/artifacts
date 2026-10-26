import { emailConfiguration, type EmailConfiguration } from './email.ts';

export const scopes = ['openid', 'profile', 'offline_access', 'artifacts:read', 'artifacts:write', 'artifacts:publish'] as const;
export const identityScope = 'artifacts:read';

export type Environment = Readonly<Record<string, string | undefined>>;
type DatabaseEnvironment = { DATABASE_URL: string; DATABASE_AUTH_TOKEN?: string };
type PublicOrigins = { AUTH_URL: string; MCP_URL: string; DASHBOARD_URL: string; PUBLISH_URL: string };
export type AuthWorkerEnvironment = Pick<PublicOrigins, 'AUTH_URL' | 'MCP_URL' | 'DASHBOARD_URL'> & DatabaseEnvironment & { BETTER_AUTH_SECRET: string };
export type McpWorkerEnvironment = Pick<PublicOrigins, 'AUTH_URL' | 'MCP_URL' | 'PUBLISH_URL'> & DatabaseEnvironment & { MCP_INTROSPECTION_CLIENT_ID: string; MCP_INTROSPECTION_CLIENT_SECRET: string };
export type DashboardWorkerEnvironment = PublicOrigins & DatabaseEnvironment & { PANEL_CLIENT_ID: string; PANEL_CLIENT_SECRET: string; PUBLICATION_SERVICE_SECRET: string };
export type PublicationWorkerEnvironment = Pick<PublicOrigins, 'DASHBOARD_URL' | 'PUBLISH_URL'> & { PUBLICATION_SERVICE_SECRET: string; PUBLICATION_COOKIE_SECRET: string };

export function required(name: string, env: Environment = process.env): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function serviceUrl(name: string, env: Environment = process.env): string {
  const value = new URL(required(name, env));
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(value.hostname);
  if (value.username || value.password || value.search || value.hash || (value.protocol !== 'https:' && !(loopback && value.protocol === 'http:'))) {
    throw new Error(`${name} requires HTTPS, or HTTP on an exact loopback host, without credentials, query, or fragment`);
  }
  if (['AUTH_URL', 'DASHBOARD_URL', 'PUBLISH_URL'].includes(name) && value.pathname !== '/') {
    throw new Error(`${name} must be an origin without a path`);
  }
  return value.href.replace(/\/$/, '');
}

export function authConfig(env: Environment = process.env): { origin: string; issuer: string; secret: string; resource: string; dashboard: string; email?: EmailConfiguration } {
  const origin = serviceUrl('AUTH_URL', env);
  const secret = required('BETTER_AUTH_SECRET', env);
  if (secret.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters');
  return { origin, issuer: `${origin}/api/auth`, secret, resource: serviceUrl('MCP_URL', env), dashboard: serviceUrl('DASHBOARD_URL', env), email: emailConfiguration(env, origin) };
}

export function mcpConfig(env: Environment = process.env) {
  return {
    issuer: `${serviceUrl('AUTH_URL', env)}/api/auth`,
    resource: serviceUrl('MCP_URL', env),
    clientId: required('MCP_INTROSPECTION_CLIENT_ID', env),
    clientSecret: required('MCP_INTROSPECTION_CLIENT_SECRET', env),
  };
}

export function dashboardConfig(env: Environment = process.env) {
  const origin = serviceUrl('DASHBOARD_URL', env);
  const auth = serviceUrl('AUTH_URL', env);
  if (new URL(origin).hostname === new URL(auth).hostname) throw new Error('AUTH_URL and DASHBOARD_URL must use distinct cookie hosts');
  return { origin, auth, issuer: `${auth}/api/auth`, clientId: required('PANEL_CLIENT_ID', env), clientSecret: required('PANEL_CLIENT_SECRET', env) };
}

export function publicationConfig(env: Environment = process.env) {
  const origin = serviceUrl('PUBLISH_URL', env);
  const dashboard = serviceUrl('DASHBOARD_URL', env);
  const hostname = new URL(origin).hostname;
  if (hostname === new URL(dashboard).hostname || (env.AUTH_URL && hostname === new URL(serviceUrl('AUTH_URL', env)).hostname)) {
    throw new Error('PUBLISH_URL must use a distinct cookie host');
  }
  const serviceSecret = required('PUBLICATION_SERVICE_SECRET', env);
  const cookieSecret = required('PUBLICATION_COOKIE_SECRET', env);
  if (serviceSecret.length < 32 || cookieSecret.length < 32) throw new Error('Publication secrets must contain at least 32 characters');
  return { origin, dashboard, serviceSecret, cookieSecret };
}

export function listener(prefix: 'AUTH' | 'MCP', defaultPort: number) {
  const port = Number(process.env[`${prefix}_PORT`] ?? defaultPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${prefix}_PORT must be a valid TCP port`);
  return { hostname: process.env[`${prefix}_BIND_HOST`] ?? '127.0.0.1', port };
}
