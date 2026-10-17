import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createArtifactHttpClient, HttpError, prepareArtifactEdit } from '../packages/client/src/index.ts';
import type { ArtifactRead, Snapshot } from '../packages/contracts/src/index.ts';
import { operationPath } from '../apps/cli/src/operations.ts';
import { CredentialStore } from '../apps/cli/src/credentials.ts';
import { fixture, grant } from './helpers.ts';

const fullScope = 'openid profile offline_access artifacts:read artifacts:write artifacts:publish';
const snapshot: Snapshot = {
  metadata: { title: 'CLI retained document', description: 'A complete snapshot', custom: { keep: ['value', 7] } },
  content: { kind: 'html', text: '<h1>First revision</h1>' },
  files: [{ path: 'assets/data.bin', mediaType: 'application/octet-stream', encoding: 'base64', data: 'AAEC/w==' }],
};

async function cli(args: string[], environment: Record<string, string> = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('ARTIFACTS_')) delete env[key];
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../apps/cli/src/index.ts', import.meta.url)), ...args], { env: { ...env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`CLI timed out: ${args[0]}`)); }, 25_000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

function success(result: Awaited<ReturnType<typeof cli>>): any {
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function failure(result: Awaited<ReturnType<typeof cli>>, code: string): any {
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.stdout, '');
  const lines = result.stderr.trim().split('\n');
  const value = JSON.parse(lines.findLast((line) => line.startsWith('{"error":')) ?? result.stderr);
  assert.equal(value.error.code, code);
  return value.error;
}

test('typed client uses real REST for full commands, projections, conflicts, edit preparation, and binary export', async () => {
  const app = await fixture({ transport: 'rest' });
  try {
    const tokens = await grant(app, fullScope);
    let requests = 0;
    const client = createArtifactHttpClient({ resource: app.config.resource, accessToken: async () => tokens.access_token, fetch: async (...args) => { requests += 1; return fetch(...args); } });
    const identity = await client.identity();
    assert.equal(identity.userId, app.ownerId);
    assert.equal(identity.clientId, tokens.clientId);
    const command = { requestId: 'typed-client-create', snapshot };
    const created = await client.create(command);
    assert.equal(requests, 2);
    assert.deepEqual(created.revision.snapshot, snapshot);
    assert.deepEqual(await client.create(command), created);
    await assert.rejects(client.create({ ...command, response: 'full' }), (error: unknown) => error instanceof HttpError && error.status === 409 && error.code === 'request_conflict');
    const compact = await client.read({ artifactId: created.artifactId, response: 'compact' });
    assert.equal(compact.revision.content.utf8Bytes, 23);
    assert.equal(compact.revision.files[0].decodedBytes, 4);
    assert.equal(Object.hasOwn(compact.revision, 'snapshot'), false);
    const prepared = await prepareArtifactEdit(client, { artifactId: created.artifactId, requestId: 'typed-client-edit', changes: { metadata: { title: 'Edited through HTTP' }, content: { text: '<h1>Second revision</h1>' } } });
    assert.deepEqual(prepared.snapshot.metadata.custom, { keep: ['value', 7] });
    assert.deepEqual(prepared.snapshot.files, snapshot.files);
    const updated = await client.update({ ...prepared, response: 'full' });
    assert.equal(updated.revision.sequence, 2);
    await assert.rejects(client.update({ ...prepared, requestId: 'typed-client-stale' }), (error: unknown) => {
      assert(error instanceof HttpError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'conflict');
      assert.equal(error.details.currentRevisionId, updated.headRevisionId);
      return true;
    });
    assert.deepEqual((await client.list({ limit: 1 })).items.map((item) => item.title), ['Edited through HTTP']);
    const history = await client.history({ artifactId: created.artifactId, limit: 1, response: 'summary' });
    assert.deepEqual(history.items.map((item) => [item.sequence, item.metadata.title]), [[2, 'Edited through HTTP']]);
    assert.equal(history.nextBeforeSequence, 2);
    assert.deepEqual((await client.history({ artifactId: created.artifactId, beforeSequence: 2 })).items.map((item) => item.sequence), [1]);
    const publication = await client.publish({ requestId: 'typed-client-publish', artifactId: created.artifactId, revisionId: created.revision.id, expectedPublicationVersion: 0 });
    assert.equal(publication.version, 1);
    assert.equal(publication.revisionId, created.revision.id);
    const archive = await client.export({ artifactId: created.artifactId, revisionId: created.revision.id });
    assert.equal(createHash('sha256').update(archive.bytes).digest('hex'), archive.sha256);
    const files = unzipSync(archive.bytes);
    assert.equal(Buffer.from(files['content.html']).toString('utf8'), '<h1>First revision</h1>');
    assert.deepEqual([...files['files/assets/data.bin']], [0, 1, 2, 255]);
    assert.equal(requests, 13);
  } finally { await app.close(); }
});

