import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createClient } from '@libsql/client';
import { createArtifactStore } from '../packages/artifacts/src/index.ts';
import { createPanel } from '../packages/artifacts/src/panel/index.ts';
import type { Actor } from '../packages/contracts/src/index.ts';
import { fixture } from './helpers.ts';

test('reads succeed while another connection holds the write lock', async () => {
  const app = await fixture();
  const holder = createClient({ url: app.databaseUrl });
  try {
    const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
    assert(signedIn);
    const actor: Actor = { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'read-lock-test', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
    const options = { access: { ownerEmail: 'owner@example.test', allowGuests: false }, publishOrigin: 'https://published.example.test' };
    const store = createArtifactStore(app.db, options);
    const panel = createPanel(app.db, options);
    const created = await store.create(actor, { requestId: randomUUID(), snapshot: { metadata: { title: 'Locked', description: '' }, content: { kind: 'markdown', text: '# Locked' }, files: [] }, project: 'Wiki', slug: 'locked' });
    const { artifactId, headRevisionId: revisionId } = created;

    const lock = await holder.transaction('write');
    try {
      const reads = {
        'panel.preview': () => panel.preview(actor, { artifactId, revisionId }),
        'panel.artifact': () => panel.artifact(actor, { artifactId, includeComparison: false }),
        'panel.library': () => panel.library(actor),
        'panel.projectsIndex': () => panel.projectsIndex(actor),
        'panel.moveSubject': () => panel.moveSubject(actor, [artifactId]),
        'store.read': () => store.read(actor, { artifactId }),
        'store.list': () => store.list(actor),
        'store.projects': () => store.projects(actor),
        'store.search': () => store.search(actor, { query: 'Locked' }),
        'store.history': () => store.history(actor, { artifactId }),
        'store.listShares': () => store.listShares(actor, { artifactId }),
        'store.listSharedWithMe': () => store.listSharedWithMe(actor),
      };
      for (const [name, read] of Object.entries(reads)) await assert.doesNotReject(read(), `${name} waits for the write lock`);
    } finally { await lock.rollback(); }
  } finally {
    holder.close();
    await app.close();
  }
});
