import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createArtifactStore, type Actor } from '../packages/artifacts/src/index.ts';
import { fileEmailSender } from '../packages/config/src/email-node.ts';
import { parseShareForm } from '../apps/dashboard/src/share.ts';
import { fixture, grant } from './helpers.ts';
import { eq, sql } from 'drizzle-orm';
import * as databaseSchema from '../packages/db/src/schema.ts';
const { artifactCommand, artifactInvitationBudget, artifactShare } = databaseSchema;
import type { InvitationSender } from '../packages/artifacts/src/invitation.ts';
import * as contracts from '../packages/contracts/src/index.ts';
const { shareSchema, shareResultSchema, shareCommandResultSchema } = contracts;

test('a fresh invitation for existing access sends once and its exact replay never sends again', async () => {
  const app = await fixture({ emailCode: true });
  try {
    const signedIn = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
    assert(signedIn);
    const actor: Actor = { userId: app.ownerId, sessionId: signedIn.session.id, clientId: 'invitation-test', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
    const store = createArtifactStore(app.db, { access: app.config.access, publishOrigin: 'https://published.example.test', sendInvitation: fileEmailSender(app.emailSink!) });
    const created = await store.create(actor, { requestId: randomUUID(), snapshot: { metadata: { title: 'PRIVATE DRAFT TITLE', description: '' }, content: { kind: 'text', text: 'PRIVATE DRAFT BODY' }, files: [] } });
    const plain = await store.share(actor, { requestId: randomUUID(), artifactId: created.artifactId, email: 'Guest@Example.test' });
    assert.deepEqual(Object.keys(plain).sort(), ['artifactId', 'createdAt', 'kind', 'shareId', 'value']);
    const command = { requestId: randomUUID(), artifactId: created.artifactId, email: 'Guest@Example.test', notify: true };
    const result = await store.share(actor, command);
    assert.deepEqual(result, { ...plain, notification: { status: 'requested' } });
    assert.deepEqual(await store.share(actor, command), result);
    let messages = (await readFile(app.emailSink!, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].to, 'guest@example.test');
    assert.match(messages[0].text, /Test owner/);
    assert.match(messages[0].text, new RegExp(created.artifactId));
    assert(!JSON.stringify(messages).includes('PRIVATE DRAFT'));
    assert.deepEqual(await store.share(actor, { ...command, requestId: randomUUID() }), result);
    messages = (await readFile(app.emailSink!, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(messages.length, 2);
    assert.deepEqual(await store.listShares(actor, { artifactId: created.artifactId }), { items: [plain] });
  } finally { await app.close(); }
});

async function setup(send?: InvitationSender | false) {
  const app = await fixture({ emailCode: true });
  const session = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
  assert(session);
  const actor: Actor = { userId: app.ownerId, sessionId: session.session.id, clientId: 'invitation-test', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
  const store = createArtifactStore(app.db, { access: app.config.access, publishOrigin: 'https://published.example.test', sendInvitation: send === false ? undefined : send ?? fileEmailSender(app.emailSink!) });
  const created = await store.create(actor, { requestId: randomUUID(), snapshot: { metadata: { title: 'PRIVATE', description: '' }, content: { kind: 'text', text: 'Private' }, files: [] } });
  const share = (email: string, notify?: boolean) => store.share(actor, { requestId: randomUUID(), artifactId: created.artifactId, email, ...(notify === undefined ? {} : { notify }) });
  const messages = async () => (await readFile(app.emailSink!, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error; })).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return { ...app, actor, store, created, share, messages };
}

test('notification inputs preserve absence and false, and only command results accept a notification', () => {
  const plain = { requestId: 'legacy-command', artifactId: 'legacy-artifact', email: 'guest@example.test' };
  assert.deepEqual(shareSchema.parse(plain), plain);
  assert.deepEqual(shareSchema.parse({ ...plain, notify: false }), { ...plain, notify: false });
  for (const value of [false, 'true', 1]) assert.equal(shareSchema.safeParse({ ...plain, requireNew: value }).success, false);
  const row = { shareId: 'legacy-share', artifactId: 'legacy-artifact', kind: 'email', value: 'guest@example.test', createdAt: '2026-01-01T00:00:00.000Z' };
  assert.deepEqual(shareCommandResultSchema.parse(row), row);
  assert.equal(shareResultSchema.safeParse({ ...row, notification: { status: 'requested' } }).success, false);
  assert.deepEqual(shareCommandResultSchema.parse({ ...row, notification: { status: 'skipped', reason: 'disabled' } }), { ...row, notification: { status: 'skipped', reason: 'disabled' } });
});

test('literal S9 receipt inputs still replay and explicit false remains a different command', async () => {
  const app = await setup();
  try {
    const literal = '{"input":{"artifactId":"legacy-artifact","email":"guest@example.test","requestId":"legacy-command"},"kind":"share"}';
    const result = { shareId: 'legacy-share', artifactId: 'legacy-artifact', kind: 'email', value: 'guest@example.test', createdAt: '2026-01-01T00:00:00.000Z' };
    await app.db.insert(artifactCommand).values({ ownerId: app.ownerId, requestId: 'legacy-command', payloadHash: createHash('sha256').update(literal).digest('hex'), result: JSON.stringify(result), createdAt: new Date() });
    const input = { requestId: 'legacy-command', artifactId: 'legacy-artifact', email: 'guest@example.test' };
    assert.deepEqual(await app.store.share(app.actor, input), result);
    await assert.rejects(app.store.share(app.actor, { ...input, notify: false }), { code: 'request_conflict' });
    assert.deepEqual(await app.messages(), []);
  } finally { await app.close(); }
});

test('plain, explicit false and disabled invitations grant access without reserving a budget', async () => {
  const app = await setup(false);
  try {
    for (const [email, flag] of [['plain@example.test', undefined], ['false@example.test', false]] as const) {
      const result = await app.share(email, flag);
      assert.deepEqual(Object.keys(result).sort(), ['artifactId', 'createdAt', 'kind', 'shareId', 'value']);
    }
    const disabled = await app.share('disabled@example.test', true);
    assert.deepEqual(disabled.notification, { status: 'skipped', reason: 'disabled' });
    assert.equal((await app.store.listShares(app.actor, { artifactId: app.created.artifactId })).items.length, 3);
    assert.deepEqual(await app.db.select().from(artifactInvitationBudget), []);
    assert.deepEqual(await app.messages(), []);
  } finally { await app.close(); }
});

test('requireNew rejects existing access without quota use and exact creation replay keeps its original ID', async () => {
  const app = await setup();
  try {
    const command = { requestId: randomUUID(), artifactId: app.created.artifactId, email: 'new@example.test', requireNew: true as const, notify: true };
    const first = await app.store.share(app.actor, command);
    await assert.rejects(app.store.share(app.actor, { ...command, requestId: randomUUID() }), { code: 'conflict', details: { reason: 'share_exists' } });
    await app.store.unshare(app.actor, { requestId: randomUUID(), artifactId: app.created.artifactId, shareId: first.shareId });
    const replacement = await app.share(command.email);
    assert.notEqual(replacement.shareId, first.shareId);
    assert.deepEqual(await app.store.share(app.actor, command), first);
    assert.deepEqual((await app.store.listShares(app.actor, { artifactId: app.created.artifactId })).items, [replacement]);
    assert.equal((await app.messages()).length, 1);
    assert.equal((await app.db.select().from(artifactInvitationBudget))[0]!.used, 1);
  } finally { await app.close(); }
});

test('the UTC budget skips mail without denying access and survives revoke and deletion', async () => {
  const app = await setup();
  try {
    for (let index = 0; index < 100; index++) assert.deepEqual((await app.share('same@example.test', true)).notification, { status: 'requested' });
    const command = { requestId: randomUUID(), artifactId: app.created.artifactId, email: 'limited@example.test', notify: true };
    const limited = await app.store.share(app.actor, command);
    const retryAt = String((await app.client.execute("SELECT strftime('%Y-%m-%dT00:00:00.000Z','now','+1 day') AS retryAt")).rows[0]!.retryAt);
    assert.deepEqual(limited.notification, { status: 'skipped', reason: 'rate_limited', retryAt });
    assert.equal((await app.messages()).length, 100);
    await app.store.unshare(app.actor, { requestId: randomUUID(), artifactId: app.created.artifactId, shareId: limited.shareId });
    assert.equal((await app.db.select().from(artifactInvitationBudget))[0]!.used, 100);
    await app.db.update(artifactInvitationBudget).set({ day: '2000-01-01' });
    assert.deepEqual(await app.store.share(app.actor, command), limited);
    assert.deepEqual((await app.share('new-day@example.test', true)).notification, { status: 'requested' });
    assert.equal((await app.db.select().from(artifactInvitationBudget))[0]!.used, 1);
    await app.store.delete(app.actor, { requestId: randomUUID(), artifactId: app.created.artifactId, expectedRevisionId: app.created.revision.id, expectedPublicationVersion: 0 });
    assert.equal((await app.db.select().from(artifactInvitationBudget))[0]!.used, 1);
    const receipts = await app.db.select().from(artifactCommand);
    assert(!JSON.stringify(receipts).includes('same@example.test'));
    assert(!JSON.stringify(receipts).includes('limited@example.test'));
    const scrubbed = receipts.filter((row) => JSON.parse(row.result).kind === 'artifact_deleted');
    assert.equal(scrubbed.length, 104);
    assert.deepEqual([...new Set(scrubbed.map((row) => row.payloadHash))], ['']);
    const budget = (await app.db.select().from(artifactInvitationBudget))[0]!;
    assert.deepEqual(Object.keys(budget).sort(), ['day', 'ownerId', 'used']);
  } finally { await app.close(); }
});

test('the owner cap counts access across artifacts and permits existing access and revocation', async () => {
  const app = await setup();
  try {
    const other = await app.store.create(app.actor, { requestId: randomUUID(), snapshot: app.created.revision.snapshot });
    const rows = Array.from({ length: 1000 }, (_, index) => ({ id: randomUUID(), artifactId: other.artifactId, kind: 'email' as const, value: `legacy-${index}@example.test`, createdBy: app.ownerId, createdAt: new Date() }));
    for (let offset = 0; offset < rows.length; offset += 100) await app.db.insert(artifactShare).values(rows.slice(offset, offset + 100));
    await assert.rejects(app.share('new@example.test'), { code: 'conflict', details: { reason: 'share_limit', scope: 'owner', limit: 1000 } });
    assert.equal((await app.store.listShares(app.actor, { artifactId: other.artifactId })).items.length, 1000);
    assert.equal((await app.store.share(app.actor, { requestId: randomUUID(), artifactId: other.artifactId, email: rows[0]!.value, notify: true })).shareId, rows[0]!.id);
    await app.store.unshare(app.actor, { requestId: randomUUID(), artifactId: other.artifactId, shareId: rows[0]!.id });
    assert.equal((await app.share('new@example.test')).value, 'new@example.test');
  } finally { await app.close(); }
});

test('revocation, deletion, lookup and render failures after commit preserve success without sending', async () => {
  for (const action of ['revoke-and-replace', 'delete', 'lookup-failure', 'render-failure'] as const) {
    const app = await setup();
    const original = app.db.transaction.bind(app.db);
    const select = app.db.select;
    let afterCommit: (() => Promise<void>) | undefined;
    app.db.transaction = async <T>(work: (connection: Parameters<Parameters<typeof app.db.transaction>[0]>[0]) => Promise<T>) => {
      const result = await original(work);
      const hook = afterCommit;
      afterCommit = undefined;
      await hook?.();
      return result;
    };
    try {
      const command = { requestId: randomUUID(), artifactId: app.created.artifactId, email: 'racing@example.test', notify: true };
      afterCommit = async () => {
        const [receipt] = await app.db.select().from(artifactCommand).where(eq(artifactCommand.requestId, command.requestId));
        const result = JSON.parse(receipt!.result);
        if (action === 'delete') await app.store.delete(app.actor, { requestId: randomUUID(), artifactId: app.created.artifactId, expectedRevisionId: app.created.revision.id, expectedPublicationVersion: 0 });
        if (action === 'revoke-and-replace') {
          await app.store.unshare(app.actor, { requestId: randomUUID(), artifactId: app.created.artifactId, shareId: result.shareId });
          await app.share(command.email);
        }
        if (action === 'lookup-failure') app.db.select = () => { throw new Error('Injected postcommit read failure'); };
        if (action === 'render-failure') await app.db.update(databaseSchema.user).set({ name: sql`X'80'` }).where(eq(databaseSchema.user.id, app.ownerId));
      };
      const result = await app.store.share(app.actor, command);
      app.db.select = select;
      assert.deepEqual(result.notification, { status: 'requested' });
      assert.deepEqual(await app.messages(), []);
      assert.equal((await app.db.select().from(artifactInvitationBudget))[0]!.used, 1);
      if (action !== 'delete') assert.deepEqual(await app.store.share(app.actor, command), result);
    } finally { app.db.select = select; await app.close(); }
  }
});

test('a rejected or timed out sender keeps the committed receipt and never refunds or resends', { timeout: 20_000 }, async () => {
  for (const outcome of ['reject', 'timeout'] as const) {
    let attempts = 0;
    const app = await setup(async () => { attempts++; if (outcome === 'reject') throw new Error('Injected provider rejection'); await new Promise<void>(() => {}); });
    try {
      const command = { requestId: randomUUID(), artifactId: app.created.artifactId, email: 'failure@example.test', notify: true };
      const result = await app.store.share(app.actor, command);
      assert.deepEqual(result.notification, { status: 'requested' });
      assert.deepEqual(await app.store.share(app.actor, command), result);
      assert.equal(attempts, 1);
      assert.equal((await app.db.select().from(artifactInvitationBudget))[0]!.used, 1);
      assert.equal((await app.store.listShares(app.actor, { artifactId: app.created.artifactId })).items[0]!.shareId, result.shareId);
    } finally { await app.close(); }
  }
});

test('new share caps preserve duplicates and complete grandfathered listings and revocations', async () => {
  const app = await setup();
  try {
    const rows = Array.from({ length: 101 }, (_, index) => ({ id: randomUUID(), artifactId: app.created.artifactId, kind: 'email' as const, value: `legacy-${String(index).padStart(3, '0')}@example.test`, createdBy: app.ownerId, createdAt: new Date() }));
    await app.db.insert(artifactShare).values(rows);
    assert.equal((await app.store.listShares(app.actor, { artifactId: app.created.artifactId })).items.length, 101);
    assert.equal((await app.share(rows[0]!.value, true)).shareId, rows[0]!.id);
    assert.equal((await app.messages()).length, 1);
    await assert.rejects(app.share('beyond@example.test'), { code: 'conflict', details: { reason: 'share_limit', scope: 'artifact', limit: 100 } });
    for (const row of rows.slice(0, 2)) await app.store.unshare(app.actor, { requestId: randomUUID(), artifactId: app.created.artifactId, shareId: row.id });
    assert.equal((await app.share('replacement@example.test')).value, 'replacement@example.test');
    assert.equal((await app.store.listShares(app.actor, { artifactId: app.created.artifactId })).items.length, 100);
  } finally { await app.close(); }
});

test('the invitation renderer escapes the owner and trusted URL and never uses a draft title', async () => {
  const { invitation } = await import('../packages/artifacts/src/invitation.ts');
  const rendered = invitation('guest@example.test', '  Ana <Equipo> & "Socios"  ', 'https://published.example.test/a/x?x=1&y="2"');
  assert.equal(rendered.subject, 'Un artefacto compartido contigo');
  assert.match(rendered.html, /Ana &lt;Equipo&gt; &amp; &quot;Socios&quot;/);
  assert.match(rendered.html, /href="https:\/\/published.example.test\/a\/x\?x=1&amp;y=&quot;2&quot;"/);
  assert(!rendered.html.includes('<Equipo>'));
  assert.match(invitation('guest@example.test', '  ', 'https://published.example.test/a/x').text, /^Usuario de Artifacts compartió/);
});

test('the native share form preserves the optional invitation and conditional creation request', async () => {
  const requestId = randomUUID();
  const body = new URLSearchParams({ requestId, intent: 'share', email: 'guest@example.test', notify: 'true', requireNew: 'true' });
  const command = await parseShareForm(new Request('https://panel.example.test/artifacts/a/share', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }));
  assert.deepEqual(command, { requestId, intent: 'share', email: 'guest@example.test', notify: true, requireNew: true });
  for (const flag of ['notify', 'requireNew']) {
    for (const values of [['false'], ['on'], ['true', 'true']]) {
      const invalid = new URLSearchParams({ requestId, intent: 'share', email: 'guest@example.test' });
      for (const value of values) invalid.append(flag, value);
      await assert.rejects(parseShareForm(new Request('https://panel.example.test/artifacts/a/share', { method: 'POST', body: invalid })), (error: unknown) => error instanceof Response && error.status === 400);
    }
    await assert.rejects(parseShareForm(new Request('https://panel.example.test/artifacts/a/share', { method: 'POST', body: new URLSearchParams({ requestId, intent: 'unshare', shareId: 'existing-share', [flag]: 'true' }) })), (error: unknown) => error instanceof Response && error.status === 400);
  }
});

test('MCP accepts notify and reports disabled delivery while granting access', async () => {
  const app = await fixture();
  try {
    const tokens = await grant(app, 'openid profile artifacts:read artifacts:write artifacts:publish');
    async function call(name: string, args: unknown) {
      const response = await fetch(app.config.resource, { method: 'POST', headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
      assert.equal(response.status, 200);
      const body = await response.text();
      return JSON.parse(body.startsWith('event:') ? body.split('\n').find((line) => line.startsWith('data: '))!.slice(6) : body).result;
    }
    const created = await call('artifacts_create', { requestId: randomUUID(), snapshot: { metadata: { title: 'Invitation', description: '' }, content: { kind: 'text', text: 'Example' }, files: [] } });
    const result = await call('artifacts_share', { requestId: randomUUID(), artifactId: created.structuredContent.artifactId, email: 'guest@example.test', notify: true });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(result.structuredContent.value, 'guest@example.test');
    assert.deepEqual(result.structuredContent.notification, { status: 'skipped', reason: 'disabled' });
  } finally { await app.close(); }
});
