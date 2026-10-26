import { ArtifactError, shareSchema, unshareSchema, type Actor, type Share } from '@artifacts/artifacts/contracts';
import type { ArtifactStore } from '@artifacts/artifacts';
import type { Panel } from '@artifacts/artifacts/panel';
import { readForm } from './form.ts';

export type ShareCommand = Readonly<{ requestId: string } & ({ intent: 'share'; email: string } | { intent: 'unshare'; shareId: string })>;
export type ShareOutcome = 'confirmed' | 'invalid' | 'conflict' | 'uncertain';
export type ShareView = {
  artifactId: string;
  title: string;
  published: boolean;
  shares: { kind: 'ready'; items: Share[] } | { kind: 'unavailable' };
  requestIds: { share: string; unshare: Record<string, string> };
};
type Store = Pick<ArtifactStore, 'read' | 'share' | 'unshare' | 'listShares'>;

export async function parseShareForm(request: Request): Promise<ShareCommand> {
  const invalid = () => new Response('El formulario para compartir no es válido.', { status: 400 });
  const fields = await readForm(request, { requestId: [1, 1], intent: [1, 1], email: [0, 1], shareId: [0, 1] }, 4096);
  if (!fields) throw invalid();
  const requestId = shareSchema.shape.requestId.safeParse(fields.get('requestId'));
  if (!requestId.success) throw invalid();
  const intent = fields.get('intent');
  if (intent === 'share' && fields.has('email') && !fields.has('shareId')) return { requestId: requestId.data, intent, email: fields.get('email')! };
  const shareId = unshareSchema.shape.shareId.safeParse(fields.get('shareId'));
  if (intent === 'unshare' && shareId.success && !fields.has('email')) return { requestId: requestId.data, intent, shareId: shareId.data };
  throw invalid();
}

export async function submitShare(store: Store, actor: Actor, artifactId: string, command: ShareCommand): Promise<ShareOutcome> {
  await store.read(actor, { artifactId });
  const input = command.intent === 'share' ? shareSchema.safeParse({ artifactId, requestId: command.requestId, email: command.email }) : unshareSchema.safeParse({ artifactId, requestId: command.requestId, shareId: command.shareId });
  if (!input.success) return 'invalid';
  try {
    if ('email' in input.data) await store.share(actor, input.data);
    else await store.unshare(actor, input.data);
    return 'confirmed';
  } catch (error) {
    if (!(error instanceof ArtifactError)) return 'uncertain';
    if (error.code === 'request_conflict') return 'conflict';
    throw error;
  }
}

export async function loadShareView(panel: Pick<Panel, 'artifact'>, store: Pick<Store, 'listShares'>, actor: Actor, artifactId: string) {
  const [subject, shares] = await Promise.all([
    panel.artifact(actor, { artifactId, includeComparison: false }),
    store.listShares(actor, { artifactId }).then(({ items }) => ({ kind: 'ready' as const, items })).catch((error: unknown) => {
      if (error instanceof ArtifactError) throw error;
      return { kind: 'unavailable' as const };
    }),
  ]);
  const view: ShareView = {
    artifactId, title: subject.detail.selected.revision.snapshot.metadata.title, published: subject.detail.publication !== null,
    shares, requestIds: { share: crypto.randomUUID(), unshare: Object.fromEntries(shares.kind === 'ready' ? shares.items.map((item) => [item.shareId, crypto.randomUUID()]) : []) },
  };
  return { view, workspace: subject.workspace };
}
