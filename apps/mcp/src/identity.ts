import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { z } from 'zod';
import type { mcpConfig } from '@artifacts/config';

const principalBrand: unique symbol = Symbol('verified-principal');
export type Principal = Readonly<{ userId: string; sessionId: string; clientId: string; scopes: readonly string[]; [principalBrand]: true }>;
export type AccessDecision =
  | { kind: 'authorized'; principal: Principal }
  | { kind: 'unauthenticated' }
  | { kind: 'insufficient-scope'; required: readonly string[] }
  | { kind: 'unavailable' };
const claimsSchema = z.object({
  sub: z.string().min(1), sid: z.string().min(1), client_id: z.string().min(1),
  azp: z.string().min(1), scope: z.string(), iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]), exp: z.number(),
});

export function createMcpAuthorizer(config: ReturnType<typeof mcpConfig>) {
  const jwks = createRemoteJWKSet(new URL(`${config.issuer}/jwks`), { timeoutDuration: 3000 });
  return async (request: Request, required: readonly string[]): Promise<AccessDecision> => {
    const authorization = request.headers.get('authorization');
    const token = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!token) return { kind: 'unauthenticated' };
    let claims: z.infer<typeof claimsSchema>;
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer: config.issuer, audience: config.resource, requiredClaims: ['exp', 'iat', 'sub', 'sid'] });
      const parsed = claimsSchema.safeParse(payload);
      if (!parsed.success || payload.cnf || parsed.data.client_id !== parsed.data.azp) return { kind: 'unauthenticated' };
      claims = parsed.data;
    } catch (error) {
      if (error instanceof errors.JWTExpired || error instanceof errors.JWTClaimValidationFailed || error instanceof errors.JWSInvalid || error instanceof errors.JWSSignatureVerificationFailed || error instanceof errors.JWTInvalid || error instanceof errors.JWKSNoMatchingKey || error instanceof errors.JOSENotSupported) return { kind: 'unauthenticated' };
      return { kind: 'unavailable' };
    }
    try {
      const response = await fetch(`${config.issuer}/oauth2/introspect`, {
        method: 'POST',
        headers: { authorization: `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, token_type_hint: 'access_token' }),
        signal: AbortSignal.timeout(3000),
        redirect: 'manual',
      });
      if (response.status !== 200) return { kind: 'unavailable' };
      const body: unknown = await response.json();
      const status = z.object({ active: z.boolean() }).safeParse(body);
      if (!status.success) return { kind: 'unavailable' };
      if (!status.data.active) return { kind: 'unauthenticated' };
      const live = claimsSchema.safeParse(body);
      if (!live.success) return { kind: 'unavailable' };
      const sameScopes = (a: string, b: string) => [...new Set(a.split(' ').filter(Boolean))].sort().join(' ') === [...new Set(b.split(' ').filter(Boolean))].sort().join(' ');
      const audiences = Array.isArray(live.data.aud) ? live.data.aud : [live.data.aud];
      if (live.data.sub !== claims.sub || live.data.sid !== claims.sid || live.data.client_id !== claims.client_id || live.data.azp !== claims.azp || live.data.iss !== config.issuer || !audiences.includes(config.resource) || live.data.exp !== claims.exp || !sameScopes(live.data.scope, claims.scope)) return { kind: 'unauthenticated' };
      const granted = [...new Set(claims.scope.split(' ').filter(Boolean))];
      const missing = required.filter((scope) => !granted.includes(scope));
      if (missing.length) return { kind: 'insufficient-scope', required: missing };
      return { kind: 'authorized', principal: { userId: claims.sub, sessionId: claims.sid, clientId: claims.client_id, scopes: granted, [principalBrand]: true } };
    } catch {
      return { kind: 'unavailable' };
    }
  };
}
