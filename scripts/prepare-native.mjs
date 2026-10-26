import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const inputs = JSON.parse(await readFile(join(root, 'native/libsql/inputs.json'), 'utf8'));
const { values } = parseArgs({ options: { rebuild: { type: 'boolean' }, check: { type: 'boolean' } } });
assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Native preparation requires Node 24 or newer');
assert.ok(!(values.rebuild && values.check), 'Choose --rebuild or --check');
const glibc = process.platform === 'linux' ? process.report.getReport().header.glibcVersionRuntime : undefined;
const hosts = {
  'darwin-arm64': { os: 'darwin', cpu: 'arm64', rust: 'aarch64-apple-darwin', library: 'liblibsql_js.dylib' },
  'linux-x64': { os: 'linux', cpu: 'x64', libc: 'glibc', rust: 'x86_64-unknown-linux-gnu', library: 'liblibsql_js.so' },
};
const host = hosts[`${process.platform}-${process.arch}`];
assert.ok(host && (process.platform !== 'linux' || glibc), 'Native preparation supports darwin-arm64 and linux-x64 with glibc; use the portable distribution on other hosts');
const target = { ...host, name: `${host.os}-${host.cpu}${host.libc ? '-gnu' : ''}`, napi: inputs.napi, ...(glibc ? { glibc } : {}), ...(host.os === 'darwin' ? { minimumOs: inputs.macosDeploymentTarget } : {}) };
const output = join(root, '.native');
const prepared = join(output, 'libsql');
const patch = join(root, 'native/libsql/native-reset.patch');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashFile = async (path) => sha256(await readFile(path));
const preparationSha256 = await hashFile(fileURLToPath(import.meta.url));
assert.equal(await hashFile(patch), inputs.patchSha256, 'Native patch differs from the reviewed input');
async function files(directory, prefix = '') {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(result, await files(path, `${name}/`));
    else {
      assert.ok(entry.isFile(), `Native output is not a regular file: ${name}`);
      if (name !== 'provenance.json') result[name] = await hashFile(path);
    }
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}
async function verify() {
  const provenance = JSON.parse(await readFile(join(prepared, 'provenance.json'), 'utf8'));
  assert.equal(provenance.preparationSha256, preparationSha256, 'Native preparation changed; run prepare:native --rebuild');
  assert.deepEqual(provenance.inputs, inputs, 'Prepared native inputs changed; run prepare:native --rebuild');
  assert.deepEqual(provenance.target, target, 'Prepared native target differs from this host');
  assert.deepEqual(provenance.files, await files(prepared), 'Prepared native files changed; run prepare:native --rebuild');
  assert.equal(provenance.binarySha256, provenance.files['index.node']);
  console.log(JSON.stringify({ native: 'verified', path: prepared, target, binarySha256: provenance.binarySha256 }));
}
let exists = true;
try { await readFile(join(prepared, 'provenance.json')); }
catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
if (values.check || (exists && !values.rebuild)) {
  await verify();
} else {
  const env = { ...process.env, RUSTUP_TOOLCHAIN: inputs.rustToolchain, CARGO_TARGET_DIR: join(output, 'build/source/target'), CC: 'clang', CXX: 'clang++', ...(host.os === 'darwin' ? { MACOSX_DEPLOYMENT_TARGET: inputs.macosDeploymentTarget } : {}) };
  delete env.CARGO_BUILD_TARGET;
  async function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'inherit'], ...options });
      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; if (options.stream) process.stdout.write(chunk); });
      child.once('error', (error) => reject(new Error(`Native preparation requires ${command}: ${error.message}`)));
      child.once('exit', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${command} exited with ${code}`)));
    });
  }
  await mkdir(output, { recursive: true });
  const cargo = await run('cargo', ['--version']);
  assert.match(cargo, new RegExp(`^cargo ${inputs.rustToolchain.replaceAll('.', '\\.')}`));
  const rustc = await run('rustc', ['--version', '--verbose']);
  assert.ok(rustc.includes(`host: ${host.rust}`), 'Rust toolchain host differs from the selected native target');
  const compiler = await run('clang', ['--version']);
  const cmake = join(output, 'tools', 'bin', 'cmake');
  try { await readFile(cmake); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.log(`Installing CMake ${inputs.cmakeVersion} in ${join(output, 'tools')}`);
    await run('python3', ['-m', 'venv', join(output, 'tools')]);
    await run(join(output, 'tools/bin/python'), ['-m', 'pip', 'install', '--disable-pip-version-check', `cmake==${inputs.cmakeVersion}`], { stream: true });
  }
  const cmakeVersion = await run(cmake, ['--version']);
  assert.ok(cmakeVersion.startsWith(`cmake version ${inputs.cmakeVersion}`), 'Owned CMake version differs from the pinned tool');
  env.CMAKE = cmake;
  const build = join(output, 'build');
  await rm(build, { recursive: true, force: true });
  await mkdir(build);
  async function extract(name, input) {
    const archive = join(output, `${name}.tgz`);
    let bytes;
    try { bytes = await readFile(archive); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const response = await fetch(input.url, { signal: AbortSignal.timeout(60_000) });
      assert.ok(response.ok, `${name} download returned ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(sha256(bytes), input.sha256, `${name} archive hash differs`);
      await writeFile(archive, bytes);
    }
    assert.equal(sha256(bytes), input.sha256, `${name} cached archive hash differs`);
    const directory = join(build, name);
    await mkdir(directory);
    await run('tar', ['-xzf', archive, '-C', directory, '--strip-components=1']);
    return directory;
  }
  const source = await extract('source', inputs.source);
  const wrapper = await extract('wrapper', inputs.wrapper);
  assert.equal(await hashFile(join(source, 'Cargo.lock')), inputs.cargoLockSha256);
  assert.equal(await hashFile(join(source, 'Cargo.toml')), inputs.cargoManifestSha256);
  await run('git', ['init', '--quiet'], { cwd: source });
  await run('git', ['apply', '--check', patch], { cwd: source });
  await run('git', ['apply', patch], { cwd: source });
  assert.equal(await hashFile(join(source, 'src/statement.rs')), inputs.patchedStatementSha256, 'Native statement source differs from the reviewed correction');
  const startedAt = new Date().toISOString();
  await run('cargo', ['build', '--locked', '--release', '--manifest-path', join(source, 'Cargo.toml')], { stream: true });
  assert.equal(await hashFile(join(source, 'Cargo.lock')), inputs.cargoLockSha256);
  const staged = join(build, 'libsql');
  await cp(wrapper, staged, { recursive: true });
  const manifest = JSON.parse(await readFile(join(staged, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'libsql');
  assert.equal(manifest.version, inputs.version);
  for (const file of ['index.js', 'promise.js']) {
    const path = join(staged, file);
    const original = await readFile(path, 'utf8');
    const loader = /function requireNative\(\) \{[\s\S]*?\n\}/g;
    assert.equal([...original.matchAll(loader)].length, 1, `Expected one native loader in ${file}`);
    const replaced = original.replace('const { load, currentTarget } = require("@neon-rs/load");\n', '').replace('const { familySync, GLIBC, MUSL } = require("detect-libc");\n', '').replace(loader, `function requireNative() {\n  if (process.platform !== ${JSON.stringify(host.os)} || process.arch !== ${JSON.stringify(host.cpu)}${host.libc ? ' || !process.report.getReport().header.glibcVersionRuntime' : ''} || Number(process.versions.napi) < ${inputs.napi}) {\n    throw new Error("This private libsql build requires ${target.name} and N-API ${inputs.napi} or newer");\n  }\n  return require("./index.node");\n}`);
    await writeFile(path, replaced);
  }
  for (const key of ['scripts', 'devDependencies', 'dependencies', 'optionalDependencies', 'neon']) delete manifest[key];
  Object.assign(manifest, { private: true, os: [host.os], cpu: [host.cpu], ...(host.libc ? { libc: [host.libc] } : {}), files: [...manifest.files, 'index.node', 'provenance.json'], artifactsNative: { target: target.name, napi: inputs.napi, sourceCommit: inputs.source.commit, patchSha256: inputs.patchSha256 } });
  await writeFile(join(staged, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await cp(join(source, 'target/release', host.library), join(staged, 'index.node'));
  const linkedLibraries = host.os === 'darwin'
    ? await run('otool', ['-L', join(staged, 'index.node')])
    : await run('ldd', [join(staged, 'index.node')]);
  if (host.os === 'darwin') {
    const identity = (await run('otool', ['-D', join(staged, 'index.node')])).split('\n').slice(1).map((line) => line.trim());
    for (const line of linkedLibraries.split('\n').slice(1)) {
      const dependency = line.trim().split(' (')[0];
      assert.ok(identity.includes(dependency) || dependency.startsWith('/usr/lib/') || dependency.startsWith('/System/Library/'), `Native binary links a producer dependency: ${dependency}`);
    }
  } else {
    assert.ok(!linkedLibraries.includes('not found'), 'Native binary has an unresolved runtime library');
    for (const line of linkedLibraries.split('\n')) {
      if (line.includes('linux-vdso')) continue;
      const dependency = (line.includes('=>') ? line.split('=>')[1] : line).trim().split(' ')[0];
      assert.ok(/^\/(?:usr\/)?lib(?:64)?\//.test(dependency), `Native binary links a producer dependency: ${dependency}`);
    }
  }
  const provenance = { inputs, preparationSha256, target, linkedLibraries, startedAt, completedAt: new Date().toISOString(), tools: { node: process.version, cargo, rustc, compiler, cmake: cmakeVersion }, binarySha256: await hashFile(join(staged, 'index.node')), files: await files(staged) };
  await writeFile(join(staged, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  await rm(prepared, { recursive: true, force: true });
  await rename(staged, prepared);
  await verify();
}
