import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { createAuth } from '../apps/auth/src/auth.ts';
import { createAuthHandler } from '../apps/auth/src/http-core.ts';
import { authConfig } from '../packages/config/src/index.ts';
import * as schema from '../packages/db/src/schema.ts';
import { createArtifactStore } from '../packages/artifacts/src/index.ts';
import { createArtifactHttpClient } from '../packages/client/src/index.ts';
import { fixture, grant, callWhoami } from './helpers.ts';

const invalidCode = { code: 'INVALID_OTP', message: 'Invalid OTP' };
const snapshot = { metadata: { title: 'Code fixture', description: '' }, content: { kind: 'html' as const, text: '<p>Guest content</p>' }, files: [] };

async function setup() {
  const app = await fixture();
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-email-code-'));
  const file = join(directory, 'messages.jsonl');
  const config = { ...app.config, email: { transport: 'file' as const, ownerEmail: 'owner@example.test', path: file } };
  const auth = createAuth(app.db, config);
  app.setAuthHandler(createAuthHandler(app.db, config, auth));
  const current = await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) });
  assert(current);
  const actor = { userId: app.ownerId, sessionId: current.session.id, clientId: 'email-code-tests', scopes: ['artifacts:read', 'artifacts:write', 'artifacts:publish'] };
  const store = createArtifactStore(app.db, { publishOrigin: 'https://publication.example.test' });
  const artifact = await store.create(actor, { requestId: randomUUID(), snapshot });
  async function post(path: string, body: unknown) {
    return fetch(`${app.config.issuer}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: app.config.origin }, body: JSON.stringify(body) });
  }
  async function seed(email: string, otp = '482619') {
    const identifier = `sign-in-otp-${email.toLowerCase()}`;
    await app.db.delete(schema.verification).where(eq(schema.verification.identifier, identifier));
    await app.db.insert(schema.verification).values({ id: randomUUID(), identifier, value: `${createHash('sha256').update(otp).digest('base64url')}:0`, expiresAt: new Date(Date.now() + 300_000) });
    return otp;
  }
  async function invite(email: string) {
    return store.share(actor, { requestId: randomUUID(), artifactId: artifact.artifactId, email });
  }
  async function messages() {
    return (await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error; })).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { to: string; text: string });
  }
  return { ...app, bootstrapAuth: app.auth, auth, config, store, actor, artifact, post, seed, invite, messages, async close() { await app.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('enabled code sign-in creates one lowercase invited identity and preserves signup closure', async () => {
  const app = await setup();
  try {
    await app.invite('ana@example.com');
    const sent = await app.post('/email-otp/send-verification-otp', { email: 'Ana@Example.com', type: 'sign-in' });
    assert.equal(sent.status, 200);
    assert.deepEqual(await sent.json(), { success: true });
    const messages = await app.messages();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].to, 'ana@example.com');
    const otp = messages[0].text.match(/\b\d{6}\b/)?.[0];
    assert(otp);
    const signed = await app.post('/sign-in/email-otp', { email: 'Ana@Example.com', otp, emailVerified: false });
    assert.equal(signed.status, 200);
    const body = await signed.json();
    const rows = await app.db.select().from(schema.user).where(eq(schema.user.email, 'ana@example.com'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, body.user.id);
    assert.equal(rows[0].email, 'ana@example.com');
    assert.equal(rows[0].emailVerified, true);
    const again = await app.post('/sign-in/email-otp', { email: 'ana@example.com', otp: await app.seed('ana@example.com') });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).user.id, body.user.id);
    const signup = await app.post('/sign-up/email', { email: 'closed@example.test', name: 'Closed', password: app.password });
    assert.equal(signup.status, 400);
    assert.equal((await signup.json()).code, 'EMAIL_PASSWORD_SIGN_UP_DISABLED');
  } finally { await app.close(); }
});

test('forged valid code cannot admit an uninvited new or revoked existing user', async () => {
  const app = await setup();
  try {
    const ownerCode = await app.post('/sign-in/email-otp', { email: 'owner@example.test', otp: await app.seed('owner@example.test') });
    assert.equal(ownerCode.status, 200, 'same-format admitted control');
    for (const existing of [false, true]) {
      const email = existing ? 'revoked@example.test' : 'uninvited@example.test';
      if (existing) await app.bootstrapAuth.api.signUpEmail({ body: { email, name: 'Revoked', password: app.password } });
      const before = await app.client.execute('SELECT (SELECT count(*) FROM user) AS users, (SELECT count(*) FROM session) AS sessions');
      const response = await app.post('/sign-in/email-otp', { email, otp: await app.seed(email) });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), invalidCode);
      assert.deepEqual(response.headers.getSetCookie(), []);
      assert.deepEqual((await app.client.execute('SELECT (SELECT count(*) FROM user) AS users, (SELECT count(*) FROM session) AS sessions')).rows, before.rows);
    }
  } finally { await app.close(); }
});

for (const transport of ['http', 'api'] as const) test(`malformed redemption hides invitation state through ${transport}`, async (t) => {
  const app = await fixture({ emailCode: true, transport: 'combined' });
  try {
    const tokens = await grant(app, 'openid profile offline_access artifacts:read artifacts:write artifacts:publish');
    const client = createArtifactHttpClient({ resource: app.config.resource, accessToken: tokens.access_token });
    const artifact = await client.create({ requestId: randomUUID(), snapshot });
    const email = 'unregistered-invitee@example.test';
    const share = await client.share({ requestId: randomUUID(), artifactId: artifact.artifactId, email });
    assert.equal((await client.listShares({ artifactId: artifact.artifactId })).items.length, 1);
    assert.equal((await app.db.select().from(schema.user).where(eq(schema.user.email, email))).length, 0);
    const users = await app.db.select().from(schema.user);
    const sessions = await app.db.select().from(schema.session);
    const cases = [
      { label: 'missing otp', body: { email } },
      { label: 'numeric otp', body: { email, otp: 123456 } },
      { label: 'null otp', body: { email, otp: null } },
      { label: 'object otp', body: { email, otp: {} } },
      { label: 'array otp', body: { email, otp: ['999999'] } },
      { label: 'numeric name', body: { email, otp: '999999', name: 123 } },
      { label: 'null name', body: { email, otp: '999999', name: null } },
      { label: 'object image', body: { email, otp: '999999', image: {} } },
      { label: 'null image', body: { email, otp: '999999', image: null } },
      { label: 'well-formed wrong code', body: { email, otp: '999999', name: 'Guest', image: 'https://example.test/avatar.png' } },
    ];
    const results = [];
    for (const admission of ['shared', 'revoked']) {
      if (admission === 'revoked') {
        await client.unshare({ requestId: randomUUID(), artifactId: artifact.artifactId, shareId: share.shareId });
        assert.deepEqual((await client.listShares({ artifactId: artifact.artifactId })).items, []);
      }
      for (const { label, body } of cases) {
        const result = transport === 'http'
          ? await fetch(`${app.config.issuer}/sign-in/email-otp`, { method: 'POST', headers: { origin: app.config.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
            .then(async (response) => ({ status: response.status, body: await response.json(), cookies: response.headers.getSetCookie() }))
          : await app.auth.api.signInEmailOTP({ body: body as NonNullable<Parameters<typeof app.auth.api.signInEmailOTP>[0]>['body'], returnHeaders: true })
            .then(({ response, headers }) => ({ status: 200, body: response, cookies: headers.getSetCookie() }), (error: { statusCode: number; body: unknown; headers: HeadersInit }) => ({ status: error.statusCode, body: error.body, cookies: new Headers(error.headers).getSetCookie() }));
        results.push({ admission, label, ...result });
        assert.deepEqual(await app.db.select().from(schema.user), users);
        assert.deepEqual(await app.db.select().from(schema.session), sessions);
      }
    }
    t.diagnostic(JSON.stringify({ transport, results, usersUnchanged: true, sessionsUnchanged: true }));
    assert.deepEqual(results, ['shared', 'revoked'].flatMap((admission) => cases.map(({ label }) => ({ admission, label, status: 400, body: invalidCode, cookies: [] }))));
  } finally { await app.close(); }
});

for (const transport of ['http', 'api'] as const) test(`failed OTP authentication has one public representation through ${transport}`, async (t) => {
  const results = [];
  for (const producer of ['no row', 'wrong proof', 'expired proof', 'exhausted proof'] as const) {
    const app = await fixture({ emailCode: true, transport: 'combined' });
    try {
      const tokens = await grant(app, 'openid profile offline_access artifacts:read artifacts:write artifacts:publish');
      const client = createArtifactHttpClient({ resource: app.config.resource, accessToken: tokens.access_token });
      const artifact = await client.create({ requestId: randomUUID(), snapshot });
      const email = 'unregistered-proof@example.test';
      const share = await client.share({ requestId: randomUUID(), artifactId: artifact.artifactId, email });
      const users = await app.db.select().from(schema.user);
      const sessions = await app.db.select().from(schema.session);
      for (const admission of ['shared', 'revoked']) {
        if (admission === 'revoked') {
          await client.unshare({ requestId: randomUUID(), artifactId: artifact.artifactId, shareId: share.shareId });
          assert.deepEqual((await client.listShares({ artifactId: artifact.artifactId })).items, []);
        }
        if (producer !== 'no row') {
          const sent = await fetch(`${app.config.issuer}/email-otp/send-verification-otp`, {
            method: 'POST', headers: { origin: app.config.origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, type: 'sign-in' }),
          });
          assert.equal(sent.status, 200);
          assert.equal(await sent.text(), '{"success":true}');
        }
        if (producer === 'expired proof') await app.db.update(schema.verification).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(schema.verification.identifier, `sign-in-otp-${email}`));
        for (let attempt = 1; attempt <= (producer === 'exhausted proof' ? 4 : 1); attempt++) {
          const body = { email, otp: 'definitely-wrong' };
          const result = transport === 'http'
            ? await fetch(`${app.config.issuer}/sign-in/email-otp`, { method: 'POST', headers: { origin: app.config.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
              .then(async (response) => ({ status: response.status, raw: await response.text(), cookies: response.headers.getSetCookie() }))
            : await app.auth.api.signInEmailOTP({ body, returnHeaders: true })
              .then(({ response, headers }) => ({ status: 200, raw: JSON.stringify(response), cookies: headers.getSetCookie() }), (error: { statusCode: number; status: string; body: unknown; headers: HeadersInit }) => ({ status: error.statusCode, statusName: error.status, raw: JSON.stringify(error.body), cookies: new Headers(error.headers).getSetCookie() }));
          results.push({ producer, admission, attempt, ...result });
          assert.deepEqual(await app.db.select().from(schema.user), users);
          assert.deepEqual(await app.db.select().from(schema.session), sessions);
          assert.equal((await app.db.select().from(schema.user).where(eq(schema.user.email, email))).length, 0);
        }
      }
    } finally { await app.close(); }
  }
  t.diagnostic(JSON.stringify({ transport, results, usersUnchanged: true, sessionsUnchanged: true }));
  assert.deepEqual(results, ['no row', 'wrong proof', 'expired proof', 'exhausted proof'].flatMap((producer) => ['shared', 'revoked'].flatMap((admission) => Array.from({ length: producer === 'exhausted proof' ? 4 : 1 }, (_, index) => ({
    producer, admission, attempt: index + 1, status: 400, ...(transport === 'api' ? { statusName: 'BAD_REQUEST' } : {}), raw: '{"code":"INVALID_OTP","message":"Invalid OTP"}', cookies: [],
  })))));
});

test('first owner code preserves exact credential, revokes old sessions, and retains password login', async () => {
  const app = await setup();
  try {
    const before = await app.db.select().from(schema.account).where(eq(schema.account.userId, app.ownerId));
    assert.equal(before.length, 1);
    assert(before[0].password);
    for (const providerId of ['oauth-fixture', 'credential']) await app.db.insert(schema.account).values({ id: randomUUID(), userId: app.ownerId, accountId: 'foreign-account', providerId, password: 'untrusted-hash', createdAt: new Date(), updatedAt: new Date() });
    const wrong = await app.post('/sign-in/email-otp', { email: 'owner@example.test', otp: '999999' });
    assert.equal(wrong.status, 400);
    assert.equal((await app.db.select().from(schema.user).where(eq(schema.user.id, app.ownerId)))[0].emailVerified, false);
    const response = await app.post('/sign-in/email-otp', { email: 'owner@example.test', otp: await app.seed('owner@example.test') });
    assert.equal(response.status, 200);
    assert.deepEqual(await app.db.select().from(schema.account).where(eq(schema.account.userId, app.ownerId)), before);
    assert.equal(await app.auth.api.getSession({ headers: new Headers({ cookie: app.cookie }) }), null);
    const password = await app.post('/sign-in/email', { email: 'owner@example.test', password: app.password });
    assert.equal(password.status, 200);
  } finally { await app.close(); }
});

test('legacy configuration leaves both code routes disabled and retains password login', async () => {
  const app = await fixture();
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      for (const path of ['/email-otp/send-verification-otp', '/sign-in/email-otp']) {
        const response = await fetch(`${app.config.issuer}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.test', type: 'sign-in', otp: '123456' }) });
        assert.equal(response.status, 404);
      }
    }
    assert((await app.auth.api.signInEmail({ body: { email: 'owner@example.test', password: app.password } })).user);
    const config = authConfig({ AUTH_URL: app.config.origin, MCP_URL: app.config.resource, DASHBOARD_URL: app.config.dashboard, BETTER_AUTH_SECRET: app.config.secret, OWNER_EMAIL: 'owner@example.test' });
    assert.equal(config.origin, app.config.origin);
  } finally { await app.close(); }
});

