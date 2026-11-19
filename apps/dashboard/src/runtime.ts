import { createEmailSender } from '@artifacts/config/email-sender';
import { dashboardConfig, required, serviceUrl } from '@artifacts/config';
import { openDatabase, type Database } from '@artifacts/db';
import { createPanelIdentity } from './identity.ts';
import { createArtifactStore, type ArtifactStore } from '@artifacts/artifacts';
import { createPanel } from '@artifacts/artifacts/panel';

type DashboardStore = Pick<ArtifactStore, 'read' | 'share' | 'listShares' | 'listSharedWithMe' | 'unshare' | 'publish' | 'delete' | 'export' | 'move' | 'projects' | 'issuePublicationGrant' | 'consumePublicationGrant' | 'readPublished'>;

let runtime: ReturnType<typeof createRuntime> | undefined;
function createRuntime(db: Database, config: ReturnType<typeof dashboardConfig>) {
  const options = { access: config.access, publishOrigin: serviceUrl('PUBLISH_URL'), sendInvitation: createEmailSender(process.env, config.origin) };
  const artifacts: DashboardStore = createArtifactStore(db, options);
  return { config, panel: createPanel(db, options), artifacts, identity: createPanelIdentity(db, config), cookieOptions: { httpOnly: true, secure: config.origin.startsWith('https:'), sameSite: 'lax' as const, path: '/' } };
}
export async function getRuntime() {
  if (runtime) return runtime;
  const config = dashboardConfig();
  const { client, db } = await openDatabase({ url: required('DATABASE_URL'), authToken: process.env.DATABASE_AUTH_TOKEN });
  if (runtime) {
    client.close();
    return runtime;
  }
  try {
    return runtime = createRuntime(db, config);
  } catch (error) {
    client.close();
    throw error;
  }
}
