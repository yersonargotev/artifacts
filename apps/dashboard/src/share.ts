import { ArtifactError, shareSchema, unshareSchema, type Actor, type Share, type ShareResult } from '@artifacts/artifacts/contracts';
import type { ArtifactStore } from '@artifacts/artifacts';
import type { Panel } from '@artifacts/artifacts/panel';
import { readForm } from './form.ts';

export type ShareCommand = Readonly<{ requestId: string } & ({ intent: 'share'; email: string; notify?: true; requireNew?: true } | { intent: 'unshare'; shareId: string })>;
export type ShareNotice = 'requested' | 'disabled' | 'rate_limited';
export type ShareSubmission = { outcome: 'confirmed'; result?: ShareResult; notice?: ShareNotice } | { outcome: 'share_limit'; scope: 'artifact' | 'owner' } | { outcome: 'invalid' | 'conflict' | 'uncertain' };
export const shareNotices: Record<ShareNotice, string> = {
  requested: 'Acceso concedido. Aviso por correo solicitado.',
  disabled: 'Acceso concedido. Los avisos por correo no están habilitados.',
  rate_limited: 'Acceso concedido. Alcanzaste el límite diario de avisos. Podrás solicitar otro a partir de las 00:00 UTC.',
};
export const encodeShareCommand = (command: ShareCommand) => new URLSearchParams(Object.entries(command).map(([key, value]) => [key, String(value)]));
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
  const fields = await readForm(request, { requestId: [1, 1], intent: [1, 1], email: [0, 1], shareId: [0, 1], notify: [0, 1], requireNew: [0, 1] }, 4096);
  if (!fields) throw invalid();
  const requestId = shareSchema.shape.requestId.safeParse(fields.get('requestId'));
  if (!requestId.success) throw invalid();
  const intent = fields.get('intent');
  if (['notify', 'requireNew'].some((key) => fields.has(key) && fields.get(key) !== 'true')) throw invalid();
  if (intent === 'share' && fields.has('email') && !fields.has('shareId')) return { requestId: requestId.data, intent, email: fields.get('email')!, ...(fields.has('notify') ? { notify: true } : {}), ...(fields.has('requireNew') ? { requireNew: true } : {}) };
  const shareId = unshareSchema.shape.shareId.safeParse(fields.get('shareId'));
  if (intent === 'unshare' && shareId.success && !fields.has('email') && !fields.has('notify') && !fields.has('requireNew')) return { requestId: requestId.data, intent, shareId: shareId.data };
  throw invalid();
}

export async function submitShare(store: Store, actor: Actor, artifactId: string, command: ShareCommand): Promise<ShareSubmission> {
  await store.read(actor, { artifactId });
  const { intent, ...payload } = command;
  const input = intent === 'share' ? shareSchema.safeParse({ artifactId, ...payload }) : unshareSchema.safeParse({ artifactId, ...payload });
  if (!input.success) return { outcome: 'invalid' };
  try {
    if ('email' in input.data) {
      const result = await store.share(actor, input.data);
      const notice = result.notification?.status === 'requested' ? 'requested' : result.notification?.reason;
      return { outcome: 'confirmed', ...(input.data.notify || input.data.requireNew ? { result } : {}), ...(notice ? { notice } : {}) };
    }
    await store.unshare(actor, input.data);
    return { outcome: 'confirmed' };
  } catch (error) {
    if (!(error instanceof ArtifactError)) return { outcome: 'uncertain' };
    if (error.code === 'request_conflict') return { outcome: 'conflict' };
    if (error.code === 'conflict' && error.details.reason === 'share_limit' && (error.details.scope === 'artifact' || error.details.scope === 'owner')) return { outcome: 'share_limit', scope: error.details.scope };
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