test('only sign-in OTP endpoints and request type are exposed', async () => {
  const app = await setup();
  try {
    const admitted = await app.post('/sign-in/email-otp', { email: 'owner@example.test', otp: await app.seed('owner@example.test') });
    assert.equal(admitted.status, 200);
    for (const method of ['createVerificationOTP', 'getVerificationOTP', 'checkVerificationOTP', 'verifyEmailOTP', 'requestPasswordResetEmailOTP', 'forgetPasswordEmailOTP', 'resetPasswordEmailOTP', 'requestEmailChangeEmailOTP', 'changeEmailEmailOTP']) assert.equal(method in app.auth.api, false);
    for (const path of ['/email-otp/check-verification-otp', '/email-otp/verify-email', '/email-otp/request-password-reset', '/forget-password/email-otp', '/email-otp/reset-password', '/email-otp/request-email-change', '/email-otp/change-email']) {
      assert.equal((await app.post(path, { email: 'owner@example.test', otp: '123456' })).status, 404);
    }
    for (const type of ['email-verification', 'forget-password', 'change-email']) {
      assert.equal((await app.post('/email-otp/send-verification-otp', { email: 'owner@example.test', type })).status, 400);
    }
    const codes = await app.client.execute("SELECT count(*) AS count FROM verification WHERE identifier LIKE '%otp-%'");
    assert.equal(codes.rows[0].count, 0);
    assert.equal((await app.messages()).length, 0);
  } finally { await app.close(); }
});

