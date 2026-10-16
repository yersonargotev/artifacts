import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixture, grant } from './helpers.ts';
import { readInventory, packageOutput } from '../scripts/package-catalog.ts';
const inventory = await readInventory();

const root = process.cwd();
const directory = await mkdtemp(join(tmpdir(), 'artifacts-packed-consumer-'));
const app = await fixture({ transport: 'rest' });
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
async function install(path: string, names: string[]) {
  await writeFile(join(path, 'package.json'), JSON.stringify({ name: 'ordinary-node-consumer', private: true, type: 'module', dependencies: Object.fromEntries(names.map((name) => {
    const packed = inventory.packages.find((item) => item.directory.endsWith(`/${name}`));
    assert.ok(packed, `Package ${name} exists in inventory`);
    return [packed.name, `file:${resolve(packageOutput, packed.tarball)}`];
  })) }));
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], path);
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
  await writeFile(configFile, JSON.stringify({ ...app.mcpOptions, databaseUrl: app.databaseUrl, owner: app.ownerId, token: token.access_token }), { mode: 0o600 });
  await writeFile(join(serverDirectory, 'server.mjs'), `import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openDatabase } from '@artifacts/db';
import { createArtifactStore, ArtifactError as StoreError } from '@artifacts/artifacts';
import { ArtifactError } from '@yargote/artifacts-contracts';
import { createArtifactRestApp } from '@artifacts/rest';
assert.equal(StoreError, ArtifactError);
const config = JSON.parse(await readFile('fixture.json','utf8'));
const connection = await openDatabase({url:config.databaseUrl});
const app = createArtifactRestApp(config,createArtifactStore(connection.db,{publishOrigin:'https://published.example.test'}));
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
console.log('Packed store and REST share ArtifactError and map a real conflict to 409');
} finally { connection.client.close(); }
`);
  console.log((await run(process.execPath, ['server.mjs'], serverDirectory)).trim());
  await writeFile(join(serverDirectory, 'server.ts'), `import { openDatabase } from '@artifacts/db';
import { createArtifactStore, type ArtifactStore } from '@artifacts/artifacts';
import { prepareArtifactEdit } from '@artifacts/artifacts/workflow';
import { createArtifactRestApp } from '@artifacts/rest';
const {db} = await openDatabase({url:'file:example.db'});
const store: ArtifactStore = createArtifactStore(db,{publishOrigin:'https://published.example.test'});
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
  console.log('Installed artifacts bin runs with ordinary Node, compiled ESM and declarations; client dependency graph is database-free');
} finally {
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
