import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { unzipSync } from 'fflate';
import { chromium, type Browser } from 'playwright';
import {
  artifactReadSchema,
  publishResultSchema,
  type ArtifactRead,
  type Snapshot,
} from '../packages/contracts/src/index.ts';
import {
  historyResultSchema,
  identitySchema,
  listResultSchema,
} from '../packages/contracts/src/http.ts';
import { restCliFixture } from '../tests/rest-cli-fixture.ts';
import { verifyRetainedArtifact } from '../.agents/skills/verify-artifacts/scripts/retained.ts';
import { readInventory } from './package-catalog.ts';
type CheckName = (typeof checks)[number];
type CheckResult = {
  name: CheckName;
} & (
  | {
      status: 'passed';
      detail?: string;
    }
  | {
      status: 'failed';
      category: 'setup' | 'product' | 'skill-execution';
      detail: string;
    }
  | {
      status: 'untested';
      reason: string;
    }
);
type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  failure?: 'spawn' | 'timeout' | 'output-limit';
};
const checks = [
  'installation',
  'provenance',
  'browser',
  'fresh-login',
  'create',
  'edit-preservation',
  'historical-read',
  'bounded-output',
  'list-pagination',
  'retained-replay',
  'response-loss-recovery',
  'history-pagination',
  'stale-conflict',
  'historical-export',
  'publication',
  'anonymous-denial',
  'panel-authentication',
  'standalone-rendering',
  'retained-browser',
  'keyboard',
  'revocation',
  'cleanup',
] as const;
const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    inventory: { type: 'string' },
    'browser-executable': { type: 'string' },
    report: { type: 'string' },
  },
});
assert(
  values.source === 'registry' || values.source === 'local-tarballs',
  '--source must be registry or local-tarballs',
);
assert(
  values.report && isAbsolute(values.report),
  '--report must be a new absolute JSON path',
);
assert(
  values['browser-executable'] && isAbsolute(values['browser-executable']),
  '--browser-executable must be absolute',
);
assert(
  values.source !== 'local-tarballs' ||
    (values.inventory && isAbsolute(values.inventory)),
  'Local tarballs require an absolute --inventory',
);
const root = fileURLToPath(new URL('..', import.meta.url));
const reportPath = values.report;
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, '', { flag: 'wx', mode: 0o600 });
const evidenceDirectory = `${reportPath}.evidence`;
await mkdir(evidenceDirectory, { mode: 0o700 });
const directory = await mkdtemp(join(tmpdir(), 'artifacts-cli-lifecycle-'));
await chmod(directory, 0o700);
const stateDir = join(directory, 'state');
const environment: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: join(directory, 'home'),
  TMPDIR: directory,
  XDG_CONFIG_HOME: join(directory, 'config'),
  XDG_CACHE_HOME: join(directory, 'cache'),
  XDG_DATA_HOME: join(directory, 'data'),
  XDG_STATE_HOME: join(directory, 'xdg-state'),
  ARTIFACTS_STATE_DIR: stateDir,
  npm_config_userconfig: join(directory, 'npmrc'),
  npm_config_cache: join(directory, 'npm-cache'),
  npm_config_registry: 'https://registry.npmjs.org/',
  npm_config_globalconfig: join(directory, 'npm-globalrc'),
};
await mkdir(environment.HOME!, { mode: 0o700 });
await writeFile(environment.npm_config_globalconfig!, '', { mode: 0o600 });
await writeFile(
  environment.npm_config_userconfig!,
  'registry=https://registry.npmjs.org/\n',
  { mode: 0o600 },
);
const report: {
  startedAt: string;
  finishedAt?: string;
  source: string;
  status: 'running' | 'passed' | 'failed';
  provenance?: unknown;
  server?: string;
  browser?: unknown;
  artifactId?: string;
  revisions?: string[];
  archiveSha256?: string;
  recovery?: unknown;
  skill?: unknown;
  outcomes?: unknown;
  skillExecution: {
    status: 'untested';
    reason: string;
  };
  interrupted?: boolean;
  checks: CheckResult[];
} = {
  startedAt: new Date().toISOString(),
  source: values.source,
  status: 'running',
  skillExecution: {
    status: 'untested',
    reason:
      'This deterministic lifecycle proof follows the captured skill commands. It does not evaluate an independent agent executing the skill or establish skill quality.',
  },
  checks: [],
};
const children = new Set<ChildProcess>();
let app: Awaited<ReturnType<typeof restCliFixture>> | undefined;
let browser: Browser | undefined;
let binary = join(directory, 'node_modules/.bin/artifacts');
let active: CheckName = 'installation';
let interrupted = false;
let category: 'setup' | 'product' | 'skill-execution' = 'setup';
async function save() {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
}
async function checked(name: CheckName, detail?: string) {
  report.checks.push({ name, status: 'passed', ...(detail ? { detail } : {}) });
  await save();
  process.stdout.write(`Passed ${name}\n`);
}
function subprocess(command: string, args: string[], timeout = 60000) {
  const child = spawn(command, args, {
    cwd: directory,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let stdout = '';
  let stderr = '';
  let size = 0;
  let failure: CommandResult['failure'];
  const stop = () => {
    child.kill('SIGKILL');
  };
  const timer = setTimeout(() => {
    failure = 'timeout';
    stop();
  }, timeout);
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
    size += chunk.length;
    if (size > 8 * 1024 * 1024) {
      failure = 'output-limit';
      stop();
      return;
    }
    if (stream === 'stdout') stdout += chunk.toString();
    else stderr += chunk.toString();
  };
  child.stdout.on('data', (chunk: Buffer) => collect(chunk, 'stdout'));
  child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'stderr'));
  return { child, completed, stderr: () => stderr };
}
async function cli(args: string[]) {
  assert(!interrupted, 'Evaluation was interrupted');
  const result = await subprocess(binary, args).completed;
  assert.equal(
    result.failure,
    undefined,
    `CLI ${args[0]} subprocess completes`,
  );
  assert.equal(result.code, 0, `CLI ${args[0]} succeeds`);
  return JSON.parse(result.stdout) as unknown;
}
function failure(result: CommandResult, code: string) {
  assert.equal(result.failure, undefined, 'Failure is reported by the CLI');
  assert.notEqual(result.code, 0, 'CLI failure exits nonzero');
  assert.equal(result.stdout, '', 'CLI failure leaves stdout empty');
  const diagnostic = result.stderr.trim().split('\n').at(-1);
  assert(diagnostic, 'CLI failure writes stderr JSON');
  assert.equal(
    (
      JSON.parse(diagnostic) as {
        error: {
          code: string;
        };
      }
    ).error.code,
    code,
  );
}
const hash = (bytes: string | Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
async function history(artifactId: string) {
  const ids: string[] = [];
  let before: number | null = null;
  do {
    const result = historyResultSchema.parse(
      await cli([
        'history',
        artifactId,
        '--limit',
        '1',
        ...(before === null ? [] : ['--before-sequence', String(before)]),
      ]),
    );
    assert.equal(result.items.length, 1);
    ids.push(result.items[0]!.id);
    before = result.nextBeforeSequence;
    assert(ids.length < 20);
  } while (before !== null);
  assert.equal(new Set(ids).size, ids.length);
  return ids;
}
const cancel = () => {
  interrupted = true;
  report.interrupted = true;
  process.exitCode = 1;
  for (const child of children) child.kill('SIGKILL');
  void browser?.close().catch(() => {});
};
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);
try {
  let packages: string[];
  const inventory =
    values.source === 'local-tarballs'
      ? await readInventory(values.inventory!)
      : undefined;
  if (values.source === 'registry')
    packages = ['@yargote/artifacts-cli@0.1.0-beta.1'];
  else {
    packages = inventory!.packages
      .filter((item) => item.public)
      .map((item) => join(dirname(values.inventory!), item.tarball));
    assert.equal(packages.length, 3);
  }
  await writeFile(join(directory, 'package.json'), '{"private":true}\n', {
    mode: 0o600,
  });
  const installation = await subprocess(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--registry=https://registry.npmjs.org/',
      ...packages,
    ],
    180000,
  ).completed;
  assert.equal(installation.failure, undefined, 'npm install completes');
  assert.equal(installation.code, 0, 'npm install succeeds');
  await checked(active);
  active = 'provenance';
  binary = await realpath(binary);
  const version = await subprocess(binary, ['--version']).completed;
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), '0.1.0-beta.1');
  const lock = JSON.parse(
    await readFile(join(directory, 'package-lock.json'), 'utf8'),
  ) as {
    packages: Record<
      string,
      {
        version?: string;
        resolved?: string;
        integrity?: string;
        link?: boolean;
      }
    >;
  };
  const installed = Object.fromEntries(
    Object.entries(lock.packages)
      .filter(([key]) => key.startsWith('node_modules/'))
      .map(([key, value]) => [
        key,
        {
          version: value.version,
          resolved: value.resolved,
          integrity: value.integrity,
        },
      ]),
  );
  for (const [key, item] of Object.entries(lock.packages).filter(([key]) =>
    key.startsWith('node_modules/'),
  )) {
    assert(!item.link, 'Installed package is not linked');
    assert(
      item.integrity?.startsWith('sha512-'),
      'Installed package has SHA-512 integrity',
    );
    const candidate = inventory?.packages.find(
      (pkg) => key === `node_modules/${pkg.name}`,
    );
    if (candidate)
      assert.equal(
        item.integrity,
        candidate.integrity,
        'Candidate integrity matches supplied inventory',
      );
    else
      assert.equal(
        new URL(item.resolved!).origin,
        'https://registry.npmjs.org',
        'Registry package resolves to public registry',
      );
  }
  const npmVersion = await subprocess('npm', ['--version']).completed;
  assert.equal(npmVersion.code, 0);
  const sourceSha = await subprocess('git', ['-C', root, 'rev-parse', 'HEAD'])
    .completed;
  const dirty = await subprocess('git', ['-C', root, 'status', '--porcelain'])
    .completed;
  report.provenance = {
    binary,
    binarySha256: hash(await readFile(binary)),
    version: version.stdout.trim(),
    registry: 'https://registry.npmjs.org/',
    packages: installed,
    sourceSha: sourceSha.stdout.trim(),
    uncommittedCandidate:
      values.source === 'local-tarballs' && dirty.stdout.length > 0,
    publishedRelease: values.source === 'registry',
    nodeVersion: process.version,
    npmVersion: npmVersion.stdout.trim(),
    sourceFiles: await Promise.all(
      [
        'scripts/verify-cli-lifecycle.ts',
        'tests/rest-cli-fixture.ts',
        'scripts/build-packages.ts',
        'apps/cli/src/index.ts',
      ].map(async (file) => ({
        file,
        sha256: hash(await readFile(join(root, file))),
      })),
    ),
  };
  const skill = ['SKILL.md', 'references/commands.md'];
  report.skill = await Promise.all(
    skill.map(async (file) => {
      const source = join(root, 'skills/artifacts-cli', file);
      const bytes = await readFile(source);
      await copyFile(
        source,
        join(evidenceDirectory, file.replaceAll('/', '-')),
      );
      return { source, sha256: hash(bytes) };
    }),
  );
  await checked(active);
  active = 'browser';
  app = await restCliFixture({ directory });
  environment.ARTIFACTS_SERVER = app.config.resource;
  report.server = app.config.resource;
  browser = await chromium.launch({
    executablePath: values['browser-executable'],
  });
  report.browser = {
    executable: values['browser-executable'],
    version: browser.version(),
  };
  await checked(active);
  category = 'product';
  active = 'fresh-login';
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  context.setDefaultTimeout(30000);
  const page = await context.newPage();
  const login = subprocess(binary, ['login', '--no-browser'], 180000);
  let authorization: string | undefined;
  for (let attempt = 0; attempt < 600; attempt++) {
    authorization = login
      .stderr()
      .split('\n')
      .find((line) =>
        line.startsWith(`${app!.config.issuer}/oauth2/authorize?`),
      );
    if (authorization) break;
    assert(login.child.exitCode === null);
    await new Promise((done) => setTimeout(done, 50));
  }
  assert(authorization, 'CLI supplies native authorization URL');
  await page.goto(authorization);
  await page
    .getByLabel('Correo electrónico', { exact: true })
    .fill('owner@example.test');
  await page.getByLabel('Contraseña', { exact: true }).fill(app.password);
  await page
    .getByRole('button', { name: 'Iniciar sesión', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Permitir acceso', exact: true })
    .click();
  const signedIn = await login.completed;
  assert.equal(signedIn.code, 0);
  assert.equal(
    identitySchema.parse(JSON.parse(signedIn.stdout)).userId,
    app.ownerId,
  );
  assert.equal(identitySchema.parse(await cli(['whoami'])).userId, app.ownerId);
  await checked(active);
  active = 'create';
  const snapshot: Snapshot = {
    metadata: {
      title: 'CLI lifecycle retained artifact',
      description: 'Disposable local lifecycle proof',
      custom: {
        source: 'isolated-evaluation',
        count: 7,
        nested: { preserved: true },
      },
    },
    content: {
      kind: 'html',
      text: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lifecycle</title></head><body><h1>Lifecycle original</h1><button id="increment">Increment</button><output id="count">0</output><script>document.querySelector("#increment").addEventListener("click",()=>document.querySelector("#count").textContent="1")</script></body></html>',
    },
    files: [
      {
        path: 'notes/café.txt',
        mediaType: 'text/plain',
        encoding: 'utf8',
        data: 'Café, niño, 日本語.\n',
      },
      {
        path: 'bytes.bin',
        mediaType: 'application/octet-stream',
        encoding: 'base64',
        data: 'AAEC/w==',
      },
    ],
  };
  const snapshotFile = join(directory, 'snapshot.json');
  await writeFile(snapshotFile, JSON.stringify(snapshot), { mode: 0o600 });
  const created = artifactReadSchema.parse(
    await cli([
      'create',
      '--snapshot',
      snapshotFile,
      '--request-id',
      'lifecycle-create',
    ]),
  );
  assert.deepEqual(created.revision.snapshot, snapshot);
  assert.equal(created.revision.sequence, 1);
  report.artifactId = created.artifactId;
  await cli([
    'create',
    '--snapshot',
    snapshotFile,
    '--request-id',
    'lifecycle-second-artifact',
  ]);
  await checked(active);
  active = 'edit-preservation';
  const changes = join(directory, 'changes.json');
  const changedText = snapshot.content.text.replace(
    'Lifecycle original',
    'Lifecycle edited',
  );
  await writeFile(changes, JSON.stringify({ content: { text: changedText } }), {
    mode: 0o600,
  });
  const edited = artifactReadSchema.parse(
    await cli([
      'edit',
      created.artifactId,
      '--changes',
      changes,
      '--request-id',
      'lifecycle-edit',
    ]),
  );
  assert.equal(edited.revision.sequence, 2);
  assert.deepEqual(edited.revision.snapshot, {
    ...snapshot,
    content: { ...snapshot.content, text: changedText },
  });
  await checked(active);
  active = 'historical-read';
  const historical = artifactReadSchema.parse(
    await cli(['read', created.artifactId, '--revision', created.revision.id]),
  );
  assert.deepEqual(historical.revision, created.revision);
  await checked(active);
  active = 'bounded-output';
  const defaultPath = join(directory, 'default-read.json');
  const defaultRead = await subprocess(binary, [
    'read',
    created.artifactId,
    '--revision',
    created.revision.id,
    '--out',
    defaultPath,
  ]).completed;
  assert.equal(defaultRead.code, 0);
  assert.deepEqual(JSON.parse(defaultRead.stdout), historical);
  const savedBytes = await readFile(defaultPath);
  assert.deepEqual(JSON.parse(savedBytes.toString()), historical);
  const quietPath = join(directory, 'quiet-read.json');
  const quiet = await subprocess(binary, [
    'read',
    created.artifactId,
    '--revision',
    created.revision.id,
    '--out',
    quietPath,
    '--quiet',
  ]).completed;
  if (values.source === 'registry') {
    assert.notEqual(quiet.code, 0);
    assert.match(quiet.stderr, /quiet|unknown|unexpected/i);
    await checked(
      active,
      'Published beta has no --quiet capability; rejection is the expected baseline.',
    );
  } else {
    assert.equal(quiet.code, 0);
    assert.equal(quiet.stdout, '');
    assert.deepEqual(await readFile(quietPath), savedBytes);
    for (const args of [
      ['read', created.artifactId, '--quiet'],
      ['read', created.artifactId, '--out', defaultPath, '--quiet'],
      [
        'read',
        '00000000-0000-4000-8000-000000000000',
        '--out',
        join(directory, 'missing.json'),
        '--quiet',
      ],
    ]) {
      const denied = await subprocess(binary, args).completed;
      assert.notEqual(denied.code, 0);
      assert.equal(denied.stdout, '');
      assert(denied.stderr.length > 0);
    }
    assert.deepEqual(await readFile(defaultPath), savedBytes);
    await checked(active);
  }
  active = 'list-pagination';
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const result = listResultSchema.parse(
      await cli([
        'list',
        '--limit',
        '1',
        ...(cursor === null ? [] : ['--cursor', cursor]),
      ]),
    );
    assert.equal(result.items.length, 1);
    ids.push(result.items[0]!.artifactId);
    cursor = result.nextCursor;
    assert(ids.length < 20);
  } while (cursor !== null);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
  await checked(active);
  active = 'retained-replay';
  const beforeReplay = await history(created.artifactId);
  assert.deepEqual(await cli(['retry', 'lifecycle-create']), created);
  assert.deepEqual(await history(created.artifactId), beforeReplay);
  await checked(active);
  active = 'response-loss-recovery';
  const nextSnapshot = {
    ...snapshot,
    content: {
      ...snapshot.content,
      text: snapshot.content.text.replace(
        'Lifecycle original',
        'Lifecycle recovered',
      ),
    },
  };
  await writeFile(snapshotFile, JSON.stringify(nextSnapshot));
  app.dropNextResourceResponse('PUT');
  const lost = await subprocess(binary, [
    'update',
    created.artifactId,
    '--snapshot',
    snapshotFile,
    '--expected-revision',
    edited.revision.id,
    '--request-id',
    'lifecycle-response-loss',
  ]).completed;
  failure(lost, 'network_error');
  assert.match(lost.stderr, /retry lifecycle-response-loss/);
  const operation = join(
    stateDir,
    'operations',
    `${hash(JSON.stringify([app.config.resource, 'lifecycle-response-loss']))}.json`,
  );
  const operationBefore = hash(await readFile(operation));
  const persisted = artifactReadSchema.parse(
    await cli(['read', created.artifactId]),
  );
  assert.equal(persisted.revision.sequence, 3);
  assert.deepEqual(persisted.revision.snapshot, nextSnapshot);
  const committedHistory = await history(created.artifactId);
  assert.equal(committedHistory.length, 3);
  const recovered = artifactReadSchema.parse(
    await cli(['retry', 'lifecycle-response-loss']),
  );
  assert.deepEqual(recovered, persisted);
  assert.deepEqual(await history(created.artifactId), committedHistory);
  assert.equal(hash(await readFile(operation)), operationBefore);
  report.recovery = {
    committedBeforeRetry: true,
    operationSha256Before: operationBefore,
    operationSha256After: hash(await readFile(operation)),
    originalRequestId: 'lifecycle-response-loss',
    revisionsBeforeRetry: committedHistory.length,
    revisionsAfterRetry: (await history(created.artifactId)).length,
  };
  await checked(active);
  active = 'history-pagination';
  assert.deepEqual(await history(created.artifactId), [
    persisted.revision.id,
    edited.revision.id,
    created.revision.id,
  ]);
  report.revisions = [
    created.revision.id,
    edited.revision.id,
    persisted.revision.id,
  ];
  await checked(active);
  active = 'stale-conflict';
  const stale = await subprocess(binary, [
    'update',
    created.artifactId,
    '--snapshot',
    snapshotFile,
    '--expected-revision',
    created.revision.id,
    '--request-id',
    'lifecycle-stale',
  ]).completed;
  failure(stale, 'conflict');
  const repeatedConflict = await subprocess(binary, [
    'retry',
    'lifecycle-stale',
  ]).completed;
  failure(repeatedConflict, 'conflict');
  assert.equal(
    artifactReadSchema.parse(await cli(['read', created.artifactId])).revision
      .id,
    persisted.revision.id,
  );
  assert.deepEqual(await history(created.artifactId), committedHistory);
  await checked(active);
  active = 'historical-export';
  const archivePath = join(evidenceDirectory, 'historical.zip');
  const repeatPath = join(directory, 'historical-repeat.zip');
  await cli([
    'export',
    created.artifactId,
    '--revision',
    created.revision.id,
    '--out',
    archivePath,
  ]);
  await cli([
    'export',
    created.artifactId,
    '--revision',
    created.revision.id,
    '--out',
    repeatPath,
  ]);
  const archive = await readFile(archivePath);
  assert.deepEqual(await readFile(repeatPath), archive);
  const entries = unzipSync(archive);
  assert.equal(
    Buffer.from(entries['content.html']!).toString(),
    snapshot.content.text,
  );
  assert.deepEqual(
    Buffer.from(entries['files/bytes.bin']!),
    Buffer.from([0, 1, 2, 255]),
  );
  assert.equal(
    Buffer.from(entries['files/notes/café.txt']!).toString(),
    snapshot.files[0]!.data,
  );
  const manifest = JSON.parse(
    Buffer.from(entries['artifact.json']!).toString(),
  ) as ArtifactRead;
  assert.equal(manifest.artifactId, created.artifactId);
  assert.equal(manifest.revision.id, created.revision.id);
  report.archiveSha256 = hash(archive);
  await checked(active);
  active = 'publication';
  const published = publishResultSchema.parse(
    await cli([
      'publish',
      created.artifactId,
      '--revision',
      created.revision.id,
      '--expected-version',
      '0',
      '--request-id',
      'lifecycle-publish',
    ]),
  );
  assert.equal(published.revisionId, created.revision.id);
  assert.equal(published.version, 1);
  assert.deepEqual(await cli(['retry', 'lifecycle-publish']), published);
  const currentHistorical = artifactReadSchema.parse(
    await cli(['read', created.artifactId, '--revision', created.revision.id]),
  );
  assert.equal(currentHistorical.publication?.revisionId, created.revision.id);
  await checked(active);
  active = 'anonymous-denial';
  const anonymous = await browser.newContext();
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto(published.url);
  await anonymousPage
    .getByLabel('Correo electrónico', { exact: true })
    .waitFor();
  assert.equal(await anonymousPage.locator('iframe').count(), 0);
  assert.equal(
    (
      await anonymous.request.get(
        `${app.dashboard}/artifacts/${created.artifactId}/preview?revisionId=${created.revision.id}`,
        { maxRedirects: 0 },
      )
    ).status(),
    401,
  );
  await anonymous.close();
  await checked(active);
  active = 'panel-authentication';
  await page.goto(app.dashboard);
  await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Tus artefactos', exact: true })
    .waitFor();
  await checked(active);
  active = 'standalone-rendering';
  const standaloneFile = join(directory, 'standalone.html');
  await writeFile(standaloneFile, snapshot.content.text, { mode: 0o600 });
  const standalone = await context.newPage();
  await standalone.goto(new URL(`file://${standaloneFile}`).href);
  await standalone.locator('#increment').click();
  assert.equal(await standalone.locator('#count').innerText(), '1');
  await standalone.close();
  await checked(active);
  active = 'retained-browser';
  const panelUrl = `${app.dashboard}/artifacts/${created.artifactId}?revisionId=${created.revision.id}`;
  const retained = await verifyRetainedArtifact(context, {
    expected: currentHistorical,
    panelUrl,
    publicationUrl: published.url,
    viewports: [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
    ],
    expectations: [
      { kind: 'text', selector: 'h1', text: 'Lifecycle original' },
      { kind: 'text', selector: '#count', text: '0' },
      { kind: 'click', selector: '#increment' },
      { kind: 'text', selector: '#count', text: '1' },
    ],
    evidenceDirectory: join(evidenceDirectory, 'retained'),
  });
  assert.equal(retained.status, 'passed');
  assert.equal(retained.publication, 'verified');
  assert.deepEqual(
    await readFile(join(evidenceDirectory, 'retained/panel-0.zip')),
    archive,
  );
  await checked(active);
  active = 'keyboard';
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(panelUrl);
    const trigger = page.getByRole('button', {
      name: `Menú de ${snapshot.metadata.title}`,
      exact: true,
    });
    await trigger.focus();
    await trigger.press('Enter');
    const download = page.getByRole('menuitem', {
      name: 'Descargar revisión 1',
      exact: true,
    });
    await download.waitFor();
    await page.waitForFunction(
      () => document.activeElement?.textContent === 'Descargar revisión 1',
    );
    assert.equal(
      await download.evaluate((item) => item === document.activeElement),
      true,
    );
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(
      () => document.activeElement?.textContent === 'Información',
    );
    assert.equal(
      await page
        .getByRole('menuitem', { name: 'Información', exact: true })
        .evaluate((item) => item === document.activeElement),
      true,
    );
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    await page.waitForFunction(() =>
      document.activeElement?.classList.contains('artifact-title-trigger'),
    );
    assert.equal(
      await trigger.evaluate((item) => item === document.activeElement),
      true,
    );
  }
  await checked(active);
  active = 'revocation';
  await page.goto(`${app.config.origin}/revoke-all`);
  await page
    .getByRole('button', { name: 'Cerrar todas las sesiones', exact: true })
    .click();
  for (const args of [
    ['read', created.artifactId],
    ['retry', 'lifecycle-create'],
  ]) {
    const denied = await subprocess(binary, args).completed;
    failure(denied, 'unauthenticated');
  }
  await page.goto(panelUrl);
  await page.getByLabel('Correo electrónico', { exact: true }).waitFor();
  const revokedViewer = await context.request.get(published.url, {
    maxRedirects: 0,
  });
  assert.equal(revokedViewer.status(), 403);
  assert(!(await revokedViewer.text()).includes('Lifecycle original'));
  await checked(active);
  assert(!interrupted, 'Evaluation was interrupted');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.checks.push({
    name: active,
    status: 'failed',
    category,
    detail:
      error instanceof assert.AssertionError
        ? `Assertion failed at ${active}: ${error.message.split('\n')[0]}`
        : error instanceof Error && error.name === 'TimeoutError'
          ? `Timed out at ${active}; inspect retained sanitized evidence.`
          : `Execution failed at ${active}; inspect environment and rerun.`,
  });
  process.exitCode = 1;
  process.stderr.write(
    `Lifecycle evaluation failed at ${active} (${category}).\n`,
  );
} finally {
  for (const name of checks.filter((name) => name !== 'cleanup'))
    if (!report.checks.some((check) => check.name === name))
      report.checks.push({
        name,
        status: 'untested',
        reason: 'A prerequisite did not complete.',
      });
  const cleanupFailures: string[] = [];
  for (const child of children) {
    try {
      await new Promise<void>((done, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Child did not stop')),
          5000,
        );
        child.once('close', () => {
          clearTimeout(timer);
          done();
        });
        child.kill('SIGKILL');
      });
    } catch {
      cleanupFailures.push('CLI subprocess');
    }
  }
  try {
    await browser?.close();
  } catch {
    cleanupFailures.push('browser');
  }
  try {
    await app?.close();
  } catch {
    cleanupFailures.push('fixture');
  }
  try {
    await rm(directory, { recursive: true, force: true });
  } catch {
    cleanupFailures.push('private directory');
  }
  const secretsRemoved = await access(directory).then(
    () => false,
    (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
  );
  if (cleanupFailures.length > 0 || !secretsRemoved || browser?.isConnected()) {
    report.status = 'failed';
    process.exitCode = 1;
    report.checks.push({
      name: 'cleanup',
      status: 'failed',
      category: 'setup',
      detail:
        'Owned browser, services, or private state cleanup did not complete.',
    });
  } else
    report.checks.push({
      name: 'cleanup',
      status: 'passed',
      detail:
        'Owned browser, fixture servers/database, and temporary CLI secrets removed.',
    });
  const outcome = (name: CheckName) =>
    report.checks.find((check) => check.name === name)?.status ?? 'untested';
  report.outcomes = {
    persistence: outcome('historical-export'),
    localRendering: outcome('standalone-rendering'),
    hostedRendering: {
      status: outcome('retained-browser'),
      scope:
        'Isolated real Astro panel; production hosting is untested by this evaluator.',
    },
    protectedPublication: {
      status: outcome('retained-browser'),
      scope: 'Disposable local publication only.',
    },
  };
  report.finishedAt = new Date().toISOString();
  await save();
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', cancel);
  process.stdout.write(`Evidence saved to ${reportPath}\n`);
}