test('non-owner unverified credentials are still removed after actual code proof', async () => {
  const app = await setup();
  try {
    const email = 'guest@example.test';
    await app.invite(email);
    const guest = await app.bootstrapAuth.api.signUpEmail({ body: { email, name: 'Guest', password: app.password } });
    assert.equal((await app.db.select().from(schema.account).where(eq(schema.account.userId, guest.user.id))).length, 1);
    assert.equal((await app.post('/sign-in/email-otp', { email, otp: await app.seed(email) })).status, 200);
    assert.equal((await app.db.select().from(schema.account).where(eq(schema.account.userId, guest.user.id))).length, 0);
    assert.equal((await app.db.select().from(schema.user).where(eq(schema.user.id, guest.user.id)))[0].emailVerified, true);
  } finally { await app.close(); }
});

test('two valid codes cannot create a session while earlier promotion cleanup is stalled', async () => {
  const app = await setup();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let pending: Promise<Response> | undefined;
  try {
    const hook = app.auth.options.databaseHooks!.account!.delete!;
    const original = hook.before!;
    hook.before = async (account, ctx) => { entered.resolve(); await release.promise; return original(account, ctx); };
    const otp = await app.seed('owner@example.test');
    pending = app.post('/sign-in/email-otp', { email: 'owner@example.test', otp });
    await entered.promise;
    const second = await app.post('/sign-in/email-otp', { email: 'owner@example.test', otp: await app.seed('owner@example.test', '247139') });
    const user = (await app.db.select().from(schema.user).where(eq(schema.user.id, app.ownerId)))[0];
    assert.equal(user.emailVerified, false);
    assert.equal(second.status, 400);
    assert.deepEqual(await second.json(), invalidCode);
    assert.equal(second.headers.getSetCookie().length, 0);
    release.resolve();
    assert.equal((await pending).status, 200);
  } finally { release.resolve(); await pending; await app.close(); }
});

