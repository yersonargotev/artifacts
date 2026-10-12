#!/usr/bin/env -S node --import tsx
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { chromium } from 'playwright';
import { parseRetainedVerificationConfig, verifyRetainedArtifact } from './retained.ts';

const args = process.argv.slice(2);
try {
  assert.equal(args.length, 4, 'Usage: verify-retained.ts --config PATH --storage-state PRIVATE_PATH');
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    assert(['--config', '--storage-state'].includes(args[index]!) && !values.has(args[index]!), 'Use one --config and one --storage-state');
    values.set(args[index]!, args[index + 1]!);
  }
  const storageState = values.get('--storage-state')!;
  assert.equal((await stat(storageState)).mode & 0o077, 0, 'Browser storage state must be private to its owner');
  const config = parseRetainedVerificationConfig(JSON.parse(await readFile(values.get('--config')!, 'utf8')));
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const context = await browser.newContext({ storageState });
    const report = await verifyRetainedArtifact(context, config);
    console.log(JSON.stringify(report));
    if (report.status !== 'passed') process.exitCode = 1;
  } finally { await browser.close(); }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
