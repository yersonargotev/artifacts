export const workerCompatibility = {
  compatibilityDate: '2026-10-11',
  compatibilityFlags: ['nodejs_compat', 'nodejs_compat_populate_process_env', 'global_fetch_strictly_public'],
};

export const workerOrigins = {
  AUTH_URL: 'https://artifacts-auth.yersonargotev.workers.dev',
  API_URL: 'https://artifacts-api.yersonargotev.workers.dev',
  MCP_URL: 'https://artifacts-api.yersonargotev.workers.dev/mcp',
  DASHBOARD_URL: 'https://artifacts-panel.yersonargotev.workers.dev',
  PUBLISH_URL: 'https://artifacts-view.yersonargotev.workers.dev',
};

type Binding = { type: 'text'; value: string } | { type: 'secret' };
export type WorkerConfiguration<Environment> = {
  worker: {
    name: string;
    compatibilityDate: string;
    compatibilityFlags: string[];
    entrypoint: string;
    env: { [Name in keyof Environment]-?: Binding };
  };
};