test('email configuration is explicit and validates only the selected transport', () => {
  const env = { AUTH_URL: 'http://localhost:4100', MCP_URL: 'http://localhost:4200/mcp', DASHBOARD_URL: 'http://127.0.0.1:4321', BETTER_AUTH_SECRET: 'fixture-secret-that-is-at-least-32-characters' };
  assert.deepEqual(authConfig(env).email, { transport: 'disabled' });
  assert.deepEqual(authConfig({ ...env, OWNER_EMAIL: 'not-an-email' }).email, { transport: 'disabled' });
  assert.throws(() => authConfig({ ...env, EMAIL_TRANSPORT: 'file' }), /OWNER_EMAIL/);
  assert.throws(() => authConfig({ ...env, EMAIL_TRANSPORT: 'resend', OWNER_EMAIL: 'owner@example.test' }), /EMAIL_FROM/);
  const resend = { ...env, EMAIL_TRANSPORT: 'resend', OWNER_EMAIL: ' OWNER@EXAMPLE.TEST ', EMAIL_FROM: ' codes@example.test ', RESEND_API_KEY: 'disposable-key' };
  assert.deepEqual(authConfig(resend).email, { transport: 'resend', ownerEmail: 'owner@example.test', from: 'codes@example.test', apiKey: 'disposable-key' });
  assert.throws(() => authConfig({ ...resend, RESEND_API_KEY: undefined }), /RESEND_API_KEY/);
  for (const apiKey of [' ', 'invalid key', 'invalid\nkey', 'invalid\x7fkey']) assert.throws(() => authConfig({ ...resend, RESEND_API_KEY: apiKey }), /RESEND_API_KEY/);
  assert.throws(() => authConfig({ ...resend, EMAIL_FROM: 'not-an-address' }), /EMAIL_FROM/);
  assert.throws(() => authConfig({ ...resend, EMAIL_TRANSPORT: 'cloudflare' }), /EMAIL_TRANSPORT must be resend or file/);
  assert.throws(() => authConfig({ ...env, AUTH_URL: 'https://auth.example.test', EMAIL_TRANSPORT: 'file', OWNER_EMAIL: 'owner@example.test', EMAIL_FILE_PATH: '/tmp/email.jsonl' }), /loopback/);
  assert.deepEqual(authConfig({ ...env, EMAIL_TRANSPORT: 'file', OWNER_EMAIL: ' OWNER@EXAMPLE.TEST ', EMAIL_FILE_PATH: '/tmp/email.jsonl' }).email, { transport: 'file', ownerEmail: 'owner@example.test', path: '/tmp/email.jsonl' });
});

