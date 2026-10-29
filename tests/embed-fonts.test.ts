import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../skills/artifacts-design/scripts/embed-fonts.mjs', import.meta.url));
const managed = /<style data-artifacts-fonts>[\s\S]*?<\/style>\n?/g;
const publicSans = '<style>body { font-family: "Public Sans", sans-serif }</style>';
const fixtures: { name: string; html: string; expectedFaces: string[] }[] = [
  { name: 'a declared family', html: publicSans, expectedFaces: ['Public Sans normal'] },
  {
    name: 'an HTML license comment does not select a family',
    html: `${publicSans}\n<!-- Copyright 2020 The Newsreader Project Authors -->`,
    expectedFaces: ['Public Sans normal'],
  },
  {
    name: 'a CSS comment does not select a family or italic faces',
    html: '<style>/* font-family: Newsreader; font-style: italic */ body { font-family: "Public Sans" }</style>',
    expectedFaces: ['Public Sans normal'],
  },
  {
    name: 'content and JavaScript strings do not select families or italic faces',
    html: `${publicSans}<p>Newsreader</p><script>const example = '<em style="font-family: Newsreader; font-style: italic">Example</em>';</script>`,
    expectedFaces: ['Public Sans normal'],
  },
  {
    name: 'unrelated CSS strings and unused custom properties do not select families',
    html: '<style>:root { --license: "Newsreader" } body { font-family: "Public Sans" } body::after { content: "Newsreader font-style: italic" }</style>',
    expectedFaces: ['Public Sans normal'],
  },
  {
    name: 'font shorthand follows referenced custom properties',
    html: '<style>:root { --body: var(--family); --family: "Public Sans", sans-serif } body { font: 15px/1.5 var(--body) }</style>',
    expectedFaces: ['Public Sans normal'],
  },
  {
    name: 'font-family follows a custom property fallback',
    html: '<style>body { font-family: var(--missing, "Newsreader", serif) }</style>',
    expectedFaces: ['Newsreader normal'],
  },
  {
    name: 'cyclic custom properties terminate and retain a font fallback',
    html: '<style>:root { --a: var(--b); --b: var(--a) } body { font-family: var(--a, "Public Sans") }</style>',
    expectedFaces: ['Public Sans normal'],
  },
  {
    name: 'inline style attributes select families',
    html: '<p style="font-family: \'Public Sans\', sans-serif">Hello</p>',
    expectedFaces: ['Public Sans normal'],
  },
  {
    name: 'encoded inline CSS quotes and greater-than signs stay inside attributes',
    html: '<p title=\'Example > <em>Newsreader</em>\' style="font-family: &quot;Public Sans&quot;, sans-serif">Hello</p>',
    expectedFaces: ['Public Sans normal'],
  },
  {
    name: 'raw text examples do not become style declarations or italic elements',
    html: `${publicSans}<textarea><style>p{font-family:Newsreader;font-style:italic}</style><em>Example</em></textarea><script>const example = '<style>p{font-family:Newsreader}</style>';</script>`,
    expectedFaces: ['Public Sans normal'],
  },
  {
    name: 'italic CSS declarations select italic faces',
    html: '<style>body { font-family: "Public Sans"; font-style: italic }</style>',
    expectedFaces: ['Public Sans normal', 'Public Sans italic'],
  },
  {
    name: 'italic font shorthand selects italic faces',
    html: '<style>body { font: italic 16px "Newsreader", serif }</style>',
    expectedFaces: ['Newsreader normal', 'Newsreader italic'],
  },
  {
    name: 'inline italic styles select italic faces',
    html: '<p style="font-family: \'Public Sans\'; font-style: italic">Hello</p>',
    expectedFaces: ['Public Sans normal', 'Public Sans italic'],
  },
  {
    name: 'commented examples do not select italic faces',
    html: `${publicSans}<!-- <em>Example</em><i>Example</i><cite>Example</cite> font-style: italic -->`,
    expectedFaces: ['Public Sans normal'],
  },
  ...['em', 'i', 'cite'].map((tag) => ({
    name: `a real ${tag} element selects italic faces`,
    html: `${publicSans}<${tag}>Hello</${tag}>`,
    expectedFaces: ['Public Sans normal', 'Public Sans italic'],
  })),
  {
    name: 'family names must match complete family names',
    html: '<style>body { font-family: "Newsreader Display", serif }</style>',
    expectedFaces: [],
  },
];

function run(path: string) {
  const result = spawnSync(process.execPath, [script, path], { encoding: 'utf8', timeout: 10_000 });
  assert.ifError(result.error);
  return result;
}

function embeddedFaces(html: string): string[] {
  const block = html.match(managed)?.join('') ?? '';
  return Array.from(block.matchAll(/font-family:"([^"]+)";font-style:(normal|italic)/g), (match) => `${match[1]} ${match[2]}`);
}

for (const fixture of fixtures) {
  test(`font embedder ${fixture.name}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'artifacts-embed-fonts-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'page.html');
    await writeFile(path, fixture.html);

    const result = run(path);
    assert.equal(result.status, 0, result.stderr);
    const output = await readFile(path, 'utf8');
    assert.deepEqual(embeddedFaces(output), fixture.expectedFaces);
    assert.equal(output.replace(managed, ''), fixture.html);
  });
}

test('font embedder selects the starter families through its font variables', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-embed-fonts-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'page.html');
  const starter = await readFile(new URL('../skills/artifacts-design/templates/starter.html', import.meta.url), 'utf8');
  await writeFile(path, starter);
  const result = run(path);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(embeddedFaces(await readFile(path, 'utf8')), ['Bricolage Grotesque normal', 'Public Sans normal', 'JetBrains Mono normal']);
});

test('font embedder replaces stale faces and remains byte-identical on a second run', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-embed-fonts-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'page.html');
  const license = '<!-- Copyright 2020 The Newsreader Project Authors -->\n';
  const html = `${license}${publicSans}`;
  await writeFile(path, '<style>body { font-family: "Newsreader" }</style>');
  assert.equal(run(path).status, 0);
  const oldBlock = (await readFile(path, 'utf8')).match(managed)![0];
  await writeFile(path, oldBlock + html);

  assert.equal(run(path).status, 0);
  const first = await readFile(path, 'utf8');
  assert.deepEqual(embeddedFaces(first), ['Public Sans normal']);
  assert.equal(first.match(managed)?.length, 1);
  assert.equal(first.replace(managed, ''), html);
  assert.equal(run(path).status, 0);
  assert.equal(await readFile(path, 'utf8'), first);
});

test('font embedder refuses output above 1 MiB without changing the input', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-embed-fonts-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'page.html');
  const html = publicSans + 'x'.repeat(1024 * 1024 - Buffer.byteLength(publicSans) - 1);
  await writeFile(path, html);
  const result = run(path);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /above the 1 MiB revision limit/);
  assert.equal(await readFile(path, 'utf8'), html);
});

test('font embedder runs from a copied skill directory without installed dependencies', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'artifacts-embed-standalone-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const skill = join(directory, 'artifacts-design');
  await cp(new URL('../skills/artifacts-design/', import.meta.url), skill, { recursive: true });
  const path = join(directory, 'page.html');
  await writeFile(path, publicSans);
  const result = spawnSync(process.execPath, [join(skill, 'scripts/embed-fonts.mjs'), path], {
    cwd: directory, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(embeddedFaces(await readFile(path, 'utf8')), ['Public Sans normal']);
});
