import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchProjects, matchSegments } from '../apps/dashboard/src/components/move/match.ts';
import { readMoveSelection } from '../apps/dashboard/src/components/move/trigger.ts';

test('project choices preserve partitions and use persisted case folding for creation', () => {
  const projects = ['Alpha', 'Café', 'Checkout · pagos', 'Pagos', 'Zebra'];
  assert.deepEqual(matchProjects(projects, 'pag'), { matches: ['Checkout · pagos', 'Pagos'], others: ['Alpha', 'Café', 'Zebra'], create: 'pag', items: ['Checkout · pagos', 'Pagos', 'Alpha', 'Café', 'Zebra', 'pag'] });
  assert.deepEqual(matchProjects(['PAG', 'Pagos'], ' pag '), { matches: ['PAG', 'Pagos'], others: [], create: null, items: ['PAG', 'Pagos'] });
  assert.deepEqual(matchProjects(['Café', 'Alpha'], 'cafe'), { matches: ['Café'], others: ['Alpha'], create: 'cafe', items: ['Café', 'Alpha', 'cafe'] });
  assert.deepEqual(matchProjects(['Café', 'Alpha'], 'CAFE\u0301'), { matches: ['Café'], others: ['Alpha'], create: null, items: ['Café', 'Alpha'] });
  assert.deepEqual(matchProjects(['Alpha'], ' '), { matches: ['Alpha'], others: [], create: null, items: ['Alpha'] });
  for (const query of ['a\nname', 'x'.repeat(81), '\ud800']) assert.equal(matchProjects([], query).create, null);
});

test('match highlighting preserves exact accents and text', () => {
  assert.deepEqual(matchSegments('Checkout · pagos', 'PAG'), [{ text: 'Checkout · ', match: false }, { text: 'pag', match: true }, { text: 'os', match: false }]);
  assert.deepEqual(matchSegments('Cafe\u0301 y café', 'café'), [{ text: 'Cafe\u0301', match: true }, { text: ' y café', match: false }]);
  assert.deepEqual(matchSegments('Café', 'none'), [{ text: 'Café', match: false }]);
});

test('link query and successful form controls select the same real IDs and metadata', () => {
  const items = [{ artifactId: 'b', title: 'Second', project: null }, { artifactId: 'a', title: 'First', project: 'Alpha' }];
  const url = new URL('https://panel.test/move?artifactId=b&artifactId=a&artifactId=b');
  const form = new FormData();
  form.append('artifactId', 'b'); form.append('artifactId', 'a'); form.append('artifactId', 'b');
  form.append('requestId', 'native-request');
  const expected = { artifactIds: ['a', 'b'], items: [items[1], items[0]] };
  assert.deepEqual(readMoveSelection(url.searchParams.getAll('artifactId'), JSON.stringify(items)), expected);
  assert.deepEqual(readMoveSelection(form.getAll('artifactId'), JSON.stringify(items)), expected);
  for (const [ids, data] of [[[], JSON.stringify(items)], [['missing'], JSON.stringify(items)], [['a'], 'broken'], [Array(26).fill('a'), JSON.stringify(items)]]) assert.equal(readMoveSelection(ids as string[], data as string), null);
});
