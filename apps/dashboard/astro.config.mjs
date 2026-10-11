import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import cloudflare from '@astrojs/cloudflare';

const worker = process.env.ARTIFACTS_BUILD_TARGET === 'worker';

export default defineConfig({
  output: 'server',
  adapter: worker ? cloudflare({ configPath: '.worker/wrangler.json', imageService: 'passthrough' }) : node({ mode: 'standalone' }),
  ...(worker ? { session: false } : {}),
  server: { host: '127.0.0.1' },
  vite: worker ? { ssr: { noExternal: ['@artifacts/db', '@artifacts/db/schema', '@artifacts/config', '@artifacts/artifacts', '@artifacts/artifacts/contracts'] } } : { build: { rolldownOptions: { external: ['@artifacts/db', '@artifacts/db/schema', '@artifacts/config', '@artifacts/artifacts', '@artifacts/artifacts/contracts'] } } },
});
