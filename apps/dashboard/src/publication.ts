import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ArtifactError, viewerSchema, readSchema } from '@artifacts/artifacts/contracts';
import type { Actor } from '@artifacts/artifacts/contracts';
import type { PanelIdentity } from './identity.ts';

export const publicationReadSchema = z.strictObject({ viewer: viewerSchema, ...readSchema.shape });
export const servicePaths = new Set(['/internal/publication/consume', '/internal/publication/read']);

export function publicationServiceAuthorized(request: Request, secret: string | undefined) {
  if (!secret || secret.length < 32 || request.method !== 'POST') return false;
  const supplied = request.headers.get('authorization') ?? '';
  return timingSafeEqual(createHash('sha256').update(supplied).digest(), createHash('sha256').update(`Bearer ${secret}`).digest());
}

export function panelActor(identity: PanelIdentity): Actor {
  return { userId: identity.userId, sessionId: identity.sessionId, clientId: identity.clientId, scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
}

export function artifactErrorResponse(error: unknown) {
  const status = error instanceof z.ZodError ? 400 : error instanceof ArtifactError ? ({ forbidden: 403, not_found: 404, conflict: 409, request_conflict: 409, invalid_grant: 403 })[error.code] : 503;
  return new Response(status === 503 ? 'El servicio no está disponible.' : 'No se puede abrir este artefacto.', { status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
}
