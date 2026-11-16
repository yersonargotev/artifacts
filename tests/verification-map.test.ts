import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const skill = '.agents/skills/verify-artifacts';
const map = `${skill}/features/README.md`;
const runner = 'scripts/browser-proofs.ts';

const notInRunner: Record<string, string> = {
  'tests/rest-cli.browser.proof.ts': 'CI runs it as its own step after the Chrome proof shards.',
  'tests/local-html.browser.proof.ts': '`pnpm test:local-html` runs it outside CI.',
  'tests/owner-access.browser.proof.ts': '`pnpm test:owner-access:browser` runs it outside CI.',
  'tests/invitation-plain.browser.proof.ts': 'A parent and head comparison from #47; tests/invitations.test.ts and panel-share cover its checks.',
};

const read = (path: string) => readFileSync(path, 'utf8');
const runnerFiles = () => [...read(runner).matchAll(/file: '([^']+)'/g)].map((match) => match[1]!);
const featureFiles = () => readdirSync(`${skill}/features`).filter((name) => name.endsWith('.md') && name !== 'README.md');

function drives() {
  const list = read(`${skill}/scripts/control.ts`).match(/const features = \[([^\]]*)\] as const/)?.[1];
  assert(list, `${skill}/scripts/control.ts no longer declares \`const features = [...] as const\`. Update this test to read the drive list.`);
  return [...list.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
}

test('every control.ts drive has a feature file and a map entry', () => {
  const index = read(map);
  const problems = drives().flatMap((drive) => [
    ...(existsSync(`${skill}/features/${drive}.md`) ? [] : [`Drive \`${drive}\` has no ${skill}/features/${drive}.md. Add the recipe.`]),
    ...(index.includes(`(./${drive}.md): \`${drive}\``) ? [] : [`Drive \`${drive}\` has no entry in ${map}. Add \`- [Title](./${drive}.md): \`${drive}\` covers ...\` under ## Features.`]),
  ]);
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('every feature file is in the map', () => {
  const index = read(map);
  const problems = featureFiles().filter((name) => !index.includes(`(./${name})`)).map((name) => `${skill}/features/${name} is not linked from ${map}. Add \`- [Title](./${name}): ...\` under ## Features.`);
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('every Chrome proof runs in CI or says why not', () => {
  const listed = new Set(runnerFiles());
  const proofs = readdirSync('tests').filter((name) => name.endsWith('.browser.proof.ts')).map((name) => `tests/${name}`);
  const problems = [
    ...proofs.filter((file) => !listed.has(file) && !(file in notInRunner)).map((file) => `${file} runs nowhere. Add \`{ file: '${file}', seconds: N }\` to ${runner}, or add it to notInRunner in tests/verification-map.test.ts with a one-line reason.`),
    ...Object.keys(notInRunner).filter((file) => !proofs.includes(file)).map((file) => `${file} is in notInRunner but no longer exists. Remove its entry from tests/verification-map.test.ts.`),
    ...Object.keys(notInRunner).filter((file) => listed.has(file)).map((file) => `${file} is in ${runner} and in notInRunner. Remove its notInRunner entry from tests/verification-map.test.ts.`),
  ];
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('every CI Chrome proof has a feature file', () => {
  const recipes = featureFiles().map((name) => read(`${skill}/features/${name}`)).join('\n');
  const problems = runnerFiles().filter((file) => !recipes.includes(file)).map((file) => `${file} runs in ${runner} but no ${skill}/features/*.md names it. Name it in the feature file it proves, or add a feature file and link it from ${map}.`);
  assert.deepEqual(problems, [], problems.join('\n'));
});
