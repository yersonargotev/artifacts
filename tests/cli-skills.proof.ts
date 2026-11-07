import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { snapshotSchema } from '../packages/contracts/src/index.ts';
import { inspectTarball, packageOutput, readInventory, root } from '../scripts/package-catalog.ts';

const inventory = await readInventory();
const directory = await realpath(await mkdtemp(join(tmpdir(), 'artifacts-skills-package-')));
const consumer = join(directory, 'consumer');
const home = join(directory, 'home');
const cwd = join(directory, 'workspace');
const guard = join(directory, 'offline.cjs');
const environment = {
  PATH: process.env.PATH,
  HOME: home,
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_STATE_HOME: join(home, '.local/state'),
  XDG_CACHE_HOME: join(home, '.cache'),
  ARTIFACTS_STATE_DIR: join(home, 'cli-state'),
  NODE_OPTIONS: `--require=${guard}`,
};

async function run(command: string, args: string[], workingDirectory = cwd, env: NodeJS.ProcessEnv = environment) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: workingDirectory, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

const binary = join(consumer, 'node_modules/.bin/artifacts');
async function cli(args: string[], workingDirectory = cwd): Promise<string> {
  const result = await run(binary, args, workingDirectory);
  assert.equal(result.code, 0, `${args.join(' ')}\n${result.stderr}`);
  return result.stdout;
}

async function failure(args: string[], pattern: RegExp) {
  const result = await run(binary, args);
  assert.equal(result.code, 1, args.join(' '));
  assert.equal(result.stdout, '', args.join(' '));
  const errorLine = result.stderr.trim().split('\n').findLast((line) => line.startsWith('{"error":'));
  assert.ok(errorLine, result.stderr);
  const error = JSON.parse(errorLine).error;
  assert.equal(error.code, 'invalid_arguments', result.stderr);
  assert.match(error.message, pattern, args.join(' '));
}

async function files(path: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const relative = `${prefix}${entry.name}`;
    return entry.isDirectory() ? files(join(path, entry.name), `${relative}/`) : [relative];
  }));
  return nested.flat().sort();
}