test('email send allowance is shared across case variants and auth instances', async () => {
  const app = await setup();
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await app.post('/email-otp/send-verification-otp', { email: attempt % 2 ? 'OWNER@EXAMPLE.TEST' : 'owner@example.test', type: 'sign-in' });
      assert.equal(response.status, attempt < 3 ? 200 : 429);
      if (attempt === 2) app.setAuthHandler(createAuthHandler(app.db, app.config, createAuth(app.db, app.config)));
    }
    assert.equal((await app.messages()).length, 3);
  } finally { await app.close(); }
});

test('IP send allowance is independent of email and cannot be bypassed by public forwarding headers', async () => {
  const app = await setup();
  try {
    for (let attempt = 0; attempt < 11; attempt++) {
      const response = await fetch(`${app.config.issuer}/email-otp/send-verification-otp`, { method: 'POST', headers: { 'content-type': 'application/json', origin: app.config.origin, 'x-forwarded-for': `192.0.2.${attempt + 1}`, 'x-artifacts-client-ip': `198.51.100.${attempt + 1}` }, body: JSON.stringify({ email: `unknown-${attempt}@example.test`, type: 'sign-in' }) });
      assert.equal(response.status, attempt < 10 ? 200 : 429);
    }
    assert.equal((await app.messages()).length, 0);
  } finally { await app.close(); }
});