test('typed client files, filters, lists, and moves projects over real REST', async () => {
  const app = await fixture({ transport: 'rest' });
  try {
    const tokens = await grant(app, fullScope);
    const client = createArtifactHttpClient({ resource: app.config.resource, accessToken: tokens.access_token });
    const alpha = await client.create({ requestId: 'client-project-alpha', snapshot, project: 'Alpha' });
    const second = await client.create({ requestId: 'client-project-second', snapshot, project: 'alpha' });
    assert.deepEqual([alpha.project, second.project], ['Alpha', 'Alpha']);
    assert.deepEqual(await client.projects(), { items: [{ name: 'Alpha', artifactCount: 2 }] });
    const move = { requestId: 'client-project-move', artifactId: second.artifactId, project: 'Beta' };
    assert.deepEqual(await client.move(move), { artifactId: second.artifactId, project: 'Beta' });
    assert.deepEqual(await client.move(move), { artifactId: second.artifactId, project: 'Beta' });
    await assert.rejects(client.move({ ...move, project: null }), (error: unknown) => error instanceof HttpError && error.status === 409 && error.code === 'request_conflict');
    assert.deepEqual((await client.list({ project: 'BETA' })).items.map((item) => [item.artifactId, item.project]), [[second.artifactId, 'Beta']]);
    assert.equal((await client.read({ artifactId: second.artifactId })).headRevisionId, second.headRevisionId);
    assert.deepEqual(await client.move({ requestId: 'client-project-clear', artifactId: alpha.artifactId, project: null }), { artifactId: alpha.artifactId, project: null });
    assert.deepEqual(await client.projects(), { items: [{ name: 'Beta', artifactCount: 1 }] });
  } finally { await app.close(); }
});

