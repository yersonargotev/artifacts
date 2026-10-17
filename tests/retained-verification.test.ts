import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
