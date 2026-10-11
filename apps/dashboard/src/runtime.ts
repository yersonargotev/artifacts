import { dashboardConfig, required } from '@artifacts/config';
import { openDatabase } from '@artifacts/db';
import { createPanelIdentity } from './identity.ts';

let runtime: ReturnType<typeof createRuntime> | undefined;
async function createRuntime() {
  const config = dashboardConfig();
  const { db } = await openDatabase({ url: required('DATABASE_URL'), authToken: process.env.DATABASE_AUTH_TOKEN });
  return { config, identity: createPanelIdentity(db, config), cookieOptions: { httpOnly: true, secure: config.origin.startsWith('https:'), sameSite: 'lax' as const, path: '/' } };
}
export function getRuntime() {
  return runtime ??= createRuntime().catch((error) => { runtime = undefined; throw error; });
}