for (const transport of ['http', 'api'] as const) test(`real code exhaustion requires a new request through ${transport}`, async () => {
  const app = await setup();
  try {
    const email = 'renewal@example.test';
    await app.invite(email);
    async function requestCode() {
      const response = await app.post('/email-otp/send-verification-otp', { email, type: 'sign-in' });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { success: true });
      const otp = (await app.messages()).at(-1)?.text.match(/\b\d{6}\b/)?.[0];
      assert(otp);
      return otp;
    }
    async function redeem(otp: string) {
      return transport === 'http'
        ? app.post('/sign-in/email-otp', { email, otp }).then(async (response) => ({ status: response.status, body: await response.json(), cookies: response.headers.getSetCookie() }))
        : app.auth.api.signInEmailOTP({ body: { email, otp }, returnHeaders: true }).then(({ response, headers }) => ({ status: 200, body: response, cookies: headers.getSetCookie() }), (error: { statusCode: number; body: unknown; headers: HeadersInit }) => ({ status: error.statusCode, body: error.body, cookies: new Headers(error.headers).getSetCookie() }));
    }
    const users = await app.db.select().from(schema.user);
    const sessions = await app.db.select().from(schema.session);
    const otp = await requestCode();
    const wrong = otp === '999999' ? '888888' : '999999';
    const failures = [];
    for (const code of [wrong, wrong, wrong, otp, otp]) failures.push(await redeem(code));
    assert.deepEqual(await app.db.select().from(schema.user), users);
    assert.deepEqual(await app.db.select().from(schema.session), sessions);
    const renewed = await redeem(await requestCode());
    assert.equal(renewed.status, 200);
    assert.equal(renewed.cookies.length, 1);
    const verified = await app.db.select().from(schema.user).where(eq(schema.user.email, email));
    assert.equal(verified.length, 1);
    assert.equal(verified[0].emailVerified, true);
    assert.equal((await app.db.select().from(schema.session).where(eq(schema.session.userId, verified[0].id))).length, 1);
    assert.deepEqual(failures, Array.from({ length: 5 }, () => ({ status: 400, body: invalidCode, cookies: [] })));
  } finally { await app.close(); }
});

