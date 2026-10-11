import { appendFile, chmod } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { authConfig, required } from '@artifacts/config';
import { openDatabase } from '@artifacts/db';
import { oauthClient, oauthClientResource, user } from '@artifacts/db/schema';
import { createAuth } from './auth.ts';

process.loadEnvFile();
const config = authConfig();
const { db, client } = await openDatabase({ url: required('DATABASE_URL'), authToken: process.env.DATABASE_AUTH_TOKEN });
const auth = createAuth(db, config, true);
try {
  const email = required('OWNER_EMAIL').toLowerCase();
  const owner = await db.select().from(user).where(eq(user.email, email)).get();
  if (!owner) await auth.api.signUpEmail({ body: { email, name: required('OWNER_NAME'), password: required('OWNER_PASSWORD') } });
  const signedIn = await auth.api.signInEmail({ body: { email, password: required('OWNER_PASSWORD') }, returnHeaders: true });
  const headers = new Headers({ cookie: signedIn.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ') });
  async function ensureResourceLink(clientId: string) {
    const link = await db.select().from(oauthClientResource).where(and(eq(oauthClientResource.clientId, clientId), eq(oauthClientResource.resourceId, config.resource))).get();
    if (!link) await auth.api.adminLinkClientResource({ headers, params: { identifier: config.resource, client_id: clientId } });
  }
  for (const kind of ['PANEL', 'MCP_INTROSPECTION'] as const) {
    const id = process.env[`${kind}_CLIENT_ID`];
    if (id) {
      const existing = await db.select().from(oauthClient).where(eq(oauthClient.clientId, id)).get();
      if (!existing) throw new Error(`${kind}_CLIENT_ID does not exist in this database`);
      if (kind === 'MCP_INTROSPECTION') await ensureResourceLink(id);
      continue;
    }
    const result = await auth.api.adminCreateOAuthClient({ headers, body: {
      client_name: kind === 'PANEL' ? 'Artifacts dashboard' : 'Artifacts MCP resource',
      redirect_uris: kind === 'PANEL' ? [`${config.dashboard}/auth/callback`] : [`${new URL(config.resource).origin}/oauth/unused`],
      token_endpoint_auth_method: 'client_secret_basic',
      application_type: config.dashboard.startsWith('http:') ? 'native' : 'web',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      scope: 'openid profile',
      enable_end_session: kind === 'PANEL',
      skip_consent: kind === 'PANEL',
      require_pkce: true,
      subject_type: 'public',
    } });
    if (!result.client_secret) throw new Error('Confidential client did not receive a secret');
    await appendFile('.env', `${kind}_CLIENT_ID=${result.client_id}\n${kind}_CLIENT_SECRET=${result.client_secret}\n`);
    process.env[`${kind}_CLIENT_ID`] = result.client_id;
    if (kind === 'MCP_INTROSPECTION') await ensureResourceLink(result.client_id);
  }
  await auth.api.signOut({ headers });
  await chmod('.env', 0o600);
  console.log('Owner and confidential clients are ready. Existing identities and secrets were preserved.');
} finally {
  client.close();
}
