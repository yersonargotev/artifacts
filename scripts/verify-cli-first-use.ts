import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { unzipSync } from 'fflate';
import { chromium, type Browser } from 'playwright';
import { artifactReadSchema, publishResultSchema, type Snapshot } from '../packages/contracts/src/index.ts';
import { canonicalResource, historyResultSchema, identitySchema, listResultSchema, projectsResultSchema, protectedResourceMetadataUrl, restBase } from '../packages/contracts/src/http.ts';

type CommandResult = { code: number | null; stdout: string; stderr: string; failure?: 'spawn' | 'timeout' | 'output-limit' };
type FailureType = 'interrupted' | 'browser-launch' | 'timeout' | 'assertion' | 'invalid-response' | 'network' | 'unexpected';
type Evidence = {
  startedAt: string;
  finishedAt?: string;
  binary: string;
  server: string;
  expectedVersion?: string;
  version?: string;
  browserVersion?: string;
  browserExecutable?: string;
  browserChannel?: 'chrome';
  artifactId?: string;
  artifactTitle?: string;
  projects?: string[];
  publicationUrl?: string;
  revisions?: string[];
  archiveSha256?: string;
  checks: string[];
  status: 'running' | 'passed' | 'failed';
  failedCheck?: string;
  failureType?: FailureType;
  failureMessage?: string;
};

const { values } = parseArgs({ options: {
  binary: { type: 'string' }, server: { type: 'string' }, report: { type: 'string' },
  'env-file': { type: 'string' }, 'expected-version': { type: 'string' },
  'browser-executable': { type: 'string' }, panel: { type: 'string' },
} });
assert(values.binary && isAbsolute(values.binary), 'Specify --binary with an absolute installed executable path');
assert(values.server, 'Specify --server with the exact canonical REST resource');
assert(values.report, 'Specify --report with a new evidence JSON path');
assert(!values['browser-executable'] || isAbsolute(values['browser-executable']), 'Specify --browser-executable with an absolute executable path');
const binary = values.binary;
const panel = values.panel ? new URL(values.panel).origin : undefined;
const server = canonicalResource(values.server);
const report = resolve(values.report);
const supplied = values['env-file'] ? parseEnv(await readFile(resolve(values['env-file']), 'utf8')) : {};
const email = process.env.OWNER_EMAIL ?? supplied.OWNER_EMAIL;
const password = process.env.OWNER_PASSWORD ?? supplied.OWNER_PASSWORD;
assert(email && password, 'Set OWNER_EMAIL and OWNER_PASSWORD or pass --env-file explicitly');
await access(binary, constants.X_OK);
await mkdir(dirname(report), { recursive: true });
await writeFile(report, '', { mode: 0o600, flag: 'wx' });
await chmod(report, 0o600);
const directory = await mkdtemp(join(tmpdir(), 'artifacts-cli-first-use-'));
await chmod(directory, 0o700);
const stateDir = join(directory, 'state');
const environment = { PATH: process.env.PATH, HOME: directory, TMPDIR: directory, ARTIFACTS_SERVER: server, ARTIFACTS_STATE_DIR: stateDir };
const children = new Set<ChildProcess>();
const evidence: Evidence = {
  startedAt: new Date().toISOString(), binary, server,
  ...(values['expected-version'] ? { expectedVersion: values['expected-version'] } : {}),
  ...(values['browser-executable'] ? { browserExecutable: values['browser-executable'] } : { browserChannel: 'chrome' as const }),
  checks: [], status: 'running',
};
let stage = 'start';
let browser: Browser | undefined;
let loggedIn = false;
let interrupted = false;
const cancel = () => {
  interrupted = true;
  process.exitCode = 1;
  for (const child of children) child.kill('SIGKILL');
  void browser?.close().catch(() => {});
};
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);
const deadline = setTimeout(cancel, 10 * 60_000);

function checked(name: string): void {
  evidence.checks.push(name);
  process.stdout.write(`Passed ${name}\n`);
}

function subprocess(args: string[], timeout = 60_000) {
  const child = spawn(binary, args, { cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let stdout = '';
  let stderr = '';
  let size = 0;
  let failure: CommandResult['failure'];
  const stop = () => {
    child.kill('SIGTERM');
    setTimeout(() => { if (children.has(child)) child.kill('SIGKILL'); }, 1_000).unref();
  };
  const timer = setTimeout(() => { failure = 'timeout'; stop(); }, timeout);
  const completed = new Promise<CommandResult>((done) => {
    child.once('error', () => {
      clearTimeout(timer);
      children.delete(child);
      done({ code: null, stdout, stderr, failure: 'spawn' });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      children.delete(child);
      done({ code, stdout, stderr, ...(failure ? { failure } : {}) });
    });
  });
  const collect = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
    size += chunk.byteLength;
    if (size > 8 * 1024 * 1024) { failure = 'output-limit'; stop(); return; }
    if (stream === 'stdout') stdout += chunk.toString();
    else stderr += chunk.toString();
  };
  child.stdout.on('data', (chunk: Buffer) => collect(chunk, 'stdout'));
  child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'stderr'));
  return { child, completed, stderr: () => stderr };
}