test('independent database connections atomically share send allowance and survive verification cleanup', async () => {
  const app = await setup();
  const { openDatabase } = await import('../packages/db/src/index.ts');
  const second = await openDatabase({ url: app.databaseUrl });
  try {
    assert.equal((await app.post('/email-otp/send-verification-otp', { email: 'unknown@example.test', type: 'sign-in' })).status, 200);
    const other = createAuth(second.db, app.config);
    const calls = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
      const current = index % 2 ? app.auth : other;
      try { await current.api.sendVerificationOTP({ body: { email: 'owner@example.test', type: 'sign-in' } }); return 200; }
      catch (error) { return (error as { statusCode: number }).statusCode; }
    }));
    assert.equal(calls.filter((status) => status === 200).length, 3);
    assert.equal(calls.filter((status) => status === 429).length, 9);
    const counters = await second.client.execute("SELECT value, expires_at - updated_at AS retention FROM verification WHERE id = 'artifacts:email-code:send-email:owner@example.test'");
    assert.equal(counters.rows[0].value, '3');
    assert.equal(counters.rows[0].retention, 604800000);
    const context = await app.auth.$context;
    await context.internalAdapter.findVerificationValue('unrelated-code');
    assert.equal((await app.post('/email-otp/send-verification-otp', { email: 'owner@example.test', type: 'sign-in' })).status, 429);
    await second.client.execute("UPDATE verification SET updated_at = cast(unixepoch('subsecond') * 1000 as integer) - 60001 WHERE id LIKE 'artifacts:email-code:%'");
    assert.equal((await app.post('/email-otp/send-verification-otp', { email: 'owner@example.test', type: 'sign-in' })).status, 200);
    assert.equal((await second.client.execute("SELECT value FROM verification WHERE id = 'artifacts:email-code:send-email:owner@example.test'")).rows[0].value, '1');
  } finally { second.client.close(); await app.close(); }
});

test('revocation denies delivery and redemption while owned artifacts retain former-guest admission', async () => {
  const app = await setup();
  try {
    const email = 'former@example.test';
    const share = await app.invite(email);
    const first = await app.post('/sign-in/email-otp', { email, otp: await app.seed(email) });
    assert.equal(first.status, 200);
    const guest = await first.json();
    const cookie = first.headers.getSetCookie()[0].split(';')[0];
    const central = await app.auth.api.getSession({ headers: new Headers({ cookie }) });
    assert(central);
    await app.store.unshare(app.actor, { requestId: randomUUID(), artifactId: app.artifact.artifactId, shareId: share.shareId });
    const deniedSend = await app.post('/email-otp/send-verification-otp', { email, type: 'sign-in' });
    assert.equal(deniedSend.status, 200);
    assert.deepEqual(await deniedSend.json(), { success: true });
    assert.equal((await app.messages()).length, 0);
    const denied = await app.post('/sign-in/email-otp', { email, otp: await app.seed(email) });
    assert.equal(denied.status, 400);
    const actor = { ...app.actor, userId: guest.user.id, sessionId: central.session.id };
    const owned = await app.store.create(actor, { requestId: randomUUID(), snapshot });
    assert.equal((await app.post('/email-otp/send-verification-otp', { email, type: 'sign-in' })).status, 200);
    assert.equal((await app.messages()).length, 1);
    assert.equal((await app.post('/sign-in/email-otp', { email, otp: await app.seed(email) })).status, 200);
    await app.store.delete(actor, { requestId: randomUUID(), artifactId: owned.artifactId, expectedRevisionId: owned.headRevisionId, expectedPublicationVersion: 0 });
    assert.equal((await app.post('/sign-in/email-otp', { email, otp: await app.seed(email) })).status, 400);
  } finally { await app.close(); }
});

test('invited code identity completes the real dashboard callback and guest MCP OAuth', async () => {
  const app = await setup();
  try {
    const { createPanelIdentity } = await import('../apps/dashboard/src/identity.ts');
    const email = 'oauth-guest@example.test';
    await app.invite(email);
    const signed = await app.post('/sign-in/email-otp', { email, otp: await app.seed(email) });
    assert.equal(signed.status, 200);
    const guest = await signed.json();
    const cookie = signed.headers.getSetCookie()[0].split(';')[0];
    const tokens = await grant({ ...app, cookie });
    const whoami = await callWhoami(app.config.resource, tokens.access_token);
    assert.equal(whoami.status, 200);
    const text = await whoami.text();
    assert(text.includes(guest.user.id));
    const client = await app.auth.api.adminCreateOAuthClient({ headers: new Headers({ cookie: app.cookie }), body: { client_name: 'Code dashboard', application_type: 'native', redirect_uris: ['http://localhost:4321/auth/callback'], token_endpoint_auth_method: 'client_secret_basic', grant_types: ['authorization_code'], response_types: ['code'], scope: 'openid profile', enable_end_session: true, skip_consent: true, require_pkce: true } });
    assert(client.client_secret);
    const identity = createPanelIdentity(app.db, { origin: 'http://localhost:4321', auth: app.config.origin, issuer: app.config.issuer, clientId: client.client_id, clientSecret: client.client_secret });
    const transaction = await identity.startLogin();
    const authorization = await fetch(transaction.url, { headers: { cookie }, redirect: 'manual' });
    assert.equal(authorization.status, 200);
    const local = await identity.completeLogin(new URL((await authorization.json()).url), transaction.token);
    assert.equal((await identity.load(local.token))?.userId, guest.user.id);
  } finally { await app.close(); }
});

