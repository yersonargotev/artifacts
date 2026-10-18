import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCommand, shellQuote } from '../apps/dashboard/src/presentation.ts';

test('project command quotes literal POSIX shell arguments', () => {
  assert.equal(shellQuote("O'Brien"), "'O'\\''Brien'");
  assert.equal(shellQuote('Two words'), "'Two words'");
  assert.equal(shellQuote('$x'), "'$x'");
  assert.equal(shellQuote('Éxito'), "'Éxito'");
  assert.equal(createCommand("O'Brien $x"), "artifacts create --snapshot snapshot.json --project 'O'\\''Brien $x'");
});