try {
  for (const path of [consumer, home, cwd]) await mkdir(path);
  await writeFile(guard, `const deny = () => { throw new Error('Offline skills command attempted network access'); };
for (const [module, methods] of Object.entries({net:['connect','createConnection'],tls:['connect'],http:['request','get'],https:['request','get'],dgram:['createSocket'],dns:['lookup','resolve']})) {
  for (const method of methods) require('node:'+module)[method] = deny;
}
require('node:net').Socket.prototype.connect = deny;
globalThis.fetch = deny;
require('node:module').syncBuiltinESMExports();
`);
  const playwrightVersion = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).devDependencies.playwright;
  const dependencies = { ...Object.fromEntries(inventory.packages.filter((item) => item.public).map((item) => [item.name, `file:${resolve(packageOutput, item.tarball)}`])), 'playwright-core': playwrightVersion };
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, dependencies }));
  const installation = await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer, {
    PATH: process.env.PATH, HOME: home, npm_config_cache: join(directory, 'npm-cache'),
    npm_config_userconfig: join(directory, 'npmrc'), npm_config_globalconfig: join(directory, 'global-npmrc'),
  });
  assert.equal(installation.code, 0, installation.stderr);

  const source = join(root, 'skills/artifacts-cli');
  const skill = await readFile(join(source, 'SKILL.md'), 'utf8');
  const description = 'Create, revise, inspect, publish, and export retained Artifacts through the artifacts CLI and REST API. Use when the user chooses the CLI or a terminal workflow for Artifacts. Exclude generic build artifacts and unrelated local files.';
  const designSource = join(root, 'skills/artifacts-design');
  const designDescription = /^description: (.+)$/m.exec(await readFile(join(designSource, 'SKILL.md'), 'utf8'))![1];
  const listed = await cli(['skills']);
  assert.equal(listed, `artifacts-cli\t${description}\nartifacts-design\t${designDescription}\n`);
  assert.equal(await cli(['skills', 'list']), listed);
  assert.equal(await cli(['skills', 'get', 'artifacts-cli']), skill);

  const packed = inventory.packages.find((item) => item.name === '@yargote/artifacts-cli')!;
  const archive = await inspectTarball(resolve(packageOutput, packed.tarball));
  const sourceFiles = await files(source);
  const designFiles = await files(designSource);
  assert.deepEqual(archive.files.filter((item) => item.path.startsWith('skills/')).map((item) => item.path).sort(), [...sourceFiles.map((path) => `skills/artifacts-cli/${path}`), ...designFiles.map((path) => `skills/artifacts-design/${path}`)].sort());
  for (const [name, directoryPath, paths] of [['artifacts-cli', source, sourceFiles], ['artifacts-design', designSource, designFiles]] as const) {
    for (const path of paths) {
      assert.deepEqual(archive.files.find((item) => item.path === `skills/${name}/${path}`)!.bytes, await readFile(join(directoryPath, path)));
    }
  }

  const all = await cli(['skills', 'get', '--all']);
  assert.match(all, /artifacts-cli\/SKILL\.md/);
  assert.ok(all.includes(skill));
  const full = await cli(['skills', 'get', 'artifacts-cli', '--full']);
  const designFull = await cli(['skills', 'get', 'artifacts-design', '--full']);
  assert.ok(designFull.includes('=== artifacts-design/references/canvas.md ===\n'), 'Installed design skill exposes the canvas authoring guide');
  assert.equal(await cli(['skills', 'get', '--all', '--full']), full + designFull);
  for (const path of designFiles) {
    const bytes = await readFile(join(designSource, path));
    if (path.endsWith('.woff2')) {
      assert.ok(designFull.includes(`=== artifacts-design/${path} (binary, ${bytes.length} bytes) ===\n`), `Full output labels binary ${path}`);
      assert.equal(designFull.includes(bytes.subarray(0, 64).toString('latin1')), false, `Full output omits the bytes of ${path}`);
    } else {
      assert.ok(designFull.includes(`=== artifacts-design/${path} ===\n${bytes.toString('utf8')}`), `Full output preserves ${path}`);
    }
  }
  for (const path of sourceFiles) {
    assert.ok(full.includes(`=== artifacts-cli/${path} ===\n`), `Full output labels ${path}`);
    assert.ok(full.includes(await readFile(join(source, path), 'utf8')), `Full output preserves ${path}`);
  }
  const catalog = (await cli(['skills', 'path'])).trim();
  const bundled = (await cli(['skills', 'path', 'artifacts-cli'])).trim();
  assert.equal(isAbsolute(catalog), true);
  assert.equal(catalog, join(consumer, 'node_modules/@yargote/artifacts-cli/skills'));
  assert.equal(bundled, join(catalog, 'artifacts-cli'));
  assert.equal(await readFile(join(bundled, 'SKILL.md'), 'utf8'), skill);
  assert.deepEqual(await files(bundled), sourceFiles);
  for (const path of sourceFiles.filter((path) => path.endsWith('.md'))) {
    const text = await readFile(join(bundled, path), 'utf8');
    for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(?:[a-z]+:|#)/i.test(target)) continue;
      const destination = resolve(dirname(join(bundled, path)), target.split('#')[0]!);
      assert.equal(relative(bundled, destination).startsWith('..'), false, `Installed reference stays within its bundled skill: ${target}`);
      assert.equal((await stat(destination)).isFile(), true, `Installed reference resolves: ${target}`);
    }
  }
  const handoffSnapshot = { metadata: { title: 'Installed retained handoff', description: 'Independent complete read' }, content: { kind: 'text', text: 'Exact selected revision.' }, files: [] };
  const canonical = JSON.stringify(handoffSnapshot, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
  const handoffRead = { artifactId: 'installed-artifact', ownerId: 'installed-owner', headRevisionId: 'newer-head', project: null, slug: null, publication: { revisionId: 'selected-revision', version: 2, url: 'https://viewer.example.test/a/installed-artifact' }, revision: { id: 'selected-revision', parentRevisionId: null, sequence: 1, authorUserId: 'installed-owner', authorClientId: 'installed-cli', createdAt: '2026-10-28T12:00:00.000Z', sha256: createHash('sha256').update(canonical).digest('hex'), snapshot: handoffSnapshot } };
  const handoffInputs = { receipt: { artifactId: handoffRead.artifactId, revision: { id: handoffRead.revision.id, sha256: handoffRead.revision.sha256 } }, read: handoffRead, publication: { artifactId: handoffRead.artifactId, ...handoffRead.publication }, checks: { viewports: [{ width: 390, height: 844 }], expectations: [] } };
  for (const [name, value] of Object.entries(handoffInputs)) await writeFile(join(cwd, `handoff-${name}.json`), JSON.stringify(value));
  const handoffOutput = join(cwd, 'retained-config.json');
  const handoffArgs = [join(bundled, 'scripts/prepare-retained.mjs'), '--receipt', join(cwd, 'handoff-receipt.json'), '--read', join(cwd, 'handoff-read.json'), '--publication-receipt', join(cwd, 'handoff-publication.json'), '--checks', join(cwd, 'handoff-checks.json'), '--panel-origin', 'https://panel.example.test', '--evidence', join(cwd, 'new-retained-evidence'), '--out', handoffOutput];
  const handoff = await run(process.execPath, handoffArgs);
  assert.equal(handoff.code, 0, handoff.stderr);
  assert.deepEqual(JSON.parse(handoff.stdout), { status: 'prepared', headChanged: true, publication: 'requested' });
  const handoffConfig = JSON.parse(await readFile(handoffOutput, 'utf8'));
  assert.deepEqual(handoffConfig.expected, handoffRead);
  assert.equal(handoffConfig.panelUrl, 'https://panel.example.test/artifacts/installed-artifact?revisionId=selected-revision');
  assert.equal(handoffConfig.publicationUrl, handoffRead.publication.url);
  assert.equal((await stat(handoffOutput)).mode & 0o777, 0o600);
  await assert.rejects(stat(join(cwd, 'new-retained-evidence')), { code: 'ENOENT' });
  assert.equal((await run(process.execPath, handoffArgs)).code, 1);
  assert.deepEqual(JSON.parse(await readFile(handoffOutput, 'utf8')), handoffConfig);

  const canvasDirectory = join(cwd, 'Product canvas');
  await mkdir(join(canvasDirectory, 'boards'), { recursive: true });
  const canvasIndex = { v: 1, boards: { 'boards/Desktop.html': { x: 0, y: 0, w: 1440, h: 900, page: 'overview' }, 'boards/Phone.html': { x: 1520, y: 0, w: 390, h: 844, page: 'detail' } }, order: ['boards/Phone.html', 'boards/Desktop.html'], pages: [{ id: 'overview', name: 'Overview' }, { id: 'detail', name: 'Detail' }] };
  const canvasText = `${JSON.stringify(canvasIndex, null, 2)}\n`;
  await writeFile(join(canvasDirectory, 'canvas.json'), canvasText);
  const desktopHtml = '<!doctype html><title>Desktop</title><h1>Desktop</h1>\n';
  const phoneHtml = '<!doctype html><title>Phone</title><h1>Phone</h1>\n';
  await writeFile(join(canvasDirectory, 'boards/Desktop.html'), desktopHtml);
  await writeFile(join(canvasDirectory, 'boards/Phone.html'), phoneHtml);
  const canvasArgs = [join(bundled, 'scripts/prepare-retained.mjs'), canvasDirectory];
  const preparedCanvas = await run(process.execPath, canvasArgs, home);
  assert.equal(preparedCanvas.code, 0, preparedCanvas.stderr);
  const canvasSnapshot = snapshotSchema.parse(JSON.parse(preparedCanvas.stdout));
  assert.deepEqual(canvasSnapshot, { metadata: { title: 'Product canvas', description: '' }, content: { kind: 'design', text: canvasText }, files: [{ path: 'boards/Desktop.html', mediaType: 'text/html', encoding: 'utf8', data: desktopHtml }, { path: 'boards/Phone.html', mediaType: 'text/html', encoding: 'utf8', data: phoneHtml }] });
  await writeFile(join(canvasDirectory, 'boards/Orphan.html'), '<p>Orphan</p>');
  const orphan = await run(process.execPath, canvasArgs);
  assert.equal(orphan.code, 1);
  assert.equal(orphan.stdout, '');
  assert.match(orphan.stderr, /boards\/Orphan\.html/);
  await rm(join(canvasDirectory, 'boards/Orphan.html'));
  await rm(join(canvasDirectory, 'boards/Phone.html'));
  const missing = await run(process.execPath, canvasArgs);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /boards\/Phone\.html/);
  await writeFile(join(canvasDirectory, 'boards/Phone.html'), phoneHtml);
  const invalidCanvases = [
    { ...canvasIndex, order: ['boards/Desktop.html', 'boards/Desktop.html'] },
    { ...canvasIndex, boards: { ...canvasIndex.boards, 'boards/Phone.html': { x: 1_000_001, y: 0, w: 390, h: 844 } } },
    { ...canvasIndex, pages: [{ id: '__proto__', name: 'Invalid' }] },
    { ...canvasIndex, notes: JSON.parse('{"__proto__":{"x":0,"y":0,"text":"Invalid"}}') },
    { ...canvasIndex, order: Array(33).fill('boards/Desktop.html') },
    { ...canvasIndex, extra: true },
  ];
  for (const index of invalidCanvases) {
    await writeFile(join(canvasDirectory, 'canvas.json'), JSON.stringify(index));
    const rejected = await run(process.execPath, canvasArgs);
    assert.equal(rejected.code, 1, JSON.stringify(index));
    assert.equal(rejected.stdout, '');
  }
  await writeFile(join(canvasDirectory, 'canvas.json'), canvasText);
  await writeFile(join(canvasDirectory, 'boards/Phone.html'), 'x'.repeat(1_048_576));
  const oversized = await run(process.execPath, canvasArgs);
  assert.equal(oversized.code, 1);
  assert.match(oversized.stderr, /1 MiB/);
  await rm(join(canvasDirectory, 'boards/Phone.html'));
  await symlink(join(canvasDirectory, 'boards/Desktop.html'), join(canvasDirectory, 'boards/Phone.html'));
  const linkedBoard = await run(process.execPath, canvasArgs);
  assert.equal(linkedBoard.code, 1);
  assert.match(linkedBoard.stderr, /regular file/);
  await rm(join(canvasDirectory, 'boards/Phone.html'));
  await writeFile(join(canvasDirectory, 'boards/Phone.html'), Buffer.from([0xc3, 0x28]));
  const invalidUtf8 = await run(process.execPath, canvasArgs);
  assert.equal(invalidUtf8.code, 1);
  assert.match(invalidUtf8.stderr, /UTF-8/);
  await writeFile(join(canvasDirectory, 'boards/Phone.html'), phoneHtml);
  const designCanonical = JSON.stringify(canvasSnapshot, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
  const designHandoffRead = { ...handoffRead, revision: { ...handoffRead.revision, sha256: createHash('sha256').update(designCanonical).digest('hex'), snapshot: canvasSnapshot } };
  await writeFile(join(cwd, 'handoff-receipt.json'), JSON.stringify({ artifactId: designHandoffRead.artifactId, revision: { id: designHandoffRead.revision.id, sha256: designHandoffRead.revision.sha256 } }));
  await writeFile(join(cwd, 'handoff-read.json'), JSON.stringify(designHandoffRead));
  const designHandoffOutput = join(cwd, 'design-retained-config.json');
  const designHandoffArgs = [...handoffArgs.slice(0, -1), designHandoffOutput];
  const designHandoff = await run(process.execPath, designHandoffArgs);
  assert.equal(designHandoff.code, 0, designHandoff.stderr);
  assert.deepEqual(JSON.parse(await readFile(designHandoffOutput, 'utf8')).expected, designHandoffRead);

  const designBundled = (await cli(['skills', 'path', 'artifacts-design'])).trim();
  const localHtml = join(consumer, 'local.html');
  const localSource = '<h1>Installed local verification</h1><button id="change">Change</button><output id="result">before</output><script>document.querySelector("#change").onclick=()=>document.querySelector("#result").textContent="after"</script>';
  await writeFile(localHtml, localSource);
  const localChecks = join(consumer, 'checks.json');
  await writeFile(localChecks, JSON.stringify({ expectations: [{ kind: 'click', selector: '#change' }, { kind: 'text', selector: '#result', text: 'after' }] }));
  const localRun = await run(process.execPath, [join(designBundled, 'scripts/verify-local.mjs'), localHtml, '--evidence', join(consumer, 'evidence'), '--expectations', localChecks], consumer, {
    PATH: process.env.PATH, HOME: process.env.HOME, ARTIFACTS_STATE_DIR: join(home, 'cli-state'),
  });
  assert.equal(localRun.code, 0, localRun.stderr + localRun.stdout);
  const localReport = JSON.parse(localRun.stdout);
  assert.equal(localReport.evidenceKind, 'renderizado local');
  assert.equal(localReport.authenticatedPublication, 'not-verified');
  assert.equal(localReport.visualReview.status, 'required');
  assert.equal(localReport.variants.length, 4);
  assert(localReport.variants.every((item: { status: string }) => item.status === 'passed'));
  assert.equal(await readFile(localHtml, 'utf8'), localSource);
  assert.equal(localReport.input.sha256, localReport.input.sha256After);
  assert.equal(JSON.parse(await readFile(join(localReport.evidenceDirectory, 'report.json'), 'utf8')).status, 'passed');

  const templates = join(bundled, 'templates/nested');
  await mkdir(templates, { recursive: true });
  const template = '{"metadata":{"title":"Template proof"}}';
  await writeFile(join(templates, 'snapshot.json'), template);
  const expanded = `${full}=== artifacts-cli/templates/nested/snapshot.json ===\n${template}\n`;
  assert.equal(await cli(['skills', 'get', 'artifacts-cli', '--full']), expanded);
  assert.equal(await cli(['skills', 'get', '--all', '--full']), expanded + designFull);
  assert.equal(await cli(['skills', 'get', 'artifacts-cli']), skill);
  await rm(join(bundled, 'templates'), { recursive: true });
  assert.equal(await cli(['skills', 'get', 'artifacts-cli'], home), skill);
  assert.equal(await cli(['--server', 'invalid-unused-resource', 'skills', 'list']), listed);
  assert.equal(await cli(['skills', 'path', '--state-dir', '/nonexistent/unused']), `${catalog}\n`);
  assert.equal((await cli(['--version'])).trim(), packed.version);
  assert.ok((await cli(['--help'])).includes('skills'));

  await mkdir(join(cwd, '.claude/skills/unrelated'), { recursive: true });
  const targets = [
    { args: ['skills', 'install'], base: cwd, agent: '.agents' },
    { args: ['skills', 'install', '--agent', 'claude'], base: cwd, agent: '.claude' },
    { args: ['skills', 'install', '--global'], base: home, agent: '.agents' },
    { args: ['skills', 'install', 'artifacts-cli', '--agent', 'claude', '--global'], base: home, agent: '.claude' },
  ];
  let discovery: string | undefined;
  for (const target of targets) {
    const destination = join(target.base, target.agent, 'skills/artifacts-cli/SKILL.md');
    assert.ok((await cli(target.args)).includes(destination));
    if (target === targets[0]) {
      await assert.rejects(readFile(join(cwd, '.claude/skills/artifacts-cli/SKILL.md')), { code: 'ENOENT' });
    }
    const text = await readFile(destination, 'utf8');
    assert.match(text, /^---\nname: artifacts-cli\ndescription: .+\n---\n/);
    assert.ok(text.length < skill.length / 2, 'Discovery remains a small pointer');
    discovery ??= text;
    assert.equal(text, discovery);
    const sentinel = new Date('2001-02-03T04:05:06Z');
    await utimes(destination, sentinel, sentinel);
    const before = await stat(destination);
    for (const args of [target.args, [...target.args, '--force']]) {
      assert.ok((await cli(args)).includes(destination));
      const after = await stat(destination);
      assert.equal(after.ino, before.ino);
      assert.equal(after.mtimeMs, before.mtimeMs);
      assert.equal(await readFile(destination, 'utf8'), text);
    }
    const neighbor = join(target.base, target.agent, 'skills/artifacts-cli/keep.txt');
    await writeFile(neighbor, 'Keep neighboring files.\n');
    await writeFile(destination, 'Existing custom instructions.\n');
    await failure(target.args, /--force/);
    assert.equal(await readFile(destination, 'utf8'), 'Existing custom instructions.\n');
    assert.ok((await cli([...target.args, '--force'])).includes(destination));
    assert.equal(await readFile(destination, 'utf8'), text);
    assert.equal(await readFile(neighbor, 'utf8'), 'Keep neighboring files.\n');
  }
  const load = discovery!.match(/`artifacts (skills get artifacts-cli --full)`/);
  assert.ok(load, 'Discovery names the executable command that loads all instructions');
  assert.equal(await cli(load[1].split(' ')), full);

  const localDiscovery = join(cwd, '.agents/skills/artifacts-cli/SKILL.md');
  const symlinkTarget = join(directory, 'custom-skill.md');
  await writeFile(symlinkTarget, 'Preserve the symlink target.\n');
  await rm(localDiscovery);
  await symlink(symlinkTarget, localDiscovery);
  await failure(['skills', 'install', '--force'], /symbolic|symlink|regular/i);
  assert.equal(await readFile(symlinkTarget, 'utf8'), 'Preserve the symlink target.\n');
  await rm(localDiscovery);
  await mkdir(localDiscovery);
  await failure(['skills', 'install', '--force'], /regular|directory/i);
  await rm(localDiscovery, { recursive: true });

  const invalid: [string[], RegExp][] = [
    [['skills', 'unknown'], /unknown|subcommand/i],
    [['skills', 'get'], /name|--all|skill/i],
    [['skills', 'get', 'unknown'], /unknown|not found/i],
    [['skills', 'get', '../artifacts-cli'], /unknown|invalid|not found/i],
    [['skills', 'get', '/artifacts-cli'], /unknown|invalid|not found/i],
    [['skills', 'get', 'artifacts-cli', '--all'], /--all|name|exactly/i],
    [['skills', 'get', '--all', 'extra'], /--all|name|exactly/i],
    [['skills', 'get', 'artifacts-cli', 'extra'], /argument|name/i],
    [['skills', 'path', 'unknown'], /unknown|not found/i],
    [['skills', 'install', 'unknown'], /unknown|not found/i],
    [['skills', 'install', '../escape'], /unknown|invalid|not found/i],
    [['skills', 'install', '--agent', 'codex'], /claude|agent/i],
    [['skills', 'install', '--agent', ''], /claude|agent/i],
    [['skills', 'list', 'artifacts-cli'], /argument|name/i],
    [['skills', 'path', 'artifacts-cli', 'extra'], /argument|name/i],
    [['skills', 'install', 'artifacts-cli', 'extra'], /argument|name/i],
    [['skills', 'list', '--full'], /--full/],
    [['skills', '--full'], /--full/],
    [['skills', 'path', '--all'], /--all/],
    [['skills', 'get', '--all', '--force'], /--force/],
    [['skills', 'install', '--full'], /--full/],
    [['skills', 'install', '--global', '--global'], /repeated/],
    [['skills', 'get', 'artifacts-cli', '--full', '--full'], /repeated/],
    [['skills', 'get', '--unknown'], /unknown/i],
    [['skills', 'get', '--full=false', 'artifacts-cli'], /full|argument/i],
    [['skills', 'list', '--limit', '1'], /--limit/],
    [['list', '--full'], /--full/],
  ];
  for (const [args, pattern] of invalid) await failure(args, pattern);
  assert.equal((await readdir(home)).includes('cli-state'), false, 'Offline commands never initialize credential state');
  console.log('Packaged skills passed offline listing, exact content, full references, paths, canvas preparation and rejection, retained handoff, all install destinations, idempotence, overwrite protection, discovery loading, and invalid arguments.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
