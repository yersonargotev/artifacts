import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

const worker = process.env.ARTIFACTS_BUILD_TARGET === 'worker';
const manifest = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const workspaceEntries = Object.entries(manifest('package.json').dependencies)
  .filter(([, version]) => version.startsWith('workspace:'))
  .flatMap(([name]) => Object.keys(manifest(`node_modules/${name}/package.json`).exports).map((entry) => name + entry.slice(1)));

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
    ssr: worker ? { noExternal: workspaceEntries } : { external: workspaceEntries },
  },
});
