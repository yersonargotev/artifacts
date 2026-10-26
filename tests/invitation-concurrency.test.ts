import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import type { InStatement, InArgs } from '@libsql/client';
import { artifactShare } from '../packages/db/src/schema.ts';
import { fixture, grant } from './helpers.ts';
import type { InvitationProcessEvent } from './invitation-process.ts';

type Scenario = 'quota' | 'same-request' | 'artifact-cap' | 'owner-cap' | 'require-new' | 'crash' | 'auth-recovery' | 'natural-quota';
type ConflictScenario = 'artifact-cap' | 'owner-cap' | 'require-new';
type RaceCase = Scenario | { scenario: ConflictScenario; exhaustBeginRetries: true };
type AuthRound = { pending: (() => void)[] };
const require = createRequire(import.meta.url);
const databaseEntry = import.meta.url.endsWith('.ts') ? new URL('../packages/db/src/index.ts', import.meta.url) : require.resolve('@artifacts/db');
const Native = createRequire(createRequire(databaseEntry).resolve('@libsql/client'))('libsql') as typeof import('libsql');

async function race(input: RaceCase) {
  const scenario = typeof input === 'string' ? input : input.scenario;
  const exhaustBeginRetries = typeof input !== 'string';
  const conflict = scenario === 'artifact-cap' || scenario === 'owner-cap' || scenario === 'require-new';
  const app = await fixture({ invitations: true, transport: 'rest' });
  const children: ChildProcess[] = [];
  const events: InvitationProcessEvent[] = [];
  const report = (event: string, detail: Record<string, unknown> = {}) => events.push({ actor: process.pid, time: new Date().toISOString(), event, detail });
  let holder: InstanceType<typeof Native> | undefined;
  let held = false;
  try {
    assert.equal((await app.client.execute('PRAGMA journal_mode')).rows[0]!.journal_mode, 'delete');
    assert.equal((await app.client.execute('PRAGMA busy_timeout')).rows[0]!.timeout, 0);
    report('database_settings', { journalMode: 'delete', busyTimeout: 0 });
    const token = await grant(app, 'openid profile artifacts:read artifacts:write artifacts:publish');
    const headers = { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' };
    async function create() {
      const response = await fetch(`${app.config.resource}/v1/artifacts`, { method: 'POST', headers, body: JSON.stringify({ requestId: randomUUID(), snapshot: { metadata: { title: 'Invitation race', description: '' }, content: { kind: 'text', text: 'Disposable' }, files: [] } }) });
      assert.equal(response.status, 201);
      return (await response.json()).artifactId as string;
    }
    const artifactId = await create();
    if (scenario === 'quota' || scenario === 'natural-quota') await app.client.execute({ sql: "INSERT INTO artifact_invitation_budget(owner_id,day,used) VALUES(?,date('now'),99)", args: [app.ownerId] });
    if (scenario === 'artifact-cap' || scenario === 'owner-cap') {
      const target = scenario === 'artifact-cap' ? artifactId : await create();
      const rows = Array.from({ length: scenario === 'artifact-cap' ? 99 : 999 }, (_, index) => ({ id: randomUUID(), artifactId: target, kind: 'email' as const, value: `seed-${index}@example.test`, createdBy: app.ownerId, createdAt: new Date() }));
      for (let offset = 0; offset < rows.length; offset += 100) await app.db.insert(artifactShare).values(rows.slice(offset, offset + 100));
    }
    const seedShares = (await app.client.execute('SELECT id, artifact_id, kind, value, created_by FROM artifact_share ORDER BY id')).rows;
    let acquired: number | undefined;
    let contended = false;
    async function start(crashAfterCommit = false) {
      const typescript = import.meta.url.endsWith('.ts');
      const child = fork(new URL(`./invitation-process.${typescript ? 'ts' : 'mjs'}`, import.meta.url), [], { execArgv: typescript ? ['--import', 'tsx'] : [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      children.push(child);
      child.stderr!.on('data', (bytes: Buffer) => report('child_stderr', { actor: child.pid, text: bytes.toString() }));
      const ready = new Promise<{ port: number; child: ChildProcess }>((resolve) => child.on('message', (event: InvitationProcessEvent) => {
        events.push(event);
        if (event.event === 'ready') resolve({ port: Number(event.detail.port), child });
        if (scenario === 'quota') {
          if (event.event === 'begin_ok' && acquired === undefined) acquired = event.actor;
          if (event.event === 'begin_failed' && event.detail.code === 'SQLITE_BUSY' && acquired !== undefined && event.actor !== acquired && !contended) {
            contended = true;
            report('contention_observed', { holder: acquired, contender: event.actor });
            for (const process of children) process.send({ releaseTransaction: true });
          }
        }
      }));
      child.send({ databaseUrl: app.databaseUrl, sink: app.emailSink, config: app.mcpOptions, crashAfterCommit, holdTransaction: scenario === 'quota' || exhaustBeginRetries });
      return Promise.race([ready, once(child, 'exit').then(() => { throw new Error('API child exited before readiness'); })]);
    }
    const processes = await Promise.all([start(scenario === 'crash'), start()]);
    const authBarrier = ['quota', 'same-request', 'artifact-cap', 'owner-cap', 'require-new'].includes(scenario);
    if (authBarrier || scenario === 'auth-recovery') {
      for (const child of processes) assert.equal((await fetch(`http://127.0.0.1:${child.port}/mcp/v1/identity`, { headers })).status, 200);
    }
    let authRound: AuthRound | undefined;
    app.setAuthHandler(async (request, bindings) => {
      const round = authRound;
      const response = await app.authHandler(request, bindings);
      if (!round || !new URL(request.url).pathname.endsWith('/oauth2/introspect')) return response;
      const bytes = await response.arrayBuffer();
      assert.equal(response.status, 200, 'The command barrier holds only real successful auth responses');
      assert.equal(JSON.parse(Buffer.from(bytes).toString()).active, true);
      report('auth_body_completed', { status: response.status, sha256: createHash('sha256').update(Buffer.from(bytes)).digest('hex') });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The authentic introspection barrier did not fill')), 2000);
        round.pending.push(() => { clearTimeout(timer); resolve(); });
        if (round.pending.length === 2) {
          authRound = undefined;
          report('auth_responses_released');
          for (const release of round.pending.splice(0)) release();
        }
      });
      return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
    });
    const sharedRequest = randomUUID();
    const commands = [0, 1].map((index) => ({ requestId: scenario === 'same-request' || scenario === 'crash' ? sharedRequest : randomUUID(), email: `race-${scenario === 'same-request' || scenario === 'require-new' || scenario === 'crash' ? 0 : index}@example.test`, ...(['quota', 'natural-quota', 'same-request', 'crash', 'auth-recovery'].includes(scenario) ? { notify: true } : {}), ...(scenario === 'require-new' ? { requireNew: true } : {}) }));
    const bodies = commands.map((command) => JSON.stringify(command));
    async function share(index: number) {
      const response = await fetch(`http://127.0.0.1:${processes[index]!.port}/mcp/v1/artifacts/${artifactId}/shares`, { method: 'POST', headers, body: bodies[index] });
      const result = { status: response.status, body: await response.json() };
      report('command_response', { actor: processes[index]!.child.pid, requestId: commands[index]!.requestId, requestSha256: createHash('sha256').update(bodies[index]!).digest('hex'), ...result });
      return result;
    }
    async function pair() {
      const round: AuthRound = { pending: [] };
      if (authBarrier) authRound = round;
      const eventOffset = events.length;
      let firstSettled: number | undefined;
      try {
        const responses = await Promise.all([0, 1].map(async (index) => {
          try { return await share(index); }
          finally {
            firstSettled ??= index;
            if (exhaustBeginRetries && firstSettled === index) {
              report('contender_response_released_holder', { actor: processes[index]!.child.pid });
              for (const { child } of processes) child.send({ releaseTransaction: true });
            }
          }
        }));
        return { responses, eventOffset, firstSettled };
      } finally {
        if (authRound === round) authRound = undefined;
        for (const release of round.pending.splice(0)) release();
      }
    }
    async function completedShareEvents(index: number, after: number) {
      const child = processes[index]!.child;
      const finished = (event: InvitationProcessEvent) => event.actor === child.pid && event.event === 'share_finished' && event.detail.requestId === commands[index]!.requestId;
      if (!events.slice(after).some(finished)) await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { child.off('message', receive); reject(new Error('The share did not report its terminal IPC event')); }, 5000);
        function receive(event: InvitationProcessEvent) {
          if (!finished(event)) return;
          clearTimeout(timer);
          child.off('message', receive);
          resolve();
        }
        child.on('message', receive);
      });
      const end = events.findIndex((event, position) => position >= after && finished(event));
      return events.slice(after, end + 1).filter((event) => event.actor === child.pid);
    }
    async function messages() {
      return (await readFile(app.emailSink!, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error; })).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    }
    async function receipt(index: number, result: unknown) {
      const row = (await app.client.execute({ sql: 'SELECT result FROM artifact_command WHERE owner_id=? AND request_id=?', args: [app.ownerId, commands[index]!.requestId] })).rows[0];
      assert.ok(row);
      assert.deepEqual(JSON.parse(String(row.result)), result);
    }
    if (scenario === 'auth-recovery') {
      const execute = app.client.execute.bind(app.client);
      app.client.execute = async (statement: InStatement, bindings?: InArgs) => {
        try { return typeof statement === 'string' && bindings !== undefined ? await execute(statement, bindings) : await execute(statement); }
        catch (error) {
          const sql = typeof statement === 'string' ? statement : statement.sql;
          report('auth_database_failure', { verb: sql.split(' ')[0], table: sql.match(/\bfrom\s+"?([a-z_]+)/i)?.[1], code: error instanceof Error && 'code' in error ? error.code : undefined });
          throw error;
        }
      };
      holder = new Native(app.databaseUrl.slice('file:'.length));
      holder.exec('BEGIN EXCLUSIVE');
      held = true;
      const before = events.length;
      const failed = await share(0);
      assert.equal(failed.status, 503);
      assert.equal(failed.body.error.message, 'Identity service unavailable');
      const blocked = events.slice(before);
      assert.ok(blocked.some((event) => event.event === 'auth_database_failure' && typeof event.detail.verb === 'string' && event.detail.verb.toUpperCase() === 'SELECT' && event.detail.code === 'SQLITE_BUSY'));
      assert.ok(blocked.some((event) => event.event === 'introspection_response' && event.detail.status === 500));
      assert.equal(blocked.some((event) => event.event === 'share_enter' || event.event === 'begin'), false);
      for (const table of ['artifact_share', 'artifact_invitation_budget']) assert.deepEqual(holder.prepare(`SELECT count(*) AS total FROM ${table}`).all(), [{ total: 0 }]);
      assert.deepEqual(holder.prepare('SELECT count(*) AS total FROM artifact_command WHERE request_id=?').all(commands[0]!.requestId), [{ total: 0 }]);
      assert.equal((await messages()).length, 0);
      report('precommand_zero_effects', { grants: 0, receipts: 0, budgetRows: 0, sinkMessages: 0 });
      holder.exec('COMMIT');
      held = false;
      holder.close();
      holder = undefined;
      report('exclusive_holder_released');
      const recovered = await share(0);
      assert.equal(recovered.status, 201, JSON.stringify(recovered));
      assert.deepEqual(recovered.body.notification, { status: 'requested' });
      await receipt(0, recovered.body);
      assert.deepEqual(await share(0), recovered);
      assert.equal((await app.client.execute('SELECT count(*) AS total FROM artifact_share')).rows[0]!.total, 1);
      assert.deepEqual((await app.client.execute('SELECT id, artifact_id, value FROM artifact_share')).rows.map((row) => ({ shareId: row.id, artifactId: row.artifact_id, email: row.value })), [{ shareId: recovered.body.shareId, artifactId, email: commands[0]!.email }]);
      assert.equal((await app.client.execute('SELECT used FROM artifact_invitation_budget')).rows[0]!.used, 1);
      const attempts = events.filter((event) => event.event === 'command_response' && event.detail.requestId === commands[0]!.requestId);
      assert.equal(attempts.length, 3);
      assert.equal(new Set(attempts.map((event) => event.detail.requestSha256)).size, 1);
      assert.deepEqual((await messages()).map((message) => message.to), [commands[0]!.email]);
      assert.ok(processes.every(({ child }) => child.exitCode === null));
      report('identical_request_recovered', { requestSha256: createHash('sha256').update(bodies[0]!).digest('hex'), authPid: process.pid, restPids: processes.map(({ child }) => child.pid), grants: 1, receipts: 1, used: 1, sinkMessages: 1, replay: 'identical' });
    } else if (scenario === 'crash') {
      const exited = once(processes[0]!.child, 'exit');
      await assert.rejects(share(0));
      assert.equal((await exited)[0], 73);
      const replay = await share(1);
      assert.equal(replay.status, 201);
      assert.deepEqual(replay.body.notification, { status: 'requested' });
      assert.equal((await app.client.execute('SELECT count(*) AS total FROM artifact_share')).rows[0]!.total, 1);
    } else {
      const initial = await pair();
      const firstResults = initial.responses;
      const results = [...firstResults];
      if (scenario === 'natural-quota') {
        assert.ok(results.every((result) => result.status === 201 || result.status === 503), JSON.stringify(results));
        report('natural_race_diagnostic', { firstResponses: results, classification: results.map((result, index) => ({ actor: processes[index]!.child.pid, stage: result.status === 201 ? 'success' : events.some((event) => event.actor === processes[index]!.child.pid && event.event === 'introspection_response' && event.detail.status === 500) ? 'precommand_auth' : events.some((event) => event.actor === processes[index]!.child.pid && event.event === 'share_enter') ? 'command' : 'unclassified' })), sinkMessages: (await messages()).length });
        return;
      }
      assert.equal(events.filter((event) => event.event === 'auth_body_completed').length, 2);
      if (scenario === 'quota' || scenario === 'same-request') {
        assert.deepEqual(results.map((result) => result.status), [201, 201], JSON.stringify(results));
        if (scenario === 'quota') {
          assert.equal(contended, true, 'The quota race must observe a competing BEGIN failure');
          const contention = events.findIndex((event) => event.event === 'contention_observed');
          assert.ok(contention >= 0 && contention < events.findIndex((event) => event.event === 'commit_ok'));
          assert.deepEqual(results.map((result) => result.body.notification.status).sort(), ['requested', 'skipped']);
          assert.equal(results.find((result) => result.body.notification.status === 'skipped')!.body.notification.reason, 'rate_limited');
          const requested = results.findIndex((result) => result.body.notification.status === 'requested');
          assert.deepEqual((await messages()).map((message) => message.to), [commands[requested]!.email]);
          assert.deepEqual((await app.client.execute('SELECT id, artifact_id, value FROM artifact_share ORDER BY value')).rows.map((row) => ({ shareId: row.id, artifactId: row.artifact_id, email: row.value })), results.map((result, index) => ({ shareId: result.body.shareId, artifactId, email: commands[index]!.email })));
        } else assert.deepEqual(results[0], results[1]);
        for (let index = 0; index < results.length; index++) await receipt(index, results[index]!.body);
        assert.deepEqual((await pair()).responses, results);
        assert.equal(events.filter((event) => event.event === 'auth_body_completed').length, 4);
      } else {
        assert.equal(conflict, true);
        assert.equal(firstResults.filter((result) => result.status === 201).length, 1, JSON.stringify(firstResults));
        const winner = firstResults.findIndex((result) => result.status === 201);
        const loser = 1 - winner;
        if (exhaustBeginRetries) {
          assert.deepEqual(firstResults.map((result) => result.status).sort(), [201, 503]);
          assert.equal(initial.firstSettled, loser, 'The contender HTTP response must release the held winner');
        }
        const winnerEvents = await completedShareEvents(winner, initial.eventOffset);
        assert.equal(winnerEvents.filter((event) => event.event === 'commit_ok').length, 1);
        if (firstResults[loser]!.status === 503) {
          assert.deepEqual(firstResults[loser]!.body, { error: { code: 'unavailable', message: 'Artifact service unavailable', details: {} } });
          const failed = await completedShareEvents(loser, initial.eventOffset);
          assert.deepEqual(failed.filter((event) => event.event === 'share_enter').map((event) => event.detail.requestId), [commands[loser]!.requestId]);
          assert.equal(failed.filter((event) => event.event === 'begin').length, 6);
          assert.deepEqual(failed.filter((event) => event.event === 'begin_failed').map((event) => event.detail.code), Array(6).fill('SQLITE_BUSY'));
          assert.equal(failed.some((event) => event.event === 'begin_ok' || event.event.startsWith('commit') || event.event.startsWith('rollback')), false);
          results[loser] = await share(loser);
        }
        assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
        assert.deepEqual(results[loser]!.body.error.details, scenario === 'require-new' ? { reason: 'share_exists' } : { reason: 'share_limit', scope: scenario === 'artifact-cap' ? 'artifact' : 'owner', limit: scenario === 'artifact-cap' ? 100 : 1000 });
        await receipt(winner, results[winner]!.body);
        assert.deepEqual((await app.client.execute({ sql: 'SELECT request_id, result FROM artifact_command WHERE owner_id=? AND request_id IN (?,?)', args: [app.ownerId, commands[0]!.requestId, commands[1]!.requestId] })).rows.map((row) => ({ requestId: row.request_id, result: JSON.parse(String(row.result)) })), [{ requestId: commands[winner]!.requestId, result: results[winner]!.body }]);
        const expectedShares = [...seedShares, { id: results[winner]!.body.shareId, artifact_id: artifactId, kind: 'email', value: commands[winner]!.email, created_by: app.ownerId }].sort((left, right) => String(left.id).localeCompare(String(right.id)));
        assert.deepEqual((await app.client.execute('SELECT id, artifact_id, kind, value, created_by FROM artifact_share ORDER BY id')).rows, expectedShares);
        assert.deepEqual((await app.client.execute('SELECT * FROM artifact_invitation_budget')).rows, []);
        const attempts = events.filter((event) => event.event === 'command_response' && event.detail.requestId === commands[loser]!.requestId);
        assert.equal(attempts.length, firstResults[loser]!.status === 503 ? 2 : 1);
        assert.deepEqual([...new Set(attempts.map((event) => event.detail.requestSha256))], [createHash('sha256').update(bodies[loser]!).digest('hex')]);
      }
      const expected = scenario === 'artifact-cap' ? 100 : scenario === 'owner-cap' ? 1000 : scenario === 'quota' ? 2 : 1;
      assert.equal((await app.client.execute('SELECT count(*) AS total FROM artifact_share')).rows[0]!.total, expected);
    }
    const sent = await messages();
    assert.equal(sent.length, scenario === 'quota' || scenario === 'same-request' || scenario === 'auth-recovery' ? 1 : 0);
    if (['quota', 'same-request', 'crash', 'auth-recovery'].includes(scenario)) assert.equal((await app.client.execute('SELECT used FROM artifact_invitation_budget')).rows[0]!.used, scenario === 'quota' ? 100 : 1);
    report('verified', { processes: 2, sinkMessages: sent.length });
  } finally {
    if (held) holder?.exec('ROLLBACK');
    holder?.close();
    await Promise.all(children.map(async (child) => { if (child.exitCode !== null) return; const closed = once(child, 'exit'); child.kill('SIGTERM'); await closed; }));
    await app.close();
    console.log(JSON.stringify({ scenario, exhaustBeginRetries, events, cleanup: { childrenClosed: true, databaseRemoved: true } }));
  }
}

for (let round = 1; round <= 5; round++) test(`authenticated quota contention preserves both first responses on fresh start ${round}`, () => race('quota'));
test('real auth failure permits one identical notify recovery with the same live clients', () => race('auth-recovery'));
for (const scenario of ['same-request', 'artifact-cap', 'owner-cap', 'require-new', 'crash'] as const) test(`two API processes preserve ${scenario} behavior`, () => race(scenario));
for (let round = 1; round <= 3; round++) test(`natural quota race diagnostic ${round}`, () => race('natural-quota'));

for (const scenario of ['artifact-cap', 'owner-cap', 'require-new'] as const) test(`exhausted BEGIN contention preserves ${scenario} conflict after identical recovery`, () => race({ scenario, exhaustBeginRetries: true }));
