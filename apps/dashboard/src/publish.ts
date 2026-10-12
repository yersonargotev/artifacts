import type { createArtifactStore } from '@artifacts/artifacts';
import { ArtifactError, publishSchema, type Actor, type ArtifactRead, type Publication } from '@artifacts/artifacts/contracts';

export type PublishCommand = { artifactId: string; revisionId: string; expectedPublicationVersion: number; requestId: string };
export type PublicationOutcome =
  | { kind: 'published' | 'superseded'; committed: Publication; observed: ArtifactRead }
  | { kind: 'conflict'; observed: ArtifactRead | undefined }
  | { kind: 'uncertain' };

export async function parsePublicationForm(request: Request, artifactId: string | undefined): Promise<PublishCommand> {
  if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new Response('Usa el formulario de publicación.', { status: 400 });
  const body = await request.text();
  if (body.length > 4096) throw new Response('El formulario no es válido.', { status: 400 });
  try {
    for (const part of body.split('&')) for (const value of part.split('=')) decodeURIComponent(value.replace(/\+/g, ' '));
  } catch { throw new Response('El formulario no es válido.', { status: 400 }); }
  const fields = new URLSearchParams(body);
  const names = ['artifactId', 'revisionId', 'expectedPublicationVersion', 'requestId'];
  if ([...fields.keys()].some((name) => !names.includes(name)) || names.some((name) => fields.getAll(name).length !== 1)) throw new Response('El formulario no es válido.', { status: 400 });
  const version = fields.get('expectedPublicationVersion')!;
  if (!/^(0|[1-9]\d*)$/.test(version) || !Number.isSafeInteger(Number(version)) || fields.get('artifactId') !== artifactId) throw new Response('El formulario no coincide con este artefacto.', { status: 400 });
  return publishSchema.parse({ ...Object.fromEntries(fields), expectedPublicationVersion: Number(version) });
}

export async function publishSelectedRevision(store: Pick<ReturnType<typeof createArtifactStore>, 'publish' | 'read'>, actor: Actor, command: PublishCommand): Promise<PublicationOutcome> {
  let committed: Publication;
  try {
    committed = await store.publish(actor, command);
  } catch (error) {
    if (!(error instanceof ArtifactError)) return { kind: 'uncertain' };
    if (error.code !== 'conflict' && error.code !== 'request_conflict') throw error;
    const observed = await store.read(actor, { artifactId: command.artifactId, revisionId: command.revisionId }).catch(() => undefined);
    return { kind: 'conflict', observed };
  }
  try {
    const observed = await store.read(actor, { artifactId: command.artifactId, revisionId: command.revisionId });
    const current = observed.publication;
    return { kind: current?.revisionId === committed.revisionId && current.version === committed.version && current.url === committed.url ? 'published' : 'superseded', committed, observed };
  } catch { return { kind: 'uncertain' }; }
}
