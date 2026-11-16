import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

// Seconds each proof took in CI. The shards balance on these weights, so refresh them from a CI run when a proof's time changes a lot.
const proofs: { file: string; seconds: number; test?: true }[] = [
  { file: 'tests/browser.proof.ts', seconds: 7 },
  { file: 'tests/sign-in-code.browser.proof.ts', seconds: 79 },
  { file: 'tests/artifact-browser.proof.ts', seconds: 23 },
  { file: 'tests/artifact-deletion.browser.proof.ts', seconds: 5 },
  { file: 'tests/publication-network.proof.ts', seconds: 11 },
  { file: 'tests/design-canvas.browser.proof.ts', seconds: 9 },
  { file: 'tests/retained-verification.browser.proof.ts', seconds: 85, test: true },
  { file: 'tests/retained-browser.proof.ts', seconds: 17 },
  { file: 'tests/panel-detail.browser.proof.ts', seconds: 31 },
  { file: 'tests/panel-library.browser.proof.ts', seconds: 12 },
  { file: 'tests/panel-table.browser.proof.ts', seconds: 9 },
  { file: 'tests/panel-read-mode.browser.proof.ts', seconds: 15 },
  { file: 'tests/panel-palette.browser.proof.ts', seconds: 14 },
  { file: 'tests/panel-move.browser.proof.ts', seconds: 9 },
  { file: 'tests/panel-selection.browser.proof.ts', seconds: 10 },
  { file: 'tests/panel-dialog.browser.proof.ts', seconds: 30 },
  { file: 'tests/panel-share.browser.proof.ts', seconds: 54 },
  { file: 'tests/panel-theme.browser.proof.ts', seconds: 265 },
  { file: 'tests/invitations.browser.proof.ts', seconds: 18 },
];

const { values } = parseArgs({ options: { shard: { type: 'string' } } });
const [index, count] = (values.shard ?? '1/1').split('/').map(Number);
assert.ok(Number.isInteger(index) && Number.isInteger(count) && index >= 1 && index <= count, 'Pass --shard as <index>/<count>, for example 2/3');

const loads = Array.from({ length: count }, () => ({ seconds: 0, files: [] as typeof proofs }));
for (const proof of [...proofs].sort((left, right) => right.seconds - left.seconds)) {
  const lightest = loads.reduce((best, load) => (load.seconds < best.seconds ? load : best));
  lightest.seconds += proof.seconds;
  lightest.files.push(proof);
}
const shard = loads[index - 1];
console.log(`Shard ${index}/${count} runs ${shard.files.length} proofs, about ${shard.seconds} s`);

for (const proof of proofs.filter((proof) => shard.files.includes(proof))) {
  const started = Date.now();
  const result = spawnSync(process.execPath, ['--import', 'tsx', ...(proof.test ? ['--test'] : []), proof.file], { stdio: 'inherit' });
  console.log(`${proof.file} ${result.status === 0 ? 'passed' : 'failed'} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
