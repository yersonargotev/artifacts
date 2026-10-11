import { createHash, randomBytes } from 'node:crypto';
import * as oidc from 'openid-client';
import { and, eq, gt } from 'drizzle-orm';
import type { Database } from '@artifacts/db';
import { oidcTransaction, panelSession, session, user } from '@artifacts/db/schema';
import type { dashboardConfig } from '@artifacts/config';

export const panelCookie = 'artifacts-panel';
export const transactionCookie = 'artifacts-login';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
export type PanelIdentity = Readonly<{ userId: string; sessionId: string; name: string; clientId: string; scopes: string[]; expiresAt: Date }>;

export function createPanelIdentity(db: Database, config: ReturnType<typeof dashboardConfig>) {
  let provider: Promise<oidc.Configuration> | undefined;
  function getProvider() {
    return provider ??= oidc.discovery(new URL(config.issuer), config.clientId, { client_secret: config.clientSecret, id_token_signed_response_alg: 'EdDSA' }, oidc.ClientSecretBasic(config.clientSecret), {
      execute: [...(config.issuer.startsWith('http:') ? [oidc.allowInsecureRequests] : []), oidc.enableNonRepudiationChecks], timeout: 5,
    }).catch((error) => { provider = undefined; throw error; });
  }
  return {
    async startLogin() {
      const client = await getProvider();
      const token = random();
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const verifier = oidc.randomPKCECodeVerifier();
      await db.insert(oidcTransaction).values({ tokenHash: hash(token), state, nonce, verifier, expiresAt: new Date(Date.now() + 600_000) });
      const url = oidc.buildAuthorizationUrl(client, { redirect_uri: `${config.origin}/auth/callback`, scope: 'openid profile', state, nonce, code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256' });
      return { token, url };
    },
    async completeLogin(url: URL, token: string | undefined) {
      if (!token || !/^[\w-]{43}$/.test(token)) throw new Error('Invalid login transaction');
      const transactions = await db.delete(oidcTransaction).where(and(eq(oidcTransaction.tokenHash, hash(token)), gt(oidcTransaction.expiresAt, new Date()))).returning();
      const transaction = transactions[0];
      if (!transaction) throw new Error('Expired or used login transaction');
      const tokens = await oidc.authorizationCodeGrant(await getProvider(), url, { expectedState: transaction.state, expectedNonce: transaction.nonce, pkceCodeVerifier: transaction.verifier, idTokenExpected: true });
      const claims = tokens.claims();
      if (!claims || claims.iss !== config.issuer || typeof claims.sub !== 'string' || typeof claims.sid !== 'string' || !claims.sid) throw new Error('OIDC identity requires a central session');
      const sid = claims.sid;
      const subject = claims.sub;
      const panelToken = random();
      const expiresAt = await db.transaction(async (tx) => {
        const central = await tx.select().from(session).where(and(eq(session.id, sid), eq(session.userId, subject), gt(session.expiresAt, new Date()))).get();
        if (!central) throw new Error('Central session is no longer active');
        await tx.insert(panelSession).values({ tokenHash: hash(panelToken), authSessionId: sid, issuer: claims.iss, subject, clientId: config.clientId, scopes: (tokens.scope ?? 'openid profile').split(' '), expiresAt: central.expiresAt });
        return central.expiresAt;
      });
      return { token: panelToken, expiresAt };
    },
    async load(token: string | undefined): Promise<PanelIdentity | undefined> {
      if (!token || !/^[\w-]{43}$/.test(token)) return;
      return db.select({ userId: session.userId, sessionId: session.id, name: user.name, clientId: panelSession.clientId, scopes: panelSession.scopes, expiresAt: panelSession.expiresAt })
        .from(panelSession).innerJoin(session, eq(panelSession.authSessionId, session.id)).innerJoin(user, eq(session.userId, user.id))
        .where(and(eq(panelSession.tokenHash, hash(token)), eq(panelSession.issuer, config.issuer), eq(panelSession.subject, session.userId), eq(panelSession.clientId, config.clientId), gt(panelSession.expiresAt, new Date()), gt(session.expiresAt, new Date()))).get();
    },
    async logout(token: string | undefined) {
      if (token) await db.delete(panelSession).where(eq(panelSession.tokenHash, hash(token)));
    },
  };
}
