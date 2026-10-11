export const scopes = ['openid', 'profile', 'offline_access', 'artifacts:read', 'artifacts:write', 'artifacts:publish'] as const;
export const identityScope = 'artifacts:read';

export function required(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function serviceUrl(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = new URL(required(name, env));
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(value.hostname);
  if (value.username || value.password || value.search || value.hash || (value.protocol !== 'https:' && !(loopback && value.protocol === 'http:'))) {
    throw new Error(`${name} requires HTTPS, or HTTP on an exact loopback host, without credentials, query, or fragment`);
  }
  if ((name === 'AUTH_URL' || name === 'DASHBOARD_URL') && value.pathname !== '/') {
    throw new Error(`${name} must be an origin without a path`);
  }
  return value.href.replace(/\/$/, '');
}

export function authConfig(env: NodeJS.ProcessEnv = process.env) {
  const origin = serviceUrl('AUTH_URL', env);
  const secret = required('BETTER_AUTH_SECRET', env);
  if (secret.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters');
  return { origin, issuer: `${origin}/api/auth`, secret, resource: serviceUrl('MCP_URL', env), dashboard: serviceUrl('DASHBOARD_URL', env) };
}

export function mcpConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    issuer: `${serviceUrl('AUTH_URL', env)}/api/auth`,
    resource: serviceUrl('MCP_URL', env),
    clientId: required('MCP_INTROSPECTION_CLIENT_ID', env),
    clientSecret: required('MCP_INTROSPECTION_CLIENT_SECRET', env),
  };
}

export function dashboardConfig(env: NodeJS.ProcessEnv = process.env) {
  const origin = serviceUrl('DASHBOARD_URL', env);
  const auth = serviceUrl('AUTH_URL', env);
  if (new URL(origin).hostname === new URL(auth).hostname) throw new Error('AUTH_URL and DASHBOARD_URL must use distinct cookie hosts');
  return { origin, auth, issuer: `${auth}/api/auth`, clientId: required('PANEL_CLIENT_ID', env), clientSecret: required('PANEL_CLIENT_SECRET', env) };
}

export function listener(prefix: 'AUTH' | 'MCP', defaultPort: number) {
  const port = Number(process.env[`${prefix}_PORT`] ?? defaultPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${prefix}_PORT must be a valid TCP port`);
  return { hostname: process.env[`${prefix}_BIND_HOST`] ?? '127.0.0.1', port };
}
