import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { unzipSync, zipSync } from 'fflate';
import type { ArtifactRead } from '../packages/artifacts/src/contracts.ts';
import { compareRetainedArchive, expectedRetainedArchive, parseRetainedVerificationConfig, type RetainedVerificationConfig } from '../.agents/skills/verify-artifacts/scripts/retained.ts';

const snapshot = { metadata: { title: 'Retained cost document', description: 'Exact complete snapshot', custom: { retained: true } }, content: { kind: 'html' as const, text: '<h1>Retained revision</h1><button id="change">Change cost</button><output id="total">5.00</output><script>document.querySelector("#change").onclick=()=>document.querySelector("#total").textContent="28.40"</script>' }, files: [{ path: 'nested/bytes.bin', mediaType: 'application/octet-stream', encoding: 'base64' as const, data: 'AAH/' }] };
const canonical = JSON.stringify(snapshot, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
const saved: ArtifactRead = { artifactId: 'artifact-retained', ownerId: 'owner-retained', headRevisionId: 'revision-two', project: null, publication: { revisionId: 'revision-one', version: 3, url: 'http://localhost/a/artifact-retained' }, revision: { id: 'revision-one', parentRevisionId: null, sequence: 1, authorUserId: 'owner-retained', authorClientId: 'mcp-retained', createdAt: '2026-10-11T12:00:00.000Z', sha256: createHash('sha256').update(canonical).digest('hex'), snapshot } };

function config(directory: string, origin = 'http://localhost'): RetainedVerificationConfig {
  return { expected: { ...saved, publication: { ...saved.publication!, url: `${origin}/a/artifact-retained` } }, panelUrl: `${origin}/artifacts/artifact-retained?revisionId=revision-one`, publicationUrl: `${origin}/a/artifact-retained`, viewports: [{ width: 1280, height: 900 }, { width: 390, height: 844 }], expectations: [{ kind: 'text', selector: '#total', text: '5.00' }, { kind: 'click', selector: '#change' }, { kind: 'text', selector: '#total', text: '28.40' }], evidenceDirectory: directory, timeoutMs: 600 };
}

test('config requires a full consistent saved read and declarative content-only checks', () => {
  const result = parseRetainedVerificationConfig(config('/tmp/retained-schema'));
  assert.equal(result.expected.revision.id, 'revision-one');
  assert.deepEqual(result.viewports, [{ width: 1280, height: 900 }, { width: 390, height: 844 }]);
  assert.throws(() => parseRetainedVerificationConfig({ ...config('/tmp/retained-schema'), expected: { ...saved, revision: { ...saved.revision, sha256: '0'.repeat(64) } } }), /SHA-256/);
  assert.throws(() => parseRetainedVerificationConfig({ ...config('/tmp/retained-schema'), expectations: [{ kind: 'evaluate', script: 'location.href="/auth/logout"' }] }), /Unknown content expectation/);
  assert.throws(() => parseRetainedVerificationConfig({ ...config('/tmp/retained-schema'), expectations: [{ kind: 'click', selector: '#change', url: '/auth/logout' }] }), /unknown fields/);
  assert.throws(() => parseRetainedVerificationConfig({ ...config('/tmp/retained-schema'), panelUrl: 'http://localhost/artifacts/artifact-retained?revisionId=revision-two' }), /pin the expected revision/);
});

test('archive comparison proves exact manifest, text, inventory and binary attachment bytes', () => {
  const bytes = expectedRetainedArchive(saved);
  compareRetainedArchive(bytes, saved);
  const members = unzipSync(bytes);
  assert.equal(Buffer.from(members['content.html']!).toString(), snapshot.content.text);
  assert.deepEqual(Buffer.from(members['files/nested/bytes.bin']!), Buffer.from([0, 1, 255]));
  members['files/nested/bytes.bin'] = Buffer.from([0, 1, 254]);
  assert.throws(() => compareRetainedArchive(zipSync(members), saved), /bytes differ for files\/nested\/bytes.bin/);
  delete members['files/nested/bytes.bin'];
  assert.throws(() => compareRetainedArchive(zipSync(members), saved), /complete retained inventory/);
});

test('CLI handoff prepares the exact selected revision and matching publication without mutating inputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'retained-handoff-'));
  try {
    const receipt = { artifactId: saved.artifactId, revision: { id: saved.revision.id, sha256: saved.revision.sha256 } };
    const checks = { viewports: config(directory).viewports, expectations: config(directory).expectations, timeoutMs: 1000 };
    const inputs = { receipt, read: saved, checks, publication: { artifactId: saved.artifactId, ...saved.publication! } };
    for (const [name, value] of Object.entries(inputs)) await writeFile(join(directory, `${name}.json`), JSON.stringify(value));
    const args = ['--receipt', join(directory, 'receipt.json'), '--read', join(directory, 'read.json'), '--panel-origin', 'http://localhost', '--checks', join(directory, 'checks.json'), '--evidence', join(directory, 'new-evidence'), '--out', join(directory, 'config.json')];
    const helper = resolve('skills/artifacts-cli/scripts/prepare-retained.mjs');
    const run = (extra: string[] = []) => spawnSync(process.execPath, [helper, ...args, ...extra], { encoding: 'utf8' });
    const result = run(['--publication-receipt', join(directory, 'publication.json')]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { status: 'prepared', headChanged: true, publication: 'requested' });
    assert.match(result.stderr, /draft head differs/);
    const prepared = parseRetainedVerificationConfig(JSON.parse(await readFile(join(directory, 'config.json'), 'utf8')));
    assert.deepEqual(prepared.expected, saved);
    assert.equal(prepared.panelUrl, 'http://localhost/artifacts/artifact-retained?revisionId=revision-one');
    assert.equal(prepared.publicationUrl, saved.publication!.url);
    assert.deepEqual(prepared.expectations, checks.expectations);
    assert.equal((await stat(join(directory, 'config.json'))).mode & 0o777, 0o600);
    await assert.rejects(stat(join(directory, 'new-evidence')), { code: 'ENOENT' });
    const before = await readFile(join(directory, 'config.json'));
    assert.equal(run().status, 1);
    assert.deepEqual(await readFile(join(directory, 'config.json')), before);
    for (const [name, value] of Object.entries(inputs)) assert.deepEqual(JSON.parse(await readFile(join(directory, `${name}.json`), 'utf8')), value);
    await rm(join(directory, 'config.json'));
    const draft = run();
    assert.equal(draft.status, 0, draft.stderr);
    assert.equal(JSON.parse(draft.stdout).publication, 'not-requested');
    assert.equal(parseRetainedVerificationConfig(JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'))).publicationUrl, undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI handoff rejects wrong receipts, compact reads, changed publication, and private malformed input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'retained-handoff-errors-'));
  try {
    const receipt = { artifactId: saved.artifactId, revision: { id: saved.revision.id, sha256: saved.revision.sha256 } };
    const checks = { viewports: [{ width: 1280, height: 900 }], expectations: [] };
    const publication = { artifactId: saved.artifactId, ...saved.publication! };
    const cases = [
      { receipt: { ...receipt, artifactId: 'different-artifact' }, read: saved, publication, message: /write receipt/ },
      { receipt: { ...receipt, revision: { ...receipt.revision, id: 'different-revision' } }, read: saved, publication, message: /write receipt/ },
      { receipt: { ...receipt, revision: { ...receipt.revision, sha256: '0'.repeat(64) } }, read: saved, publication, message: /write receipt/ },
      { receipt, read: { ...saved, revision: { ...saved.revision, snapshot: undefined } }, publication, message: /full snapshot/ },
      { receipt, read: saved, publication: { ...publication, revisionId: 'revision-two' }, message: /Publication differs/ },
      { receipt, read: saved, publication: { ...publication, version: publication.version + 1 }, message: /Publication differs/ },
      { receipt, read: saved, publication: { ...publication, url: 'http://other.invalid/a/artifact-retained' }, message: /Publication differs/ },
    ];
    for (const [index, item] of cases.entries()) {
      for (const name of ['receipt', 'read', 'publication'] as const) await writeFile(join(directory, `${name}.json`), JSON.stringify(item[name]));
      await writeFile(join(directory, 'checks.json'), JSON.stringify(checks));
      const output = join(directory, `config-${index}.json`);
      const result = spawnSync(process.execPath, [resolve('skills/artifacts-cli/scripts/prepare-retained.mjs'), '--receipt', join(directory, 'receipt.json'), '--read', join(directory, 'read.json'), '--checks', join(directory, 'checks.json'), '--panel-origin', 'http://localhost', '--evidence', join(directory, 'new-evidence'), '--out', output, '--publication-receipt', join(directory, 'publication.json')], { encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, item.message);
      await assert.rejects(stat(output), { code: 'ENOENT' });
    }
    const secret = 'private-snapshot-and-credential-fragment';
    await writeFile(join(directory, 'receipt.json'), `{${secret}`);
    const args = [resolve('skills/artifacts-cli/scripts/prepare-retained.mjs'), '--receipt', join(directory, 'receipt.json'), '--read', join(directory, 'read.json'), '--checks', join(directory, 'checks.json'), '--panel-origin', 'http://localhost', '--evidence', join(directory, 'new-evidence'), '--out', join(directory, 'malformed.json')];
    const malformed = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(malformed.status, 1);
    assert.match(malformed.stderr, /Cannot read valid JSON/);
    assert.equal((malformed.stdout + malformed.stderr).includes(secret), false);
    await writeFile(join(directory, 'receipt.json'), JSON.stringify(receipt));
    await writeFile(join(directory, 'read.json'), JSON.stringify(saved));
    const badOrigin = spawnSync(process.execPath, args.map((value) => value === 'http://localhost' ? `https://user:${secret}@example.test` : value), { encoding: 'utf8' });
    assert.equal(badOrigin.status, 1);
    assert.equal((badOrigin.stdout + badOrigin.stderr).includes(secret), false);
    assert.equal(spawnSync(process.execPath, [...args, '--unknown', secret], { encoding: 'utf8' }).status, 1);
    assert.equal(spawnSync(process.execPath, [...args, '--out', join(directory, 'duplicate.json')], { encoding: 'utf8' }).status, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('documented receipt extraction returns exact IDs and keeps malformed input private', async () => {
  const recipe = await readFile(resolve('skills/artifacts-cli/references/verify-retained.md'), 'utf8');
  const extractions = [...recipe.matchAll(/^(artifact_id|revision_id)=\$\(node -e '([^']+)' write-result\.json\)$/gm)];
  assert.deepEqual(extractions.map((match) => match[1]), ['artifact_id', 'revision_id']);
  const directory = await mkdtemp(join(tmpdir(), 'retained-receipt-extraction-'));
  try {
    const path = join(directory, 'write-result.json');
    const receipt = { artifactId: 'selected-artifact', revision: { id: 'selected-revision', sha256: '0'.repeat(64) } };
    await writeFile(path, JSON.stringify(receipt));
    for (const [index, match] of extractions.entries()) {
      const result = spawnSync(process.execPath, ['-e', match[2]!, path], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, [receipt.artifactId, receipt.revision.id][index]);
      assert.equal(result.stderr, '');
    }
    const secret = 'private-receipt-fragment';
    const failures = [
      `{${secret}`,
      `{"private":"${secret}","artifactId":`,
      JSON.stringify({ private: secret }),
      JSON.stringify({ private: secret, artifactId: '', revision: { id: '' } }),
      JSON.stringify({ private: secret, artifactId: 5, revision: { id: 5 } }),
      'null',
    ];
    for (const contents of failures) {
      await writeFile(path, contents);
      for (const match of extractions) {
        const result = spawnSync(process.execPath, ['-e', match[2]!, path], { encoding: 'utf8' });
        assert.equal(result.status, 1);
        assert.equal(result.stdout, '');
        assert.match(result.stderr, /^Cannot extract the (artifact|revision) ID from the write receipt\n$/);
        assert.equal(result.stderr.includes(secret), false);
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
