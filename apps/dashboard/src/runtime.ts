import { createEmailSender } from '@artifacts/config/email-sender';
import { dashboardConfig, required, serviceUrl } from '@artifacts/config';
import { openDatabase } from '@artifacts/db';
import { createPanelIdentity } from './identity.ts';
import { createArtifactStore, type ArtifactStore } from '@artifacts/artifacts';
import { createPanel } from '@artifacts/artifacts/panel';

type DashboardStore = Pick<ArtifactStore, 'read' | 'share' | 'listShares' | 'listSharedWithMe' | 'unshare' | 'publish' | 'delete' | 'export' | 'move' | 'projects' | 'issuePublicationGrant' | 'consumePublicationGrant' | 'readPublished'>;

let runtime: ReturnType<typeof createRuntime> | undefined;
async function createRuntime() {
  const config = dashboardConfig();
  const { db } = await openDatabase({ url: required('DATABASE_URL'), authToken: process.env.DATABASE_AUTH_TOKEN });
  const options = { publishOrigin: serviceUrl('PUBLISH_URL'), sendInvitation: createEmailSender(process.env, config.origin) };
  const artifacts: DashboardStore = createArtifactStore(db, options);
  return { config, panel: createPanel(db, options), artifacts, identity: createPanelIdentity(db, config), cookieOptions: { httpOnly: true, secure: config.origin.startsWith('https:'), sameSite: 'lax' as const, path: '/' } };
}
export function getRuntime() {
  return runtime ??= createRuntime().catch((error) => { runtime = undefined; throw error; });
}
