import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

const worker = process.env.ARTIFACTS_BUILD_TARGET === 'worker';

export default defineConfig({
  output: 'server',
  adapter: worker ? cloudflare({ configPath: '.worker/wrangler.json', imageService: 'passthrough' }) : node({ mode: 'standalone' }),
  ...(worker ? { session: false } : {}),
  integrations: [react()],
  security: {
    csp: {
      directives: ["default-src 'self'", "frame-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"],
      scriptDirective: { resources: ["'self'", { resource: "'none'", kind: 'attribute' }] },
      styleDirective: { resources: ["'self'", "'unsafe-inline'"] },
    },
  },
  server: { host: '127.0.0.1' },
  vite: {
    plugins: [tailwindcss()],
    ...(worker ? { ssr: { noExternal: ['@artifacts/db', '@artifacts/db/schema', '@artifacts/config', '@artifacts/artifacts', '@artifacts/artifacts/contracts'] } } : { build: { rolldownOptions: { external: ['@artifacts/db', '@artifacts/db/schema', '@artifacts/config', '@artifacts/artifacts', '@artifacts/artifacts/contracts'] } } }),
  },
});