async function cli(args: string[]): Promise<unknown> {
  assert(!interrupted, 'Verification was interrupted');
  const result = await subprocess(args).completed;
  assert(!result.failure && result.code === 0, `Installed CLI command ${args[0]} failed`);
  return JSON.parse(result.stdout) as unknown;
}

try {
  stage = 'version';
  if (values['expected-version']) {
    const version = await subprocess(['--version']).completed;
    assert(!version.failure && version.code === 0, 'Installed CLI version command succeeds');
    assert.equal(version.stdout.trim(), values['expected-version']);
    evidence.version = version.stdout.trim();
    checked('installed-version');
  }

  stage = 'rest-discovery';
  const metadata = await fetch(protectedResourceMetadataUrl(server), { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  assert.equal(metadata.status, 200);
  const discovery = await metadata.json() as { resource?: string; authorization_servers?: string[] };
  assert.equal(discovery.resource, server);
  assert(discovery.authorization_servers?.[0]);
  const issuer = new URL(discovery.authorization_servers[0]);
  const deniedEndpoint = await fetch(`${restBase(server)}/identity`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  assert.equal(deniedEndpoint.status, 401);
  await deniedEndpoint.body?.cancel();
  checked('rest-resource-discovery-and-anonymous-denial');

  stage = 'browser-launch';
  assert(!interrupted, 'Verification was interrupted');
  if (values['browser-executable']) await access(values['browser-executable'], constants.X_OK);
  browser = await chromium.launch(values['browser-executable'] ? { executablePath: values['browser-executable'] } : { channel: 'chrome' });
  evidence.browserVersion = browser.version();
  checked('browser-launch');
  stage = 'native-login';
  const context = await browser.newContext();
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  const login = subprocess(['login', '--no-browser'], 180_000);
  let authorization: string | undefined;
  const authorizationDeadline = Date.now() + 45_000;
  while (Date.now() < authorizationDeadline) {
    authorization = login.stderr().split('\n').find((line) => {
      try {
        const candidate = new URL(line);
        return candidate.origin === issuer.origin && candidate.searchParams.has('client_id') && candidate.searchParams.has('state');
      } catch { return false; }
    });
    if (authorization) break;
    assert(login.child.exitCode === null && login.child.signalCode === null, 'Native login remains active');
    await new Promise((done) => setTimeout(done, 50));
  }
  assert(authorization, 'Native CLI supplies an authorization URL');
  await page.goto(authorization);
  await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByRole('button', { name: 'Permitir acceso', exact: true }).click();
  const signedIn = await login.completed;
  assert(!signedIn.failure && signedIn.code === 0, 'Native CLI completes browser consent');
  loggedIn = true;
  const identity = identitySchema.parse(JSON.parse(signedIn.stdout));
  assert.equal(identitySchema.parse(await cli(['whoami'])).userId, identity.userId);
  checked('native-browser-consent-and-persisted-whoami');

  stage = 'create';
  const suffix = `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  const title = `CLI npm beta verification ${suffix}`;
  const requests = { create: `first-use-create-${suffix}`, update: `first-use-update-${suffix}`, edit: `first-use-edit-${suffix}`, publish: `first-use-publish-${suffix}` };
  const snapshot: Snapshot = {
    metadata: { title, description: 'Installed CLI first-use verification. Retained intentionally.', custom: { source: 'npm-beta-verification' } },
    content: { kind: 'html', text: '<h1>CLI npm beta original</h1>' },
    files: [{ path: 'bytes.bin', mediaType: 'application/octet-stream', encoding: 'base64', data: 'AAEC/w==' }],
  };
  const snapshotFile = join(directory, 'snapshot.json');
  await writeFile(snapshotFile, JSON.stringify(snapshot), { mode: 0o600 });
  const projects = [`CLI verification ${suffix}`, `CLI verification moved ${suffix}`] as const;
  evidence.projects = [...projects];
  const created = artifactReadSchema.parse(await cli(['create', '--snapshot', snapshotFile, '--project', projects[0], '--request-id', requests.create]));
  assert.equal(created.ownerId, identity.userId);
  assert.equal(created.project, projects[0]);
  assert.equal(created.revision.sequence, 1);
  assert.deepEqual(created.revision.snapshot, snapshot);
  evidence.artifactId = created.artifactId;
  evidence.artifactTitle = title;
  const listed = listResultSchema.parse(await cli(['list', '--limit', '100']));
  assert(listed.items.some((item) => item.artifactId === created.artifactId && item.title === title));
  assert.deepEqual(artifactReadSchema.parse(await cli(['read', created.artifactId])), created);
  checked('create-list-read');

  stage = 'update-and-edit';
  const updatedSnapshot: Snapshot = { ...snapshot, content: { kind: 'html', text: '<h1>CLI npm beta updated</h1>' } };
  await writeFile(snapshotFile, JSON.stringify(updatedSnapshot), { mode: 0o600 });
  const updated = artifactReadSchema.parse(await cli(['update', created.artifactId, '--snapshot', snapshotFile, '--expected-revision', created.revision.id, '--request-id', requests.update]));
  assert.equal(updated.revision.sequence, 2);
  assert.deepEqual(updated.revision.snapshot, updatedSnapshot);
  const changesFile = join(directory, 'changes.json');
  await writeFile(changesFile, JSON.stringify({ content: { text: '<h1>CLI npm beta edited</h1>' } }), { mode: 0o600 });
  const edited = artifactReadSchema.parse(await cli(['edit', created.artifactId, '--changes', changesFile, '--request-id', requests.edit]));
  assert.equal(edited.revision.sequence, 3);
  assert.equal(edited.revision.snapshot.content.text, '<h1>CLI npm beta edited</h1>');
  assert.deepEqual(edited.revision.snapshot.files, snapshot.files);
  const history = historyResultSchema.parse(await cli(['history', created.artifactId]));
  assert.deepEqual(history.items.map((revision) => revision.id), [edited.revision.id, updated.revision.id, created.revision.id]);
  evidence.revisions = [created.revision.id, updated.revision.id, edited.revision.id];
  checked('update-edit-and-three-revision-history');

  stage = 'publish-and-retry';
  const publication = publishResultSchema.parse(await cli(['publish', created.artifactId, '--revision', created.revision.id, '--expected-version', '0', '--request-id', requests.publish]));
  assert.equal(publication.version, 1);
  assert.equal(publication.revisionId, created.revision.id);
  evidence.publicationUrl = publication.url;
  for (const [requestId, expected] of [[requests.create, created], [requests.update, updated], [requests.edit, edited], [requests.publish, publication]] as const) {
    assert.deepEqual(await cli(['retry', requestId]), expected);
  }
  assert.equal(artifactReadSchema.parse(await cli(['read', created.artifactId])).revision.id, edited.revision.id);
  checked('historical-publication-and-exact-retained-replays');

  stage = 'export';
  const zipFile = join(directory, 'original.zip');
  const repeatedZipFile = join(directory, 'original-again.zip');
  const exported = await cli(['export', created.artifactId, '--revision', created.revision.id, '--out', zipFile]) as { sha256: string; bytes: number; mediaType: string };
  await cli(['export', created.artifactId, '--revision', created.revision.id, '--out', repeatedZipFile]);
  const bytes = await readFile(zipFile);
  assert.equal(exported.mediaType, 'application/zip');
  assert.equal(exported.bytes, bytes.byteLength);
  assert.equal(exported.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(await readFile(repeatedZipFile), bytes);
  const archive = unzipSync(bytes);
  assert.equal(Buffer.from(archive['content.html']!).toString('utf8'), snapshot.content.text);
  assert.deepEqual(Buffer.from(archive['files/bytes.bin']!), Buffer.from('AAEC/w==', 'base64'));
  const manifest = JSON.parse(Buffer.from(archive['artifact.json']!).toString('utf8'));
  assert.equal(manifest.artifactId, created.artifactId);
  assert.equal(manifest.revision.id, created.revision.id);
  evidence.archiveSha256 = exported.sha256;
  checked('identical-historical-zip-and-sha256');

  stage = 'publication-browser';
  await page.goto(publication.url);
  const signIn = page.getByRole('link', { name: 'Iniciar sesión', exact: true });
  if (await signIn.count()) await signIn.click();
  await page.frameLocator('iframe').getByRole('heading', { name: 'CLI npm beta original', exact: true }).waitFor();
  assert.equal(await page.locator('main').getAttribute('data-revision-id'), created.revision.id);
  checked('protected-publication-renders-original-revision');

  stage = 'projects';
  const filtered = listResultSchema.parse(await cli(['list', '--project', projects[0].toUpperCase()]));
  assert.deepEqual(filtered.items.map((item) => [item.artifactId, item.project]), [[created.artifactId, projects[0]]]);
  const projectCount = async (name: string) => projectsResultSchema.parse(await cli(['projects'])).items.find((project) => project.name === name)?.artifactCount;
  assert.equal(await projectCount(projects[0]), 1);
  assert.deepEqual(await cli(['move', created.artifactId, '--project', projects[1]]), { artifactId: created.artifactId, project: projects[1] });
  const moved = artifactReadSchema.parse(await cli(['read', created.artifactId]));
  assert.equal(moved.project, projects[1]);
  assert.equal(moved.headRevisionId, edited.revision.id);
  assert.equal(await projectCount(projects[0]), undefined);
  assert.equal(await projectCount(projects[1]), 1);
  checked('create-with-project-filter-list-and-move');

  if (panel) {
    stage = 'panel-projects';
    await page.goto(`${panel}/?${new URLSearchParams({ project: projects[1] })}`);
    const panelSignIn = page.getByRole('link', { name: 'Iniciar sesión', exact: true });
    if (await panelSignIn.count()) await panelSignIn.click();
    const consent = page.getByRole('button', { name: 'Permitir acceso', exact: true });
    const sidebarLink = page.getByRole('navigation', { name: 'Tus proyectos', exact: true }).getByRole('link', { name: `${projects[1]} (1)`, exact: true });
    await Promise.race([sidebarLink.waitFor(), consent.waitFor().then(() => consent.click())]);
    await sidebarLink.waitFor();
    assert.equal(await sidebarLink.getAttribute('aria-current'), 'page');
    assert.deepEqual(await page.locator('.artifact-list h2').allTextContents(), [title]);
    checked('panel-sidebar-groups-moved-artifact');
  }

  assert.deepEqual(await cli(['move', created.artifactId, '--no-project']), { artifactId: created.artifactId, project: null });
  assert.equal(await projectCount(projects[1]), undefined);
  checked('remove-from-project-leaves-no-verification-project');

  stage = 'logout';
  const signedOut = await cli(['logout']) as { signedOut: boolean; remoteRevocation: string };
  assert.equal(signedOut.signedOut, true);
  assert.equal(signedOut.remoteRevocation, 'confirmed');
  loggedIn = false;
  const denied = await subprocess(['whoami']).completed;
  assert(!denied.failure && denied.code !== 0, 'Whoami fails after logout');
  assert.match(denied.stderr, /login|unauthenticated|not signed in/i);
  checked('own-credential-logout-and-denied-whoami');
  assert(!interrupted, 'Verification was interrupted');
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  evidence.failedCheck = stage;
  evidence.failureType = interrupted ? 'interrupted'
    : stage === 'browser-launch' ? 'browser-launch'
    : error instanceof Error && error.name === 'TimeoutError' ? 'timeout'
    : error instanceof assert.AssertionError ? 'assertion'
    : error instanceof SyntaxError || (error instanceof Error && error.name === 'ZodError') ? 'invalid-response'
    : stage === 'rest-discovery' && error instanceof TypeError ? 'network'
    : 'unexpected';
  const operationalMessages: Record<string, string> = {
    version: 'Check the installed CLI executable and expected version.',
    'rest-discovery': 'Check the REST resource URL, discovery response, and network access.',
    'browser-launch': 'Check the selected browser executable, execution permissions, and OS dependencies.',
    'native-login': 'Check the owner credentials, authorization page, consent controls, and CLI callback.',
    create: 'Check authenticated artifact create, list, and read operations.',
    'update-and-edit': 'Check artifact update, edit, and revision history operations.',
    'publish-and-retry': 'Check historical publication and retained request replay operations.',
    export: 'Check historical ZIP export, archive contents, and SHA-256 consistency.',
    'publication-browser': 'Check protected publication access and original revision rendering.',
    projects: 'Check create with a project, project filtering, the projects list, and move.',
    'panel-projects': 'Check panel sign-in and the Proyectos sidebar for the moved artifact.',
    logout: 'Check credential revocation and authentication denial after logout.',
  };
  evidence.failureMessage = interrupted ? 'Verification was interrupted or exceeded its overall deadline.'
    : operationalMessages[stage] ?? 'Check the verification environment.';
  process.exitCode = 1;
  process.stderr.write(`First-use verification failed at ${stage} (${evidence.failureType}). ${evidence.failureMessage}\n`);
} finally {
  clearTimeout(deadline);
  if (loggedIn) {
    const cleanup = await subprocess(['logout'], 20_000).completed;
    if (cleanup.code === 0 && !cleanup.failure) checked('failure-cleanup-own-credential-logout');
  }
  await Promise.allSettled([...children].map(async (child) => {
    child.kill('SIGKILL');
    await new Promise<void>((done) => { child.once('close', () => done()); setTimeout(done, 2_000).unref(); });
  }));
  await browser?.close().catch(() => {});
  await rm(directory, { recursive: true, force: true });
  evidence.finishedAt = new Date().toISOString();
  await writeFile(report, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', cancel);
  process.stdout.write(`Evidence saved to ${report}\n`);
}
