import { randomBytes } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { resolve } from 'node:path';

await mkdir('.data', { recursive: true, mode: 0o700 });
const secret = () => randomBytes(32).toString('base64url');
try {
  const file = await open('.env', 'wx', 0o600);
  await file.writeFile([
    `DATABASE_URL=file:${resolve('.data/identity.db')}`,
    'AUTH_URL=http://localhost:4100',
    'MCP_URL=http://127.0.0.1:4101/mcp',
    'DASHBOARD_URL=http://127.0.0.1:4321',
    'PUBLISH_URL=http://[::1]:4102',
    `BETTER_AUTH_SECRET=${secret()}`,
    `PUBLICATION_SERVICE_SECRET=${secret()}`,
    `PUBLICATION_COOKIE_SECRET=${secret()}`,
    'OWNER_EMAIL=owner@example.test',
    'ALLOW_GUEST_ACCESS=false',
    'OWNER_NAME=Owner',
    `OWNER_PASSWORD=${secret()}`,
    '',
  ].join('\n'));
  await file.close();
  console.log('Created .env with local credentials and mode 0600. Run pnpm identity:bootstrap after migrations.');
} catch (error) {
  if (error instanceof Error && 'code' in error && error.code === 'EEXIST') console.log('Kept existing .env');
  else throw error;
}
