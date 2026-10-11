import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { artifactReadSchema, publishResultSchema, revisionSchema } from '../packages/artifacts/src/contracts.ts';

type Call = { tool: string; input: Record<string, unknown>; result: Record<string, unknown> };
type Evidence = { artifactId: string; firstRevisionId: string; publicationUrl: string; calls: Call[] };
const phase = process.argv[2];
assert(phase === 'create' || phase === 'modify', 'Choose create or modify');
const server = process.env.ARTIFACTS_MCP_NAME ?? 'artifacts-cloud';
const url = process.env.MCP_URL;
assert(url, 'MCP_URL is required; authenticate both CLI registrations before running');
const directory = resolve(process.env.ARTIFACTS_PROOF_DIR ?? '.test-artifacts/artifact-e2e');
await mkdir(directory, { recursive: true, mode: 0o700 });
const runId = process.env.ARTIFACTS_PROOF_RUN ?? 'first-deployed-artifact';

function records(log: string): Record<string, any>[] {
  return log.split('\n').flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function calls(log: string, client: 'claude' | 'codex'): Call[] {
  const events = records(log);
  if (client === 'codex') return events.flatMap((event) => {
    const item = event.item;
    if (event.type !== 'item.completed' || item?.type !== 'mcp_tool_call' || item.server !== server) return [];
    assert.equal(item.status, 'completed', `Codex ${item.tool} completed`);
    assert(!item.error, `Codex ${item.tool} has no transport error`);
    assert(!item.result?.isError && !item.result?.is_error, `Codex ${item.tool} has no tool error`);
    const result = item.result?.structured_content ?? item.result?.structuredContent;
    assert(result, `Codex ${item.tool} returned structured content`);
    return [{ tool: item.tool, input: item.arguments, result }];
  });
  const pending = new Map<string, { tool: string; input: Record<string, unknown> }>();
  const completed: Call[] = [];
  for (const event of events) {
    for (const block of event.message?.content ?? []) {
      if (block.type === 'tool_use' && block.name.startsWith(`mcp__${server}__`)) pending.set(block.id, { tool: block.name.slice(`mcp__${server}__`.length), input: block.input });
      if (block.type !== 'tool_result') continue;
      const call = pending.get(block.tool_use_id);
      if (!call) continue;
      assert(!block.is_error, `Claude ${call.tool} has no tool error`);
      const result = event.tool_use_result?.structuredContent;
      assert(result, `Claude ${call.tool} returned structured content`);
      completed.push({ ...call, result });
    }
  }
  return completed;
}

async function run(client: 'claude' | 'codex', prompt: string): Promise<Call[]> {
  const config = JSON.stringify({ mcpServers: { [server]: { type: 'http', url } } });
  const args = client === 'claude'
    ? ['--print', '--verbose', '--output-format', 'stream-json', '--no-session-persistence', '--strict-mcp-config', '--mcp-config', config, '--tools', '', '--allowedTools', `mcp__${server}__*`, '--disable-slash-commands', prompt]
    : ['exec', '--ephemeral', '--json', '--sandbox', 'read-only', '--ignore-user-config', '--skip-git-repo-check', '-c', `mcp_servers.${server}.url=${JSON.stringify(url)}`, '-c', 'approval_policy="never"', prompt];
  const cliEnvironment = { ...process.env };
  for (const name of Object.keys(cliEnvironment)) {
    if (/^(DATABASE_|OWNER_|BETTER_AUTH_SECRET$|PANEL_|MCP_|AUTH_|DASHBOARD_|PUBLISH_|PUBLICATION_|ARTIFACTS_)/.test(name)) delete cliEnvironment[name];
  }
  const child = spawn(client, args, { cwd: directory, env: cliEnvironment, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  const code = await new Promise<number | null>((done, reject) => {
    child.once('error', reject);
    child.once('exit', done);
  });
  await writeFile(resolve(directory, `${client}.jsonl`), stdout, { mode: 0o600 });
  await writeFile(resolve(directory, `${client}.stderr`), stderr, { mode: 0o600 });
  assert.equal(code, 0, `${client} exits successfully; inspect private evidence on failure`);
  return calls(stdout, client);
}

if (phase === 'create') {
  const snapshot = {
    metadata: { title: 'First artifact: Claude × Codex', description: 'A live proof of shared authorship, immutable revisions, and protected publication.', custom: { acceptanceRun: runId, creator: 'Claude', version: 1 } },
    content: { kind: 'html', text: '<!doctype html><html lang="en"><meta charset="utf-8"><title>First artifact</title><style>body{font:18px system-ui;margin:0;background:#121e22;color:#f2f0e6}main{max-width:720px;margin:10vh auto;padding:32px}small{color:#c5db75}h1{font-size:clamp(36px,7vw,64px);line-height:1.05}button{background:#c5db75;color:#121e22;padding:12px 20px;border:0;border-radius:8px;font:inherit}</style><main><small>ARTIFACTS / FIRST PUBLICATION</small><h1>Created by Claude</h1><p id="version">Revision 1 · Created by Claude</p><p>One artifact. Every revision preserved. One protected URL.</p><button onclick="this.textContent=\'Interaction verified\'">Try the artifact</button></main></html>' },
    files: [{ path: 'notes.txt', mediaType: 'text/plain', encoding: 'utf8', data: 'Revision 1 attachment created by Claude. Preserve this file in revision 2.\n' }],
  };
  const results = await run('claude', `Use only the ${server} MCP. Actually invoke artifacts_create with requestId ${runId}-create and this exact snapshot: ${JSON.stringify(snapshot)}. Then invoke artifacts_publish using its returned artifactId and revision.id, expectedPublicationVersion 0, requestId ${runId}-publish-1. Invoke artifacts_read to verify it. Do not use other tools, simulate results, or merely describe a plan. Report the stable URL.`);
  const created = results.find((call) => call.tool === 'artifacts_create');
  const published = results.find((call) => call.tool === 'artifacts_publish');
  assert(created && published, 'Actual Claude create and publish tool results exist');
  const artifact = artifactReadSchema.parse(created.result);
  const publication = publishResultSchema.parse(published.result);
  assert.deepEqual(artifact.revision.snapshot, snapshot);
  assert.equal(publication.artifactId, artifact.artifactId);
  assert.equal(publication.revisionId, artifact.revision.id);
  assert.equal(publication.version, 1);
  const evidence: Evidence = { artifactId: artifact.artifactId, firstRevisionId: artifact.revision.id, publicationUrl: publication.url, calls: results };
  await writeFile(resolve(directory, 'created.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ client: 'Claude', artifactId: evidence.artifactId, publicationUrl: evidence.publicationUrl, revision: 1 }));
} else {
  const first: Evidence = JSON.parse(await readFile(resolve(directory, 'created.json'), 'utf8'));
  const results = await run('codex', `Use only the ${server} MCP. Actually read artifact ${first.artifactId} via artifacts_read. Invoke artifacts_update with expectedRevisionId ${first.firstRevisionId} and requestId ${runId}-update. Keep its complete metadata and files, change metadata.custom.version to 2 and add metadata.custom.editor "Codex", replace the heading Created by Claude with Created by Claude · Edited by Codex, and replace the text Revision 1 · Created by Claude with Revision 2 · Edited by Codex. Publish the returned revision.id via artifacts_publish with expectedPublicationVersion 1 and requestId ${runId}-publish-2. Then call artifacts_history and artifacts_export for original revision ${first.firstRevisionId}. Do not use shell, modify repository files, simulate tools, or stop at a plan. Report the same stable URL.`);
  const updated = results.find((call) => call.tool === 'artifacts_update');
  const published = results.find((call) => call.tool === 'artifacts_publish');
  const exported = results.find((call) => call.tool === 'artifacts_export');
  const history = results.find((call) => call.tool === 'artifacts_history');
  assert(updated && published && exported && history, 'Actual Codex update, publish, history, and historical export results exist');
  const artifact = artifactReadSchema.parse(updated.result);
  const publication = publishResultSchema.parse(published.result);
  assert.equal(artifact.artifactId, first.artifactId);
  assert.equal(artifact.revision.sequence, 2);
  assert.equal(artifact.revision.parentRevisionId, first.firstRevisionId);
  assert.equal(publication.url, first.publicationUrl);
  assert.equal(publication.artifactId, first.artifactId);
  assert.equal(publication.revisionId, artifact.revision.id);
  assert.equal(publication.version, 2);
  assert.match(artifact.revision.snapshot.content.text, /Revision 2 · Edited by Codex/);
  const created = first.calls.find((call) => call.tool === 'artifacts_create')!;
  const original = artifactReadSchema.parse(created.result);
  assert.deepEqual(artifact.revision.snapshot.files, original.revision.snapshot.files);
  assert(Array.isArray(history.result.items));
  const revisions = history.result.items.map((item: unknown) => revisionSchema.parse(item));
  assert.deepEqual(revisions.map((item) => item.id), [artifact.revision.id, first.firstRevisionId]);
  assert.deepEqual(revisions[1]!.snapshot, original.revision.snapshot);
  assert.equal(exported.result.mediaType, 'application/zip');
  assert.equal(typeof exported.result.base64, 'string');
  const archive = Buffer.from(exported.result.base64 as string, 'base64');
  assert.equal(createHash('sha256').update(archive).digest('hex'), exported.result.sha256);
  const files = unzipSync(archive);
  assert.deepEqual(Object.keys(files), ['artifact.json', 'content.html', 'files/notes.txt']);
  assert.equal(strFromU8(files['content.html']!), original.revision.snapshot.content.text);
  assert.equal(strFromU8(files['files/notes.txt']!), original.revision.snapshot.files[0]!.data);
  const manifest = JSON.parse(strFromU8(files['artifact.json']!));
  assert.equal(manifest.artifactId, first.artifactId);
  assert.equal(manifest.revision.id, first.firstRevisionId);
  assert.deepEqual(manifest.metadata, original.revision.snapshot.metadata);
  await writeFile(resolve(directory, 'modified.json'), JSON.stringify({ ...first, secondRevisionId: artifact.revision.id, calls: results }, null, 2), { mode: 0o600 });
  await writeFile(resolve(directory, 'revision-1.zip'), archive, { mode: 0o600 });
  console.log(JSON.stringify({ client: 'Codex', artifactId: first.artifactId, publicationUrl: first.publicationUrl, revision: 2, historicalExport: true }));
}
