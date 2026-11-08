// Model-checks store.batch against concurrent writers with TLC.
// Usage: node .agents/skills/verify-batch-concurrency/scripts/check.ts [options]
//   --env               print JAVA and TLA2TOOLS exports for the pinned tools, then exit
//   --run race,retry    run only these runs (race, retry, spelling)
//   --without A,B       model the code without these guards, to see what each one protects
//   --trace             also print the counterexample of a known finding
//   --keep              keep the TLC working directory (spec, configs, outputs) and print its path
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(skill, '../../..');
const spec = path.join(skill, 'model', 'BatchConcurrency.tla');

// Pinned tools. The JRE is Eclipse Temurin 21.0.5+11; checksums come from api.adoptium.net.
const tla = { url: 'https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar', sha256: '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88' };
const jre: Record<string, { file: string; sha256: string }> = {
  'darwin-arm64': { file: 'OpenJDK21U-jre_aarch64_mac_hotspot_21.0.5_11.tar.gz', sha256: '12249a1c5386957c93fc372260c483ae921b1ec6248a5136725eabd0abc07f93' },
  'darwin-x64': { file: 'OpenJDK21U-jre_x64_mac_hotspot_21.0.5_11.tar.gz', sha256: '0e0dcb571f7bf7786c111fe066932066d9eab080c9f86d8178da3e564324ee81' },
  'linux-arm64': { file: 'OpenJDK21U-jre_aarch64_linux_hotspot_21.0.5_11.tar.gz', sha256: 'e4d02c33aeaf8e1148c1c505e129a709c5bc1889e855d4fb4f001b1780db42b4' },
  'linux-x64': { file: 'OpenJDK21U-jre_x64_linux_hotspot_21.0.5_11.tar.gz', sha256: '553dda64b3b1c3c16f8afe402377ffebe64fb4a1721a46ed426a91fd18185e62' },
};
const jreBase = 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/';

// Files the model describes. A change to any of them since `sync` means the model needs another look.
const sync = 'e29d8a2';
const covered = [
  'packages/artifacts/src/index.ts',
  'packages/artifacts/src/batch.ts',
  'packages/artifacts/src/access.ts',
  'packages/artifacts/src/panel/model.ts',
  'packages/db/src/schema.ts',
];

// Each guard the model can switch off, and the code that must still contain it.
const guards: Record<string, { file: string; pattern: RegExp }> = {
  SeqIndex: { file: 'packages/db/src/schema.ts', pattern: /uniqueIndex\('artifact_revision_sequence_idx'\)\.on\(table\.artifactId, table\.sequence\)/ },
  SlugIndex: { file: 'packages/db/src/schema.ts', pattern: /uniqueIndex\('artifact_owner_project_slug_idx'\)\.on\(table\.ownerId, sql`coalesce\(project, ''\)`, table\.slug\)/ },
  ReceiptKey: { file: 'packages/db/src/schema.ts', pattern: /primaryKey\(\{ columns: \[table\.ownerId, table\.requestId\] \}\)/ },
  MovedGuard: { file: 'packages/artifacts/src/index.ts', pattern: /^\s*moved\(actor\.userId, write\),$/m },
  HeadGuard: { file: 'packages/artifacts/src/index.ts', pattern: /set\(\{ headRevisionId: write\.revisionId \}\)\.where\(and\(eq\(artifact\.id, write\.artifactId\), eq\(artifact\.ownerId, actor\.userId\), eq\(artifact\.headRevisionId, write\.parentRevisionId\)\)\)/ },
};

const shared = `CONSTANTS
  NULL = NULL
  Slugs = {"a", "b"}
  MaxOps = 2
`;
const runs = [
  { name: 'race', expect: 'pass', constants: 'Retry = FALSE\n  MaxInteractive = 2', invariants: ['TypeOK', 'LinearHistory', 'BatchReportsTruth', 'SlugNamesOnePage'] },
  { name: 'retry', expect: 'pass', constants: 'Retry = TRUE\n  MaxInteractive = 1', invariants: ['TypeOK', 'LinearHistory', 'BatchReportsTruth', 'SlugNamesOnePage', 'ExactlyOnce'] },
  { name: 'spelling', expect: 'finding', constants: 'Retry = FALSE\n  MaxInteractive = 1', invariants: ['OneSpellingPerProject', 'SlugNamesOnePageInProject'] },
];