test('concurrent separate connections reserve exactly ten IP sends with numeric counts', async () => {
  const app = await setup();
  const { openDatabase } = await import('../packages/db/src/index.ts');
  const second = await openDatabase({ url: app.databaseUrl });
  try {
    const other = createAuth(second.db, app.config);
    const responses = await Promise.all(Array.from({ length: 16 }, (_, index) => createAuthHandler(index % 2 ? second.db : app.db, app.config, index % 2 ? other : app.auth)(new Request(`${app.config.issuer}/email-otp/send-verification-otp`, { method: 'POST', headers: { origin: app.config.origin, 'content-type': 'application/json' }, body: JSON.stringify({ email: `concurrent-${index}@example.test`, type: 'sign-in' }) }))));
    assert.equal(responses.filter((response) => response.status === 200).length, 10);
    assert.equal(responses.filter((response) => response.status === 429).length, 6);
    const rows = await second.client.execute("SELECT value FROM verification WHERE id = 'artifacts:email-code:send-ip:no-trusted-ip'");
    assert.equal(rows.rows[0].value, '10');
    assert.equal((await app.messages()).length, 0);
  } finally { second.client.close(); await app.close(); }
});

test('verification cleanup with an advanced request clock preserves an active DB-clock counter', async (t) => {
  const app = await setup();
  try {
    for (let attempt = 0; attempt < 3; attempt++) assert.equal((await app.post('/email-otp/send-verification-otp', { email: 'owner@example.test', type: 'sign-in' })).status, 200);
    const context = await app.auth.$context;
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 120_000 });
    await context.internalAdapter.findVerificationValue('unrelated-cleanup');
    assert.equal((await app.post('/email-otp/send-verification-otp', { email: 'owner@example.test', type: 'sign-in' })).status, 429);
    assert.equal((await app.client.execute("SELECT value FROM verification WHERE id = 'artifacts:email-code:send-email:owner@example.test'")).rows[0].value, '3');
  } finally { t.mock.timers.reset(); await app.close(); }
});

test('direct API rechecks current admission before consuming a valid code', async () => {
  const app = await setup();
  try {
    assert.equal((await app.post('/email-otp/send-verification-otp', { email: 'owner@example.test', type: 'sign-in' })).status, 200);
    const email = 'api-guest@example.test';
    const share = await app.invite(email);
    const otp = await app.seed(email);
    await app.store.unshare(app.actor, { requestId: randomUUID(), artifactId: app.artifact.artifactId, shareId: share.shareId });
    await assert.rejects(app.auth.api.signInEmailOTP({ body: { email, otp } }), (error: unknown) => {
      assert.equal((error as { statusCode: number }).statusCode, 400);
      assert.deepEqual((error as { body: unknown }).body, invalidCode);
      return true;
    });
    assert.equal((await app.client.execute({ sql: 'SELECT count(*) AS count FROM user WHERE email = ?', args: [email] })).rows[0].count, 0);
    assert.equal((await app.client.execute({ sql: 'SELECT count(*) AS count FROM verification WHERE identifier = ?', args: [`sign-in-otp-${email}`] })).rows[0].count, 1);
  } finally { await app.close(); }
});
