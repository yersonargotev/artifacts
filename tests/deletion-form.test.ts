import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDeletionForm } from '../apps/dashboard/src/delete.ts';

const command = { artifactId: 'artifact-one', expectedRevisionId: 'revision-one', expectedPublicationVersion: 2, requestId: 'delete-request-one' };
const fields = new URLSearchParams(Object.entries(command).map(([name, value]) => [name, String(value)]));
const request = (body = fields.toString(), contentType = 'application/x-www-form-urlencoded') => new Request('https://panel.example.test/artifacts/artifact-one/delete', { method: 'POST', headers: { 'content-type': contentType }, body });
test('deletion forms preserve the exact observed command', async () => {
  assert.deepEqual(await parseDeletionForm(request(), command.artifactId), command);
});
test('deletion form rejects extra, repeated, missing, malformed, oversized or mismatched values', async () => {
  const invalid = [
    `${fields}&ownerId=intruder`, `${fields}&requestId=another-request`, fields.toString().replace('expectedRevisionId=revision-one&', ''),
    fields.toString().replace('expectedPublicationVersion=2', 'expectedPublicationVersion=02'), fields.toString().replace('expectedPublicationVersion=2', 'expectedPublicationVersion=9007199254740992'),
    fields.toString().replace('revision-one', '%ZZ'), fields.toString().replace('revision-one', '%C0%AF'), fields.toString().replace('revision-one', 'x'.repeat(5000)), fields.toString().replace('delete-request-one', 'short'),
  ];
  for (const body of invalid) await assert.rejects(parseDeletionForm(request(body), command.artifactId), (error: unknown) => error instanceof Response && error.status === 400);
  await assert.rejects(parseDeletionForm(request(), 'other-artifact'), (error: unknown) => error instanceof Response && error.status === 400);
  await assert.rejects(parseDeletionForm(request(fields.toString(), 'application/json'), command.artifactId), (error: unknown) => error instanceof Response && error.status === 400);
});
