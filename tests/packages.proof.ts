import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build, transform } from 'esbuild';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fixture, grant } from './helpers.ts';
import { readInventory, packageOutput as portableOutput, nativePackageOutput, verifyNativeInventory } from '../scripts/package-catalog.ts';
import { verifyRelease } from '../scripts/release-npm.ts';
const { values } = parseArgs({ options: { 'native-fixed': { type: 'boolean' } } });
const packageOutput = values['native-fixed'] ? nativePackageOutput : portableOutput;
const inventory = await readInventory(join(packageOutput, 'manifest.json'));
if (inventory.profile) {
  await verifyNativeInventory(inventory, packageOutput);
  await assert.rejects(verifyRelease(inventory, packageOutput), /Native-fixed inventories are private/);
}

const root = process.cwd();
const directory = await mkdtemp(join(tmpdir(), 'artifacts-packed-consumer-'));
const app = await fixture({ transport: 'rest', invitations: true });
async function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve(stdout) : reject(new Error(`${command} ${args.join(' ')} failed (${code}): ${stdout}\n${stderr}`)));
  });
}
async function install(path: string, names: string[], selectedInventory = inventory, selectedOutput = packageOutput) {
  await writeFile(join(path, 'package.json'), JSON.stringify({ name: 'ordinary-node-consumer', private: true, type: 'module', dependencies: Object.fromEntries(names.map((name) => {
    const packed = selectedInventory.packages.find((item) => item.directory.endsWith(`/${name}`));
    assert.ok(packed, `Package ${name} exists in inventory`);
    return [packed.name, `file:${resolve(selectedOutput, packed.tarball)}`];
  })) }));
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], path);
}
async function prepareInstalledApi(path: string) {
  const extra = new Map<string, string>();
  for (const source of ['apps/auth/package.json', 'apps/mcp/package.json']) {
    const manifest = JSON.parse(await readFile(join(root, source), 'utf8')) as { dependencies: Record<string, string> };
    for (const [name, version] of Object.entries(manifest.dependencies)) if (!version.startsWith('workspace:')) extra.set(name, version);
  }
  for (const [name, version] of Object.entries({ '@better-auth/oauth-provider': '1.7.7', '@better-auth/core': '1.7.7', '@better-auth/utils': '0.4.2', 'better-call': '1.4.0' })) extra.set(name, version);
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', ...[...extra].map(([name, version]) => `${name}@${version}`)], path);
  const proof = join(path, 'proof');
  await mkdir(proof);
  await cp(join(root, 'packages/db/migrations'), join(path, 'migrations'), { recursive: true });
  await writeFile(join(proof, 'migrate.mjs'), `import {openDatabase} from '@artifacts/db';
import {migrate} from 'drizzle-orm/libsql/migrator';
import {fileURLToPath} from 'node:url';
export async function migrateDatabase(url) {
 const connection=await openDatabase({url});
 try {await migrate(connection.db,{migrationsFolder:fileURLToPath(new URL('../migrations',import.meta.url))});}
 finally {connection.client.close();}
}
`);
  const modules = new Map([
    ['packages/db/src/index.ts', '@artifacts/db'],
    ['packages/db/src/schema.ts', '@artifacts/db/schema'],
    ['packages/db/src/migrate.ts', './migrate.mjs'],
    ['packages/artifacts/src/index.ts', '@artifacts/artifacts'],
    ['packages/rest/src/index.ts', '@artifacts/rest'],
    ['packages/config/src/email-node.ts', '@artifacts/config/email-node'],
    ['packages/config/src/email-sender-node.ts', '@artifacts/config/email-sender'],
  ].map(([source, name]) => [resolve(root, source!), name!]));
  await build({ entryPoints: [join(root, 'tests/invitation-concurrency.test.ts'), join(root, 'tests/invitation-process.ts')], outdir: proof, outExtension: { '.js': '.mjs' }, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'es2024', plugins: [{ name: 'installed-server-packages', setup(builder) {
    builder.onResolve({ filter: /^\./ }, (args) => {
      const name = modules.get(resolve(args.resolveDir, args.path));
      return name ? { path: name, external: true } : undefined;
    });
  } }] });
}
function dependencies(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !('dependencies' in value) || !value.dependencies || typeof value.dependencies !== 'object') return [];
  return Object.entries(value.dependencies).flatMap(([name, child]) => [name, ...dependencies(child)]);
}
try {
  const token = await grant(app, 'openid profile offline_access artifacts:read artifacts:write artifacts:publish');
  const clientDirectory = await mkdtemp(join(directory, 'client-'));
  await install(clientDirectory, ['contracts', 'client']);
  const graph = dependencies(JSON.parse(await run('npm', ['ls', '--json', '--all'], clientDirectory)));
  assert.equal(graph.some((name) => /libsql|drizzle|@artifacts\/(db|artifacts|rest)$|@yargote\/artifacts-cli$|^tsx$/.test(name)), false, 'Client-only installation contains no database, server, CLI, or tsx dependency');
  await writeFile(join(clientDirectory, 'consumer.mjs'), `import assert from 'node:assert/strict';
import { createArtifactHttpClient, HttpError } from '@yargote/artifacts-client';
const client = createArtifactHttpClient({resource:process.env.ARTIFACTS_SERVER, accessToken:process.env.ARTIFACTS_ACCESS_TOKEN});
assert.equal((await client.identity()).userId, process.env.EXPECTED_OWNER);
const snapshot = { metadata: { title: 'Packed client artifact', description: 'Ordinary Node runtime' }, content: { kind: 'text', text: 'Packed client content' }, files: [] };
const created = await client.create({requestId:'packed-client-create', snapshot});
assert.equal(created.revision.snapshot.content.text, 'Packed client content');
const updated = await client.update({requestId:'packed-client-update',artifactId:created.artifactId,expectedRevisionId:created.headRevisionId,snapshot});
assert.equal(updated.revision.sequence, 2);
await assert.rejects(client.update({requestId:'packed-client-conflict',artifactId:created.artifactId,expectedRevisionId:created.headRevisionId,snapshot}), error => error instanceof HttpError && error.status === 409 && error.code === 'conflict');
console.log('Packed client runtime and real HTTP conflict passed');
`);
  const env = { ARTIFACTS_SERVER: app.config.resource, ARTIFACTS_ACCESS_TOKEN: token.access_token, EXPECTED_OWNER: app.ownerId };
  console.log((await run(process.execPath, ['consumer.mjs'], clientDirectory, env)).trim());
  await writeFile(join(clientDirectory, 'consumer.ts'), `import { createArtifactHttpClient, type ArtifactRead, type CompactArtifactRead } from '@yargote/artifacts-client';
const client = createArtifactHttpClient({ resource: 'https://example.test/mcp', accessToken: 'token' });
const full: ArtifactRead = await client.read({artifactId:'id'});
const compact: CompactArtifactRead = await client.read({artifactId:'id',response:'compact'});
console.log(full.revision.snapshot.content.text, compact.revision.content.utf8Bytes);
`);
  await run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2024', 'consumer.ts'], clientDirectory);
  const serverDirectory = await mkdtemp(join(directory, 'server-'));
  await install(serverDirectory, ['contracts', 'config', 'db', 'artifacts', 'rest', 'client', 'cli']);
  const serverGraph = dependencies(JSON.parse(await run('npm', ['ls', '--json', '--all'], serverDirectory)));
  assert.equal(serverGraph.includes('tsx'), false);
  const configFile = join(serverDirectory, 'fixture.json');
  await writeFile(configFile, JSON.stringify({ ...app.mcpOptions, databaseUrl: app.databaseUrl, owner: app.ownerId, token: token.access_token, sink: join(serverDirectory, 'invitations.jsonl'), native: inventory.profile, sdkFiles: JSON.parse(await readFile(join(root, 'native/libsql/sdk-files.json'), 'utf8')) }), { mode: 0o600 });
  await writeFile(join(serverDirectory, 'server.mjs'), `import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileEmailSender } from '@artifacts/config/email-node';
import { openDatabase } from '@artifacts/db';
import { createArtifactStore, ArtifactError as StoreError } from '@artifacts/artifacts';
import { ArtifactError } from '@yargote/artifacts-contracts';
import { createArtifactRestApp } from '@artifacts/rest';
assert.equal(StoreError, ArtifactError);
const config = JSON.parse(await readFile('fixture.json','utf8'));
const connection = await openDatabase({url:config.databaseUrl});
const app = createArtifactRestApp(config,createArtifactStore(connection.db,{ access: { ownerEmail: 'owner@example.test', allowGuests: false },publishOrigin:'https://published.example.test',sendInvitation:fileEmailSender(config.sink)}));
async function command(path,method,body){return app(new Request(config.resource+'/v1'+path,{method,headers:{authorization:'Bearer '+config.token,'content-type':'application/json'},body:JSON.stringify(body)}));}
try {
const snapshot={metadata:{title:'Packed store and REST',description:'Shared runtime'},content:{kind:'text',text:'Packed store bytes'},files:[]};
const createdResponse=await command('/artifacts','POST',{requestId:'packed-store-create',snapshot});
assert.equal(createdResponse.status,201);
const created=await createdResponse.json();
assert.equal(created.ownerId,config.owner);
assert.equal((await command('/artifacts/'+created.artifactId,'PUT',{requestId:'packed-store-update',artifactId:created.artifactId,expectedRevisionId:created.headRevisionId,snapshot})).status,200);
const conflict=await command('/artifacts/'+created.artifactId,'PUT',{requestId:'packed-store-stale',artifactId:created.artifactId,expectedRevisionId:created.headRevisionId,snapshot});
assert.equal(conflict.status,409);
assert.equal((await conflict.json()).error.code,'conflict');
const commandBody={requestId:'installed-store-notify',email:'installed-server@example.test',notify:true};
const notifiedResponse=await command('/artifacts/'+created.artifactId+'/shares','POST',commandBody);
assert.equal(notifiedResponse.status,201);
const notified=await notifiedResponse.json();
assert.deepEqual(notified.notification,{status:'requested'});
const replay=await command('/artifacts/'+created.artifactId+'/shares','POST',commandBody);
assert.equal(replay.status,201);
assert.deepEqual(await replay.json(),notified);
assert.equal((await connection.client.execute('SELECT used FROM artifact_invitation_budget WHERE owner_id=?',[config.owner])).rows[0].used,1);
const receipt=(await connection.client.execute('SELECT result FROM artifact_command WHERE owner_id=? AND request_id=?',[config.owner,commandBody.requestId])).rows[0];
assert.deepEqual(JSON.parse(receipt.result),notified);
const messages=(await readFile(config.sink,'utf8')).trim().split('\\n').map(line=>JSON.parse(line));
assert.equal(messages.length,1);assert.equal(messages[0].to,commandBody.email);
const require=createRequire(import.meta.url);
const databaseRequire=createRequire(require.resolve('@artifacts/db'));
const sdkPath=await realpath(databaseRequire.resolve('@libsql/client'));
const nativePath=await realpath(createRequire(sdkPath).resolve('libsql'));
const nativeRoot=dirname(nativePath);
if(config.native){
 const sdkRoot=dirname(dirname(sdkPath));
 for(const [path,hash] of Object.entries(config.sdkFiles))assert.equal(createHash('sha256').update(await readFile(join(sdkRoot,path))).digest('hex'),hash);
 assert.equal(createHash('sha256').update(await readFile(join(nativeRoot,'index.node'))).digest('hex'),config.native.binarySha256);
 assert.ok(nativePath.includes('/node_modules/@artifacts/db/node_modules/libsql/'));
}
console.log(JSON.stringify({profile:config.native?.kind??'portable',sdkPath,nativePath,binarySha256:config.native?.binarySha256,notify:'requested',receipts:1,sinkMessages:messages.length,replay:'identical'}));
console.log('Packed store and REST preserve ArtifactError identity, real notify, quota, immutable receipt and no resend');
} finally { connection.client.close(); }
`);
  console.log((await run(process.execPath, ['server.mjs'], serverDirectory)).trim());
  if (inventory.profile) {
    const databaseRequire = createRequire(createRequire(join(serverDirectory, 'package.json')).resolve('@artifacts/db'));
    const sdkRoot = dirname(dirname(databaseRequire.resolve('@libsql/client')));
    const esm = pathToFileURL(join(sdkRoot, 'lib-esm/node.js')).href;
    const controls: string[] = [];
    for (const name of ['libsql-control', 'libsql-read']) {
      const source = (await readFile(join(root, `tests/${name}.test.ts`), 'utf8'))
        .replace('createRequire(import.meta.url)', `createRequire(${JSON.stringify(join(sdkRoot, 'package.json'))})`)
        .replace("await import('@libsql/client')", `await import(${JSON.stringify(esm)})`)
        .replace("import.meta.resolve('@libsql/client')", JSON.stringify(esm));
      const output = `${name}.test.mjs`;
      await writeFile(join(serverDirectory, output), (await transform(source, { loader: 'ts', format: 'esm', target: 'es2024' })).code);
      controls.push(output);
    }
    console.log((await run(process.execPath, ['--test', ...controls], serverDirectory)).trim());
    const original = await mkdtemp(join(directory, 'original-sdk-'));
    await writeFile(join(original, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { '@libsql/client': '0.18.0' } }));
    await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], original);
    console.log((await run(process.execPath, [join(root, 'tests/libsql-encryption.proof.mjs'), join(sdkRoot, 'package.json'), join(original, 'node_modules/@libsql/client/package.json')], serverDirectory)).trim());
    await prepareInstalledApi(serverDirectory);
    console.log('Installed native-fixed auth and REST API gates');
    console.log((await run(process.execPath, ['--test', 'proof/invitation-concurrency.test.mjs'], serverDirectory)).trim());
    const portable = await readInventory(join(portableOutput, 'manifest.json'));
    assert.equal(portable.profile, undefined);
    const originalServer = await mkdtemp(join(directory, 'portable-server-'));
    await install(originalServer, ['contracts', 'config', 'db', 'artifacts', 'rest', 'client', 'cli'], portable, portableOutput);
    await prepareInstalledApi(originalServer);
    let rejected = '';
    try { await run(process.execPath, ['--test', '--test-name-pattern=real auth failure', 'proof/invitation-concurrency.test.mjs'], originalServer); }
    catch (error) { rejected = error instanceof Error ? error.message : String(error); }
    assert.match(rejected, /precommand_zero_effects/, 'The original graph must reach the real auth failure');
    assert.match(rejected, /exclusive_holder_released/, 'The original graph must release its holder before the recovery check');
    assert.match(rejected, /commit_failed/, 'The original native graph must fail the actual recovery commit');
    assert.match(rejected, /fail 1/, 'Replacing only the delivered native graph must kill the recovery check');
    console.log('Original portable native graph kills the installed auth recovery check. This is an inherited ISSUES observation.');
    console.log(rejected);

  }

  await writeFile(join(serverDirectory, 'server.ts'), `import { openDatabase } from '@artifacts/db';
import { createArtifactStore, type ArtifactStore } from '@artifacts/artifacts';
import { prepareArtifactEdit } from '@artifacts/artifacts/workflow';
import { createArtifactRestApp } from '@artifacts/rest';
const {db} = await openDatabase({url:'file:example.db'});
const store: ArtifactStore = createArtifactStore(db,{ access: { ownerEmail: 'owner@example.test', allowGuests: false },publishOrigin:'https://published.example.test'});
const app: (request: Request) => Promise<Response> = createArtifactRestApp({issuer:'https://auth.example/api/auth',resource:'https://example.test/mcp',clientId:'resource',clientSecret:'secret'},store);
console.log(app, prepareArtifactEdit);
`);
  await run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2024', 'server.ts'], serverDirectory);
  const binary = join(serverDirectory, 'node_modules/.bin/artifacts');
  assert.equal((await run(binary, ['--version'], serverDirectory)).trim(), inventory.packages.find((item) => item.name === '@yargote/artifacts-cli')!.version);
  assert.ok((await run(binary, ['--help'], serverDirectory)).startsWith('Usage: artifacts COMMAND [OPTIONS]'));
  const whoami = JSON.parse(await run(binary, ['whoami'], serverDirectory, { ...env, ARTIFACTS_STATE_DIR: join(directory, 'state') }));
  assert.equal(whoami.userId, app.ownerId);
  const snapshotFile = join(serverDirectory, 'snapshot.json');
  await writeFile(snapshotFile, JSON.stringify({ metadata: { title: 'Installed binary artifact', description: '' }, content: { kind: 'text', text: 'Installed CLI content' }, files: [] }));
  const created = JSON.parse(await run(binary, ['create', '--snapshot', snapshotFile, '--request-id', 'installed-cli-create'], serverDirectory, { ...env, ARTIFACTS_STATE_DIR: join(directory, 'state') }));
  assert.equal(created.revision.snapshot.content.text, 'Installed CLI content');
  const cliEnvironment = { ...env, ARTIFACTS_STATE_DIR: join(directory, 'state') };
  const operationPath = (requestId: string) => join(cliEnvironment.ARTIFACTS_STATE_DIR, 'operations', `${createHash('sha256').update(JSON.stringify([app.config.resource, requestId])).digest('hex')}.json`);
  app.dropNextResourceResponse('POST');
  await assert.rejects(run(binary, ['share', created.artifactId, '--email', 'packed@example.test', '--notify', '--request-id', 'installed-cli-notify'], serverDirectory, cliEnvironment), /network_error/);
  const captured = JSON.parse(await readFile(operationPath('installed-cli-notify'), 'utf8'));
  assert.deepEqual(captured.command, { requestId: 'installed-cli-notify', artifactId: created.artifactId, email: 'packed@example.test', notify: true });
  const notified = JSON.parse(await run(binary, ['retry', 'installed-cli-notify'], serverDirectory, cliEnvironment));
  assert.deepEqual(notified.notification, { status: 'requested' });
  assert.deepEqual(JSON.parse(await run(binary, ['retry', 'installed-cli-notify'], serverDirectory, cliEnvironment)), notified);
  const legacy = { version: 1, resource: app.config.resource, ownerId: app.ownerId, kind: 'share', command: { requestId: 'installed-legacy-share', artifactId: created.artifactId, email: 'legacy-packed@example.test' } };
  await writeFile(operationPath(legacy.command.requestId), JSON.stringify(legacy), { mode: 0o600 });
  const plain = JSON.parse(await run(binary, ['retry', legacy.command.requestId], serverDirectory, cliEnvironment));
  assert.deepEqual(Object.keys(plain).sort(), ['artifactId', 'createdAt', 'kind', 'shareId', 'value']);
  assert.equal(plain.value, legacy.command.email);
  const messages = (await readFile(app.emailSink!, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, captured.command.email);
  console.log('Installed CLI retains notify through a lost response and replays a literal pre-S10 operation without adding notify');
  console.log('Installed artifacts bin runs with ordinary Node, compiled ESM and declarations; client dependency graph is database-free');
} finally {
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