const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
function fetchTo(url: string, file: string, sum: string) {
  if (existsSync(file) && sha(file) === sum) return;
  const got = spawnSync('curl', ['-fsSL', '-o', file, url], { stdio: 'inherit' });
  if (got.status !== 0) throw new Error(`Download failed: ${url}`);
  if (sha(file) !== sum) { rmSync(file); throw new Error(`Checksum mismatch: ${url}`); }
}
function findJava(dir: string): string | undefined {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === 'java' && path.basename(path.dirname(full)) === 'bin') return full;
    if (entry.isDirectory()) { const found = findJava(full); if (found) return found; }
  }
}
function tools(): { java: string; jar: string } {
  if (process.env.TLA2TOOLS) return { java: process.env.JAVA || 'java', jar: process.env.TLA2TOOLS };
  const cache = path.join(process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache'), 'artifacts-formal');
  mkdirSync(cache, { recursive: true });
  const jar = path.join(cache, 'tla2tools-1.7.4.jar');
  fetchTo(tla.url, jar, tla.sha256);
  if (process.env.JAVA) return { java: process.env.JAVA, jar };
  const platform = jre[`${process.platform}-${process.arch}`];
  if (!platform) throw new Error(`No pinned JRE for ${process.platform}-${process.arch}; set JAVA to a Java 11+ binary`);
  const dir = path.join(cache, platform.file.replace('.tar.gz', ''));
  let java = existsSync(dir) ? findJava(dir) : undefined;
  if (!java) {
    const archive = path.join(cache, platform.file);
    fetchTo(jreBase + platform.file, archive, platform.sha256);
    mkdirSync(dir, { recursive: true });
    if (spawnSync('tar', ['-xzf', archive, '-C', dir], { stdio: 'inherit' }).status !== 0) throw new Error('Could not extract the JRE');
    rmSync(archive);
    java = findJava(dir);
  }
  if (!java) throw new Error('The pinned JRE has no bin/java');
  return { java, jar };
}

const { java, jar } = tools();
if (process.argv.includes('--env')) {
  console.log(`export JAVA='${java}'\nexport TLA2TOOLS='${jar}'`);
  process.exit(0);
}

const without = process.argv.flatMap((arg, i) => process.argv[i - 1] === '--without' ? arg.split(',') : []);
for (const name of without) if (!(name in guards)) throw new Error(`Unknown guard ${name}; one of ${Object.keys(guards).join(', ')}`);
const only = process.argv.flatMap((arg, i) => process.argv[i - 1] === '--run' ? arg.split(',') : []);
const flags = Object.fromEntries(Object.entries(guards).map(([name, { file, pattern }]) => [name, !without.includes(name) && pattern.test(readFileSync(path.join(repo, file), 'utf8'))]));
const attempts = /isConstraint\(error\) && conflicts\+\+ < (\d+)\) continue;/.exec(readFileSync(path.join(repo, 'packages/artifacts/src/index.ts'), 'utf8'));
console.log('Guards found in the code:');
for (const [name, present] of Object.entries(flags)) console.log(`  ${present ? 'present' : without.includes(name) ? 'OFF (--without)' : 'MISSING'}  ${name}  (${guards[name]!.file})`);
console.log(`  write requests per batch call: ${attempts ? Number(attempts[1]) + 1 : 'MISSING retry loop, modeled as 1'}`);

const drift = spawnSync('git', ['diff', '--name-only', sync, '--', ...covered], { cwd: repo, encoding: 'utf8' });
const changed = drift.status === 0 ? drift.stdout.trim().split('\n').filter(Boolean) : [`(git diff against ${sync} failed: ${drift.stderr.trim()})`];
if (changed.length) console.log(`\nCovered code changed since sync commit ${sync}; confirm the model still describes it:\n${changed.map((f) => `  ${f}`).join('\n')}`);

const work = mkdtempSync(path.join(tmpdir(), 'batch-concurrency-'));
copyFileSync(spec, path.join(work, 'BatchConcurrency.tla'));
const guardConstants = Object.entries(flags).map(([name, present]) => `  ${name} = ${present ? 'TRUE' : 'FALSE'}`).join('\n');
let failed = false;
for (const run of runs.filter(({ name }) => only.length === 0 || only.includes(name))) {
  const cfg = path.join(work, `${run.name}.cfg`);
  writeFileSync(cfg, `SPECIFICATION Spec\n${shared}  ${run.constants}\n  Attempts = ${attempts ? Number(attempts[1]) + 1 : 1}\n${guardConstants}\nINVARIANTS\n${run.invariants.map((i) => `  ${i}`).join('\n')}\n`);
  const started = Date.now();
  const tlc = spawnSync(java, ['-XX:+UseParallelGC', '-cp', jar, 'tlc2.TLC', '-config', cfg, '-workers', 'auto', '-deadlock', '-metadir', path.join(work, `${run.name}-states`), 'BatchConcurrency.tla'], { cwd: work, encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = `${tlc.stdout}${tlc.stderr}`;
  writeFileSync(path.join(work, `${run.name}.out`), out);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const violated = /Error: Invariant (\w+) is violated/.exec(out)?.[1];
  const states = /([\d,]+) distinct states found, 0 states left on queue/.exec(out)?.[1] ?? '?';
  const passed = tlc.status === 0 && /Model checking completed\. No error has been found\./.test(out);
  if (!passed && !violated) {
    failed = true;
    console.log(`\n[${run.name}] TLC did not finish (exit ${tlc.status}). Output:\n${out.slice(-4000)}`);
    continue;
  }
  if (run.expect === 'pass') {
    if (passed) console.log(`\n[${run.name}] PASS  ${run.invariants.join(', ')}  (${states} states, ${seconds}s)`);
    else { failed = true; console.log(`\n[${run.name}] FAIL  ${violated} is violated  (${seconds}s)\n${trace(out)}`); }
  } else if (passed) {
    console.log(`\n[${run.name}] FINDING FIXED  ${run.invariants.join(', ')} now hold. Move them into a 'pass' run and update the skill.`);
  } else {
    console.log(`\n[${run.name}] KNOWN FINDING still present: ${violated} is violated  (${seconds}s)`);
    if (process.argv.includes('--trace')) console.log(trace(out));
  }
}
if (process.argv.includes('--keep')) console.log(`\nTLC working directory: ${work}`);
else rmSync(work, { recursive: true, force: true });
process.exit(failed ? 1 : 0);

function trace(out: string) {
  const start = out.indexOf('Error: The behavior up to this point is:');
  return start < 0 ? out.slice(-4000) : out.slice(start, out.lastIndexOf('distinct states found') + 30);
}