test('typed client rejects malformed HTTP, redirects, oversized streams, and mismatched ZIP bytes without retry', async () => {
  const app = await fixture({ transport: 'rest' });
  try {
    let calls = 0;
    let handler: (request: Request) => Response | Promise<Response> = () => Response.json({ userId: 'only-one-field' });
    app.setResourceHandler(async (request) => { calls += 1; return handler(request); });
    const client = createArtifactHttpClient({ resource: app.config.resource, accessToken: 'test-token' });
    await assert.rejects(client.identity(), (error: unknown) => error instanceof HttpError && error.code === 'invalid_response' && error.status === 200);
    assert.equal(calls, 1);
    handler = () => new Response(null, { status: 302, headers: { location: `${app.config.resource}/v1/identity` } });
    await assert.rejects(client.identity(), (error: unknown) => error instanceof HttpError && error.code === 'redirect_refused' && error.status === 302);
    assert.equal(calls, 2);
    handler = () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '67108865' } });
    await assert.rejects(client.identity(), (error: unknown) => error instanceof HttpError && error.code === 'response_too_large');
    handler = () => new Response(new ReadableStream({ start(controller) { for (let index = 0; index < 9; index += 1) controller.enqueue(new Uint8Array(1024 * 1024)); controller.close(); } }), { headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="test.zip"', 'x-artifact-sha256': '0'.repeat(64) } });
    await assert.rejects(client.export({ artifactId: 'artifact', revisionId: 'revision' }), (error: unknown) => error instanceof HttpError && error.code === 'response_too_large');
    handler = () => new Response('broken archive', { headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="test.zip"', 'x-artifact-sha256': '0'.repeat(64) } });
    await assert.rejects(client.export({ artifactId: 'artifact', revisionId: 'revision' }), (error: unknown) => error instanceof HttpError && error.code === 'archive_digest_mismatch');
    handler = () => {
      let timer: ReturnType<typeof setTimeout>;
      return new Response(new ReadableStream({ start(controller) { timer = setTimeout(() => controller.close(), 100); }, cancel() { clearTimeout(timer); } }), { headers: { 'content-type': 'application/json' } });
    };
    const impatientClient = createArtifactHttpClient({ resource: app.config.resource, accessToken: 'test-token', timeoutMs: 40 });
    await assert.rejects(impatientClient.identity(), (error: unknown) => error instanceof HttpError && error.code === 'timeout' && error.status === 0);
    assert.equal(calls, 6);
  } finally { await app.close(); }
});

test('typed client accepts a ten-revision page with maximum JSON escaping', async () => {
  const app = await fixture({ transport: 'rest' });
  try {
    const text = '\u0001'.repeat(1_048_000);
    app.setResourceHandler(async () => Response.json({ items: Array.from({ length: 10 }, (_, index) => ({ id: `revision-${index}`, parentRevisionId: null, sequence: index + 1, authorUserId: 'owner', authorClientId: 'client', createdAt: '2026-01-01T00:00:00.000Z', sha256: '0'.repeat(64), snapshot: { metadata: { title: 'Maximum escaped revision', description: '' }, content: { kind: 'text', text }, files: [] } })), nextBeforeSequence: null }));
    const client = createArtifactHttpClient({ resource: app.config.resource, accessToken: 'test-token' });
    const page = await client.history({ artifactId: 'large-artifact', limit: 10 });
    assert.deepEqual(page.items.map((item) => item.sequence), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(page.items[9].snapshot.content.text.length, 1_048_000);
    assert.equal(page.nextBeforeSequence, null);
  } finally { await app.close(); }
});

test('CLI subprocesses retain exact operations and recover lost create, update, and publish responses', async () => {
  const app = await fixture({ transport: 'rest' });
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-cli-commands-'));
  try {
    const tokens = await grant(app, fullScope);
    const environment = { ARTIFACTS_SERVER: app.config.resource, ARTIFACTS_STATE_DIR: join(directory, 'state'), ARTIFACTS_ACCESS_TOKEN: tokens.access_token };
    const snapshotFile = join(directory, 'snapshot.json');
    await writeFile(snapshotFile, JSON.stringify(snapshot));
    const identity = success(await cli(['whoami'], environment));
    assert.equal(identity.userId, app.ownerId);
    app.dropNextResourceResponse('POST');
    failure(await cli(['create', '--snapshot', snapshotFile, '--request-id', 'cli-lost-create'], environment), 'network_error');
    const createEnvelope = JSON.parse(await readFile(operationPath(environment.ARTIFACTS_STATE_DIR, app.config.resource, 'cli-lost-create'), 'utf8'));
    assert.deepEqual(createEnvelope, { version: 1, resource: app.config.resource, ownerId: app.ownerId, kind: 'create', command: { requestId: 'cli-lost-create', snapshot } });
    const created = success(await cli(['retry', 'cli-lost-create'], environment)) as ArtifactRead;
    assert.equal(created.revision.sequence, 1);
    assert.deepEqual(created.revision.snapshot, snapshot);
    assert.deepEqual(success(await cli(['list', '--limit', '1'], environment)).items.map((item: { title: string }) => item.title), ['CLI retained document']);
    const changed = { ...snapshot, content: { kind: 'html', text: '<h1>Updated after lost response</h1>' } };
    await writeFile(snapshotFile, JSON.stringify(changed));
    app.dropNextResourceResponse('PUT');
    failure(await cli(['update', created.artifactId, '--snapshot', snapshotFile, '--expected-revision', created.headRevisionId, '--request-id', 'cli-lost-update'], environment), 'network_error');
    const updated = success(await cli(['retry', 'cli-lost-update'], environment)) as ArtifactRead;
    assert.equal(updated.revision.sequence, 2);
    assert.equal(updated.revision.snapshot.content.text, '<h1>Updated after lost response</h1>');
    app.dropNextResourceResponse('PUT');
    failure(await cli(['publish', created.artifactId, '--revision', updated.revision.id, '--expected-version', '0', '--request-id', 'cli-lost-publish'], environment), 'network_error');
    const publication = success(await cli(['retry', 'cli-lost-publish'], environment));
    assert.equal(publication.version, 1);
    assert.equal(publication.revisionId, updated.revision.id);
    const replay = await cli(['retry', 'cli-lost-create'], environment);
    assert.deepEqual(success(replay), created);
    assert.match(replay.stderr, /retained receipt and may differ from current state/);
    assert.deepEqual(success(await cli(['history', created.artifactId, '--summary'], environment)).items.map((item: { sequence: number }) => item.sequence), [2, 1]);
    const out = join(directory, 'read.json');
    const current = success(await cli(['read', created.artifactId, '--out', out], environment));
    assert.deepEqual(JSON.parse(await readFile(out, 'utf8')), current);
    assert.equal(current.revision.sequence, 2);
    assert.equal(current.publication.version, 1);
    failure(await cli(['read', created.artifactId, '--out', out], environment), 'local_error');
    const zip = join(directory, 'artifact.zip');
    const exported = success(await cli(['export', created.artifactId, '--revision', created.revision.id, '--out', zip], environment));
    assert.equal(createHash('sha256').update(await readFile(zip)).digest('hex'), exported.sha256);
    assert.equal(Buffer.from(unzipSync(await readFile(zip))['content.html']).toString(), '<h1>First revision</h1>');
    const originalZip = await readFile(zip);
    failure(await cli(['export', created.artifactId, '--revision', updated.revision.id, '--out', zip], environment), 'local_error');
    assert.deepEqual(await readFile(zip), originalZip);
    const operations = await readdir(join(environment.ARTIFACTS_STATE_DIR, 'operations'));
    assert.equal(operations.length, 3);
    assert.equal((await stat(join(environment.ARTIFACTS_STATE_DIR, 'operations', operations[0]))).mode & 0o777, 0o600);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('CLI complete command files, edits, conflicts, request path safety, and owner binding preserve exact inputs', async () => {
  const app = await fixture({ transport: 'rest' });
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-cli-bindings-'));
  try {
    const tokens = await grant(app, fullScope);
    const environment = { ARTIFACTS_SERVER: app.config.resource, ARTIFACTS_STATE_DIR: join(directory, 'state'), ARTIFACTS_ACCESS_TOKEN: tokens.access_token };
    const commandFile = join(directory, 'command.json');
    const requestId = '../../outside-operation';
    await writeFile(commandFile, JSON.stringify({ requestId, snapshot, response: 'full' }));
    const created = success(await cli(['create', '--command', commandFile], environment)) as ArtifactRead;
    const retainedPath = operationPath(environment.ARTIFACTS_STATE_DIR, app.config.resource, requestId);
    assert.match(retainedPath, /\/operations\/[a-f0-9]{64}\.json$/);
    assert.equal(JSON.parse(await readFile(retainedPath, 'utf8')).command.response, 'full');
    assert.equal((await readdir(directory)).includes('outside-operation'), false);
    const changesFile = join(directory, 'changes.json');
    await writeFile(changesFile, JSON.stringify({ metadata: { title: 'Convenience edit' }, content: { text: '<h1>Edited by CLI</h1>' } }));
    const edited = success(await cli(['edit', created.artifactId, '--changes', changesFile, '--request-id', 'cli-convenience-edit'], environment)) as ArtifactRead;
    assert.deepEqual(edited.revision.snapshot.metadata, { title: 'Convenience edit', description: 'A complete snapshot', custom: { keep: ['value', 7] } });
    assert.deepEqual(edited.revision.snapshot.files, snapshot.files);
    const conflictCommand = { requestId: 'cli-frozen-conflict', artifactId: created.artifactId, expectedRevisionId: created.headRevisionId, snapshot };
    await writeFile(commandFile, JSON.stringify(conflictCommand));
    const conflict = failure(await cli(['update', '--command', commandFile], environment), 'conflict');
    assert.equal(conflict.details.currentRevisionId, edited.headRevisionId);
    const frozenPath = operationPath(environment.ARTIFACTS_STATE_DIR, app.config.resource, conflictCommand.requestId);
    const frozenBytes = await readFile(frozenPath, 'utf8');
    failure(await cli(['retry', conflictCommand.requestId], environment), 'conflict');
    assert.equal(await readFile(frozenPath, 'utf8'), frozenBytes);
    assert.deepEqual(JSON.parse(frozenBytes).command, conflictCommand);
    await writeFile(commandFile, JSON.stringify({ requestId: 'cli-publish-command', artifactId: created.artifactId, revisionId: edited.revision.id, expectedPublicationVersion: 0 }));
    const publication = success(await cli(['publish', created.artifactId, '--command', commandFile], environment));
    assert.equal(publication.version, 1);
    assert.equal(publication.revisionId, edited.revision.id);
    let mutationRequests = 0;
    app.setResourceHandler(async (request) => { if (['POST', 'PUT'].includes(request.method)) mutationRequests += 1; return app.resourceHandler(request); });
    const otherOwner = await app.auth.api.signUpEmail({ body: { name: 'Other owner', email: 'cli-other@example.test', password: app.password } });
    const signIn = await app.auth.api.signInEmail({ body: { email: 'cli-other@example.test', password: app.password }, returnHeaders: true });
    const cookie = signIn.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    const outsider = await grant({ ...app, cookie }, fullScope);
    assert.notEqual(otherOwner.user.id, app.ownerId);
    const rejectedOwner = failure(await cli(['retry', requestId], { ...environment, ARTIFACTS_ACCESS_TOKEN: outsider.access_token }), 'local_error');
    assert.equal(rejectedOwner.message, 'The retained operation belongs to a different owner');
    assert.equal(mutationRequests, 0);
    const retained = JSON.parse(await readFile(retainedPath, 'utf8'));
    retained.resource = 'https://other.example.test/mcp';
    await writeFile(retainedPath, JSON.stringify(retained), { mode: 0o600 });
    const rejectedResource = failure(await cli(['retry', requestId], environment), 'local_error');
    assert.equal(rejectedResource.message, 'The retained operation belongs to a different server resource');
    assert.equal(mutationRequests, 0);
    failure(await cli(['create', '--command', commandFile, '--request-id', 'ignored-request'], environment), 'invalid_arguments');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('CLI read quiet saves exact response bytes and preserves default stdout and failures', async () => {
  const app = await fixture({ transport: 'rest' });
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-cli-output-'));
  try {
    const tokens = await grant(app, fullScope);
    const environment = { ARTIFACTS_SERVER: app.config.resource, ARTIFACTS_STATE_DIR: join(directory, 'state'), ARTIFACTS_ACCESS_TOKEN: tokens.access_token };
    const client = createArtifactHttpClient({ resource: app.config.resource, accessToken: tokens.access_token });
    const created = await client.create({ requestId: 'cli-output-create', snapshot });
    const expected = await client.read({ artifactId: created.artifactId, revisionId: created.revision.id });
    assert.deepEqual(expected.revision.snapshot, snapshot);
    const args = ['read', created.artifactId, '--revision', created.revision.id];
    const defaultResult = await cli(args, environment);
    assert.equal(defaultResult.code, 0, defaultResult.stderr);
    assert.equal(defaultResult.stdout, `${JSON.stringify(expected)}\n`);
    const defaultOut = join(directory, 'default.json');
    const savedDefault = await cli([...args, '--out', defaultOut], environment);
    assert.equal(savedDefault.code, 0, savedDefault.stderr);
    assert.equal(savedDefault.stdout, defaultResult.stdout);
    const expectedBytes = Buffer.from(`${JSON.stringify(expected, null, 2)}\n`);
    assert.deepEqual(await readFile(defaultOut), expectedBytes);
    const quietOut = join(directory, 'quiet.json');
    const savedQuiet = await cli([...args, '--out', quietOut, '--quiet'], environment);
    assert.equal(savedQuiet.code, 0, savedQuiet.stderr);
    assert.equal(savedQuiet.stdout, '');
    assert.deepEqual(await readFile(quietOut), expectedBytes);
    assert.equal((await stat(quietOut)).mode & 0o777, 0o600);
    const compact = await client.read({ artifactId: created.artifactId, revisionId: created.revision.id, response: 'compact' });
    assert.equal(compact.revision.content.utf8Bytes, 23);
    assert.equal(Object.hasOwn(compact.revision, 'snapshot'), false);
    const compactOut = join(directory, 'compact.json');
    const savedCompact = await cli([...args, '--response', 'compact', '--out', compactOut, '--quiet'], environment);
    assert.equal(savedCompact.code, 0, savedCompact.stderr);
    assert.equal(savedCompact.stdout, '');
    assert.deepEqual(await readFile(compactOut), Buffer.from(`${JSON.stringify(compact, null, 2)}\n`));
    failure(await cli([...args, '--out', quietOut, '--quiet'], environment), 'local_error');
    assert.deepEqual(await readFile(quietOut), expectedBytes);
    const link = join(directory, 'linked.json');
    await symlink(quietOut, link);
    failure(await cli([...args, '--out', link, '--quiet'], environment), 'local_error');
    assert.deepEqual(await readFile(quietOut), expectedBytes);
    failure(await cli([...args, '--out', join(directory, 'missing', 'read.json'), '--quiet'], environment), 'local_error');
    const missingOut = join(directory, 'not-found.json');
    const missing = failure(await cli(['read', 'missing-artifact', '--out', missingOut, '--quiet'], environment), 'not_found');
    assert.equal(missing.status, 404);
    await assert.rejects(stat(missingOut), { code: 'ENOENT' });
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('CLI rejects invalid quiet options before authentication or requests', async () => {
  const app = await fixture({ transport: 'rest' });
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-cli-output-validation-'));
  try {
    const stateDir = join(directory, 'state');
    const environment = { ARTIFACTS_SERVER: app.config.resource, ARTIFACTS_STATE_DIR: stateDir };
    let requests = 0;
    app.setResourceHandler(async (request) => { requests += 1; return app.resourceHandler(request); });
    assert.equal(failure(await cli(['read', 'artifact', '--quiet'], environment), 'invalid_arguments').message, 'Specify --out');
    assert.equal(failure(await cli(['read', 'artifact', '--quiet', '--out', ''], environment), 'invalid_arguments').message, 'Specify --out');
    for (const command of ['whoami', 'create', 'update', 'edit', 'publish', 'retry', 'export']) {
      assert.equal(failure(await cli([command, '--quiet', '--out', join(directory, 'unused.json')], environment), 'invalid_arguments').message, `Option --quiet is not supported by ${command}`);
    }
    assert.equal(requests, 0);
    await assert.rejects(stat(stateDir), { code: 'ENOENT' });
    const unauthenticated = failure(await cli(['read', 'artifact', '--quiet', '--out', join(directory, 'unauthenticated.json')], environment), 'local_error');
    assert.match(unauthenticated.message, /^You are not signed in\. Run artifacts login --server /);
    assert.equal(requests, 0);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('CLI retains the same request ID independently for two resources and creates each operation exclusively', async () => {
  const first = await fixture({ transport: 'rest' });
  const second = await fixture({ transport: 'rest' });
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-cli-profiles-'));
  try {
    const firstToken = await grant(first, fullScope);
    const secondToken = await grant(second, fullScope);
    const stateDir = join(directory, 'state');
    const commandFile = join(directory, 'create.json');
    await writeFile(commandFile, JSON.stringify({ requestId: 'shared-profile-request', snapshot }));
    const firstEnv = { ARTIFACTS_SERVER: first.config.resource, ARTIFACTS_STATE_DIR: stateDir, ARTIFACTS_ACCESS_TOKEN: firstToken.access_token };
    const secondEnv = { ARTIFACTS_SERVER: second.config.resource, ARTIFACTS_STATE_DIR: stateDir, ARTIFACTS_ACCESS_TOKEN: secondToken.access_token };
    const [one, two] = await Promise.all([cli(['create', '--command', commandFile], firstEnv), cli(['create', '--command', commandFile], secondEnv)]);
    const firstArtifact = success(one);
    const secondArtifact = success(two);
    assert.equal(firstArtifact.ownerId, first.ownerId);
    assert.equal(secondArtifact.ownerId, second.ownerId);
    assert.equal((await readdir(join(stateDir, 'operations'))).length, 2);
    assert.deepEqual(success(await cli(['retry', 'shared-profile-request'], firstEnv)), firstArtifact);
    assert.deepEqual(success(await cli(['retry', 'shared-profile-request'], secondEnv)), secondArtifact);
    await writeFile(commandFile, JSON.stringify({ requestId: 'exclusive-concurrent-request', snapshot }));
    const concurrent = await Promise.all([cli(['create', '--command', commandFile], firstEnv), cli(['create', '--command', commandFile], firstEnv)]);
    assert.deepEqual(concurrent.map((result) => result.code).sort(), [0, 1]);
    assert.equal(success(concurrent.find((result) => result.code === 0)!).revision.sequence, 1);
    assert.match(failure(concurrent.find((result) => result.code === 1)!, 'local_error').message, /An operation already exists for exclusive-concurrent-request/);
    assert.equal(success(await cli(['list'], firstEnv)).items.length, 2);
    assert.equal((await readdir(join(stateDir, 'operations'))).length, 3);
  } finally { await first.close(); await second.close(); await rm(directory, { recursive: true, force: true }); }
});

test('CLI help works without configuration and invalid options fail before authoring', async () => {
  const help = await cli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^Usage: artifacts COMMAND \[OPTIONS\]\n/);
  assert.match(help.stdout, /retry REQUEST_ID/);
  assert.match(help.stdout, /Read --quiet requires --out and suppresses successful JSON stdout\./);
  assert.equal(failure(await cli(['whoami']), 'invalid_arguments').message, 'Specify --server RESOURCE or ARTIFACTS_SERVER. No production server is selected by default.');
  failure(await cli(['create', '--snapshot', 'missing', '--server', 'https://example.test/mcp', '--server', 'https://other.test/mcp']), 'invalid_arguments');
  failure(await cli(['read', 'artifact', '--summary', '--server', 'https://example.test/mcp']), 'invalid_arguments');
});


test('CLI pins one verified credential across preparation, owner binding, and submission during concurrent login', async () => {
  const app = await fixture({ transport: 'rest' });
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-cli-owner-race-'));
  try {
    const owner = await grant(app, fullScope);
    await app.auth.api.signUpEmail({ body: { name: 'Concurrent owner', email: 'concurrent-owner@example.test', password: app.password } });
    const signIn = await app.auth.api.signInEmail({ body: { email: 'concurrent-owner@example.test', password: app.password }, returnHeaders: true });
    const cookie = signIn.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    const other = await grant({ ...app, cookie }, fullScope);
    const environment = { ARTIFACTS_SERVER: app.config.resource, ARTIFACTS_STATE_DIR: join(directory, 'state') };
    let epoch = 0;
    async function select(token: typeof owner) {
      const store = await CredentialStore.open(environment.ARTIFACTS_STATE_DIR);
      try { await store.exclusive(() => store.write(app.config.resource, { epoch: ++epoch, registration: { issuer: app.config.issuer, clientId: token.clientId }, tokens: { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + 60_000 }, refreshAttempt: null })); }
      finally { store.close(); }
    }
    let switchPath = '/identity';
    let switches = 0;
    app.setResourceHandler(async (request) => {
      const response = await app.resourceHandler(request);
      if (request.method === 'GET' && new URL(request.url).pathname.endsWith(switchPath)) {
        switchPath = '/never';
        switches += 1;
        await select(other);
      }
      return response;
    });
    await select(owner);
    const file = join(directory, 'snapshot.json');
    await writeFile(file, JSON.stringify(snapshot));
    const created = success(await cli(['create', '--snapshot', file, '--request-id', 'pinned-owner-create'], environment)) as ArtifactRead;
    assert.equal(switches, 1);
    assert.equal(created.ownerId, app.ownerId);
    assert.equal(JSON.parse(await readFile(operationPath(environment.ARTIFACTS_STATE_DIR, app.config.resource, 'pinned-owner-create'), 'utf8')).ownerId, app.ownerId);
    await select(owner);
    switchPath = '/identity';
    const replay = success(await cli(['retry', 'pinned-owner-create'], environment)) as ArtifactRead;
    assert.equal(switches, 2);
    assert.deepEqual(replay, created);
    await select(owner);
    switchPath = `/artifacts/${created.artifactId}`;
    await writeFile(file, JSON.stringify({ content: { text: '<h1>Pinned owner edit</h1>' } }));
    const edited = success(await cli(['edit', created.artifactId, '--changes', file, '--request-id', 'pinned-owner-edit'], environment)) as ArtifactRead;
    assert.equal(switches, 3);
    assert.equal(edited.ownerId, app.ownerId);
    assert.equal(edited.revision.sequence, 2);
    assert.equal(edited.revision.snapshot.content.text, '<h1>Pinned owner edit</h1>');
    assert.deepEqual(edited.revision.snapshot.files, snapshot.files);
    const outsider = createArtifactHttpClient({ resource: app.config.resource, accessToken: other.access_token });
    assert.deepEqual(await outsider.list(), { items: [], nextCursor: null });
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
