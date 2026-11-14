import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../skills/artifacts-design/scripts/deal-directions.mjs', import.meta.url));
const deal = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const parse = (output: string) => output.trim().split('\n\n').map((block) => Object.fromEntries(block.split('\n').slice(1).map((line) => {
  const [axis, ...value] = line.trim().split(': ');
  return [axis, value.join(': ')];
})));

test('direction dealer prints two directions that differ on every axis', () => {
  for (let seed = 0; seed < 200; seed++) {
    const result = deal('--seed', String(seed));
    assert.equal(result.status, 0, result.stderr);
    const [first, second] = parse(result.stdout);
    assert.deepEqual(Object.keys(first), ['ground', 'accent', 'type', 'shape']);
    for (const axis of Object.keys(first)) assert.notEqual(first[axis], second[axis], `seed ${seed} repeats ${axis}`);
  }
});

test('direction dealer repeats a seeded deal and varies unseeded deals', () => {
  assert.equal(deal('--seed', '7').stdout, deal('--seed', '7').stdout);
  const seeded = new Set(Array.from({ length: 40 }, (_, seed) => deal('--seed', String(seed)).stdout));
  assert.ok(seeded.size > 30, `40 seeds produced ${seeded.size} deals`);
  const unseeded = new Set(Array.from({ length: 12 }, () => deal().stdout));
  assert.ok(unseeded.size > 6, `12 unseeded runs produced ${unseeded.size} deals`);
});

test('direction dealer rejects unknown arguments', () => {
  for (const args of [['--seed'], ['--seed', 'x'], ['--other', '1'], ['--seed', '1', 'extra']]) {
    const result = deal(...args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^Usage: /);
  }
});
