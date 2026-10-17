import { z } from 'zod';
import type { Panel } from '@artifacts/artifacts/panel';
import type { MoveSubject, PanelMoveResult } from '@artifacts/artifacts/panel/model';
import { ArtifactError, moveSchema, projectNameSchema, type Actor } from '@artifacts/artifacts/contracts';
import { readForm } from './form.ts';
import { moveHref, readMoveUrl, scopeHref } from './urls.ts';

export type MoveForm = { artifactIds: string[]; requestId: string; project: string | undefined; intent: 'move' | 'remove' };
export type MoveOutcome =
  | { kind: 'moved'; location: string }
  | { kind: 'partial'; result: PanelMoveResult; location: string }
  | { kind: 'invalid' | 'conflict' | 'uncertain' };
export type MovePage =
  | { kind: 'redirect'; location: string }
  | { kind: 'render'; form: MoveForm; outcome: Exclude<MoveOutcome, { kind: 'moved' }> | { kind: 'confirm' }; subject: MoveSubject | undefined; status: number; freshHref: string };

export async function parseMoveForm(request: Request): Promise<MoveForm> {
  const invalid = () => new Response('El formulario para mover los artefactos no es válido.', { status: 400 });
  const fields = await readForm(request, { artifactId: [1, 25], requestId: [1, 1], project: [0, 1], intent: [1, 1] }, 4096);
  if (!fields) throw invalid();
  const intent = fields.get('intent');
  const parsed = z.strictObject({ artifactIds: z.array(moveSchema.shape.artifactId), requestId: moveSchema.shape.requestId })
    .safeParse({ artifactIds: fields.getAll('artifactId'), requestId: fields.get('requestId') });
  if (!parsed.success || (intent !== 'move' && intent !== 'remove') || (intent === 'move' && !fields.has('project'))) throw invalid();
  return { ...parsed.data, project: fields.get('project') ?? undefined, intent };
}

export async function submitMove(panel: Pick<Panel, 'move'>, actor: Actor, form: MoveForm): Promise<MoveOutcome> {
  let project: string | null = null;
  if (form.intent === 'move') {
    const name = projectNameSchema.safeParse(form.project);
    if (!name.success) return { kind: 'invalid' };
    project = name.data;
  }
  try {
    const result = await panel.move(actor, { requestId: form.requestId, artifactIds: form.artifactIds, project });
    const location = scopeHref(result.project === null ? { kind: 'unfiled' } : { kind: 'project', name: result.project });
    return result.missing.length ? { kind: 'partial', result, location } : { kind: 'moved', location };
  } catch (error) {
    if (!(error instanceof ArtifactError)) return { kind: 'uncertain' };
    if (error.code !== 'request_conflict') throw error;
    return { kind: 'conflict' };
  }
}

export async function prepareMovePage(panel: Pick<Panel, 'move' | 'moveSubject'>, actor: Actor, request: Request): Promise<MovePage> {
  const submitted = request.method === 'POST' ? await parseMoveForm(request) : undefined;
  const outcome = submitted ? await submitMove(panel, actor, submitted) : { kind: 'confirm' as const };
  if (outcome.kind === 'moved') return { kind: 'redirect', location: outcome.location };
  const ids = submitted?.artifactIds ?? readMoveUrl(new URL(request.url));
  const subject = await panel.moveSubject(actor, ids).catch((error: unknown) => {
    if (!submitted || error instanceof ArtifactError || error instanceof z.ZodError) throw error;
    return undefined;
  });
  const form = submitted ?? { artifactIds: ids, requestId: crypto.randomUUID(), project: subject?.items.length === 1 ? subject.items[0].project ?? '' : '', intent: 'move' as const };
  return { kind: 'render', form, outcome, subject, status: { confirm: 200, partial: 200, invalid: 400, conflict: 409, uncertain: 503 }[outcome.kind], freshHref: moveHref(form.artifactIds) };
}
