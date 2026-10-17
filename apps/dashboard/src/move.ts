import type { createArtifactStore } from '@artifacts/artifacts';
import { ArtifactError, moveSchema, projectNameSchema, type Actor } from '@artifacts/artifacts/contracts';
import { readForm } from './form.ts';

export type MoveForm = { artifactId: string; requestId: string; project: string; intent: 'move' | 'remove' };
export type MoveOutcome = { kind: 'moved'; location: string } | { kind: 'invalid' | 'conflict' | 'uncertain' };

export async function parseMoveForm(request: Request, artifactId: string | undefined): Promise<MoveForm> {
  const invalid = () => new Response('El formulario para mover el artefacto no es válido.', { status: 400 });
  const fields = await readForm(request, ['artifactId', 'requestId', 'project', 'intent']);
  if (!fields) throw invalid();
  const intent = fields.get('intent');
  const parsed = moveSchema.pick({ artifactId: true, requestId: true }).safeParse({ artifactId: fields.get('artifactId'), requestId: fields.get('requestId') });
  if (!parsed.success || parsed.data.artifactId !== artifactId || (intent !== 'move' && intent !== 'remove')) throw invalid();
  return { ...parsed.data, project: fields.get('project')!, intent };
}

export async function submitMove(store: Pick<ReturnType<typeof createArtifactStore>, 'move'>, actor: Actor, form: MoveForm): Promise<MoveOutcome> {
  let project: string | null = null;
  if (form.intent === 'move') {
    const name = projectNameSchema.safeParse(form.project);
    if (!name.success) return { kind: 'invalid' };
    project = name.data;
  }
  try {
    const moved = await store.move(actor, { requestId: form.requestId, artifactId: form.artifactId, project });
    return { kind: 'moved', location: moved.project === null ? '/' : `/?${new URLSearchParams({ project: moved.project })}` };
  } catch (error) {
    if (!(error instanceof ArtifactError)) return { kind: 'uncertain' };
    if (error.code !== 'request_conflict') throw error;
    return { kind: 'conflict' };
  }
}
