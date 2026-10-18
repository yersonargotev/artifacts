import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { test } from 'node:test';
import { transform, type Selector } from 'lightningcss';
import { projectTone, projectTones } from '../apps/dashboard/src/presentation.ts';

const sourceRoot = resolve('apps/dashboard/src');
const styleRoot = resolve(sourceRoot, 'styles');

test('project tones have stylesheet rules and ignore letter case', async () => {
  const tokens = await readFile(resolve(styleRoot, 'tokens.css'), 'utf8');
  for (const tone of projectTones) assert(tokens.includes(`[data-tone="${tone}"]`), `Missing project tone rule for ${tone}`);
  assert.equal(projectTone('Beta'), projectTone('beta'));
  assert.equal(projectTone('Beta'), 'maroon');
  assert.equal(projectTone('Éxito'), projectTone('ÉXITO'));
  assert.equal(projectTone('Éxito'), 'sky');
  assert.equal(new Set(projectTones).size, 8);
  assert(projectTones.every((tone) => !['green', 'yellow', 'mauve'].includes(tone)));
});
const effectPolicy = {
  '--glow-primary-fill': { property: 'background', subject: 'primary' },
  '--glow-primary': { property: 'box-shadow', subject: 'primary' },
  '--glow-active': { property: 'box-shadow', subject: 'active' },
  '--cover-wash': { property: 'background', subject: 'cover' },
  '--elevation-overlay': { property: 'box-shadow', subject: 'overlay' },
} as const;
type EffectToken = keyof typeof effectPolicy;
type Subject = typeof effectPolicy[EffectToken]['subject'];

function objects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(objects);
  if (value === null || typeof value !== 'object') return [];
  return [value as Record<string, unknown>, ...Object.values(value).flatMap(objects)];
}

function matchesSubject(selector: Selector, subject: Subject) {
  const lastCombinator = selector.findLastIndex((component) => component.type === 'combinator');
  const target = selector.slice(lastCombinator + 1);
  if (subject === 'overlay') return target.some((component) => (component.type === 'class' && ['artifact-menu', 'project-filter-links'].includes(component.name)) || (component.type === 'attribute' && component.name === 'data-slot' && component.operation?.operator === 'equal' && component.operation.value === 'dropdown-menu-content'));
  if (subject === 'active' && target.length === 2 && target[0].type === 'class' && target[0].name === 'artifact-card' && target[1].type === 'pseudo-class' && target[1].kind === 'has') {
    const checked = target[1].selectors;
    if (checked.length === 1 && checked[0].length === 2 && checked[0][0].type === 'type' && checked[0][0].name === 'input' && checked[0][1].type === 'pseudo-class' && checked[0][1].kind === 'checked') return true;
  }
  return target.some((component) => {
    if (subject === 'cover') return component.type === 'class' && component.name === 'project-cover';
    if (component.type !== 'attribute' || component.namespace) return false;
    if (subject === 'primary') return component.name === 'data-variant' && component.operation?.operator === 'equal' && component.operation.value === 'primary';
    return component.name === 'aria-current' || (['aria-selected', 'aria-pressed'].includes(component.name) && component.operation?.operator === 'equal' && component.operation.value === 'true');
  });
}

function stylesheetViolations(filename: string, source: string) {
  const issues: string[] = [];
  const tokensFile = filename === 'tokens.css';
  const lineOffsets = [0, ...source.matchAll(/\n/g)].map((match) => typeof match === 'number' ? match : match.index + 1);
  const rules: { selectors: Selector[]; label: string; line: number; offset: number }[] = [];
  transform({
    filename,
    code: Buffer.from(source),
    visitor: {
      Rule(rule) {
        const line = rule.type === 'style' ? rule.value.loc.line + 1 : 1;
        const offset = rule.type === 'style' ? lineOffsets[line - 1] + rule.value.loc.column - 1 : 0;
        rules.push({ selectors: rule.type === 'style' ? rule.value.selectors : [], label: rule.type === 'style' ? source.slice(offset).split('{')[0].trim() : `@${rule.type}`, line, offset });
      },
      RuleExit() { rules.pop(); },
      Declaration(declaration) {
        const rule = rules.at(-1)!;
        const property = declaration.property === 'unparsed' ? declaration.value.propertyId.property : declaration.property;
        const customName = declaration.property === 'custom' ? declaration.value.name : null;
        const propertyName = customName ?? property;
        const blockSource = source.slice(rule.offset).split('}')[0];
        const propertyOffset = blockSource.indexOf(`${propertyName}:`);
        const line = propertyOffset < 0 ? rule.line : rule.line + blockSource.slice(0, propertyOffset).split('\n').length - 1;
        const report = (message: string) => issues.push(`${filename}:${line} ${rule.label}: ${message}`);
        const nodes = objects(declaration.value);
        const variables = nodes.filter((node) => node.type === 'var').map((node) => (node.value as { name: { ident: string } }).name.ident);
        const effects = variables.filter((name) => name.startsWith('--glow-') || name.startsWith('--cover-') || name === '--elevation-overlay');
        const token = customName && Object.hasOwn(effectPolicy, customName) ? customName as EffectToken : null;
        const hasGradient = nodes.some((node) => node.type === 'gradient' || (node.type === 'function' && /gradient$/i.test((node.value as { name: string }).name)));
        const hasDropShadow = nodes.some((node) => node.type === 'drop-shadow' || (node.type === 'function' && (node.value as { name: string }).name === 'drop-shadow'));
        if (hasGradient && !(tokensFile && token && effectPolicy[token].property === 'background')) report(`${customName ?? property} contains a gradient outside its effect token`);
        if (hasDropShadow) report(`${property} contains a drop shadow`);
        if (customName?.startsWith('--glow-') || customName?.startsWith('--cover-') || customName === '--elevation-overlay') {
          if (!tokensFile || !token) report(`${customName} is not an approved token definition`);
        }
        for (const name of effects) {
          if (name !== '--elevation-overlay' && filename !== 'effects.css') report(`${name} is referenced outside effects.css`);
          const policy = effectPolicy[name as EffectToken];
          if (!policy || property !== policy.property || !(rule.selectors.length > 0 && rule.selectors.every((item) => matchesSubject(item, policy.subject)))) report(`${name} is used outside its allowed property or subject selector`);
        }
        if (property === 'box-shadow' || property === 'text-shadow') {
          const empty = declaration.property === 'unparsed' && declaration.value.value.length === 1 && declaration.value.value[0].type === 'token' && declaration.value.value[0].value.type === 'ident' && declaration.value.value[0].value.value === 'none';
          const allowed = property === 'box-shadow' && variables.length === 1 && Object.hasOwn(effectPolicy, variables[0]) && effectPolicy[variables[0] as EffectToken].property === 'box-shadow';
          const directToken = declaration.property === 'unparsed' && declaration.value.value.length === 1 && declaration.value.value[0].type === 'var' && !declaration.value.value[0].value.fallback;
          if (!empty && !(allowed && directToken)) report(`${property} must use one approved shadow token without a fallback`);
        }
      },
      Color(color) {
        if (!tokensFile && typeof color !== 'string' && color.type !== 'currentcolor' && !(color.type === 'rgb' && color.alpha === 0)) issues.push(`${filename}: literal color belongs in tokens.css`);
      },
    },
  });
  return issues;
}

function markupViolations(filename: string, source: string) {
  const issues: string[] = [];
  for (const match of source.matchAll(/\b(?:shadow|drop-shadow|ring|bg-linear|bg-radial|bg-conic|bg-gradient)(?:-[\w[\]/.%-]+)?\b/g)) issues.push(`${filename}: forbidden effect utility ${match[0]}`);
  for (const match of source.matchAll(/\b(?:boxShadow|textShadow|box-shadow|text-shadow)["']?\s*:/gi)) issues.push(`${filename}: forbidden inline shadow ${match[0]}`);
  for (const match of source.matchAll(/[\w-]*(?:gradient|drop-shadow)\s*\(/gi)) issues.push(`${filename}: forbidden inline effect ${match[0]}`);
  for (const match of source.matchAll(/--(?:glow|cover)-[\w-]+/g)) issues.push(`${filename}: effect token ${match[0]} belongs in effects.css`);
  return issues;
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? sourceFiles(resolve(directory, entry.name)) : [resolve(directory, entry.name)]))).flat();
}

test('panel styles and markup follow the effects policy', async () => {
  const files = await sourceFiles(sourceRoot);
  const issues = (await Promise.all(files.map(async (filename) => {
    const source = await readFile(filename, 'utf8');
    if (filename.startsWith(`${styleRoot}/`) && filename.endsWith('.css')) return stylesheetViolations(relative(styleRoot, filename), source);
    if (/\.(astro|tsx)$/.test(filename)) return markupViolations(relative(sourceRoot, filename), source);
    return [];
  }))).flat();
  assert.deepEqual(issues, []);
});

test('effect policy rejects stray gradients, shadows, aliases, and selector escapes', () => {
  for (const source of [
    '.sidebar-link { background: linear-gradient(red, blue) }',
    '.sidebar-link { box-shadow: 0 0 12px blue }',
    '.sidebar-link { box-shadow: var(--glow-primary) }',
    '.sidebar-link { box-shadow: var(--elevation-overlay) }',
    '.project-filter-links .sidebar-link { box-shadow: var(--elevation-overlay) }',
    '.project-filter-links, .sidebar-link { box-shadow: var(--elevation-overlay) }',
    '[data-variant="primary"] .sidebar-link { box-shadow: var(--glow-primary) }',
    '[data-variant="primary"], .sidebar-link { box-shadow: var(--glow-primary) }',
    '[aria-selected="false"] { box-shadow: var(--glow-active) }',
    '.sidebar-link { --wash: var(--cover-wash) }',
    '.sidebar-link { box-shadow: var(--elevation-overlay, 0 0 12px blue) }',
    '.sidebar-link { filter: drop-shadow(0 0 12px blue) }',
    '.sidebar-link { --wash: linear-gradient(red, blue) }',
    '@keyframes glow { to { box-shadow: 0 0 12px blue } }',
    '@keyframes wash { to { background: linear-gradient(red, blue) } }',
  ]) assert(stylesheetViolations('effects.css', source).length > 0, source);
  assert.match(stylesheetViolations('panel.css', '\n.sidebar-link { box-shadow: 0 0 12px blue }').join('\n'), /panel\.css:2 \.sidebar-link: box-shadow/);
  assert.match(stylesheetViolations('panel.css', '\n.sidebar-link { background: linear-gradient(red, blue) }').join('\n'), /panel\.css:2 \.sidebar-link: background contains a gradient/);
});

test('effect policy permits only scoped effect tokens and neutral overlay elevation', () => {
  assert.deepEqual(stylesheetViolations('effects.css', '[data-variant="primary"]:hover { background: var(--glow-primary-fill); box-shadow: var(--glow-primary) } [aria-current], [aria-selected="true"], [aria-pressed="true"] { box-shadow: var(--glow-active) } .project-cover { background: var(--cover-wash) }'), []);
  assert.deepEqual(stylesheetViolations('panel.css', '.artifact-menu { box-shadow: var(--elevation-overlay) }'), []);
  assert.deepEqual(stylesheetViolations('panel.css', '.project-filter-links { box-shadow: var(--elevation-overlay) }'), []);
});

test('selected card effects require the exact checked input subject', () => {
  assert.deepEqual(stylesheetViolations('effects.css', '.artifact-card:has(input:checked) { box-shadow: var(--glow-active) }'), []);
  for (const selector of [
    '.artifact-card:has(input)', '.artifact-card:has(input:not(:checked))', '.artifact-card:has(input:checked, a)',
    '.artifact-card:has(input:checked) .artifact-description', '.sidebar-link:has(input:checked)',
    '.artifact-card:has(.other:checked)', '.artifact-card:has(input:checked), .sidebar-link',
    '.artifact-card:has(input:checked, input)', '.artifact-card:has(input:checked) + .artifact-card',
  ]) assert(stylesheetViolations('effects.css', `${selector} { box-shadow: var(--glow-active) }`).length > 0, selector);
  for (const value of ['var(--glow-active, 0 0 12px blue)', 'var(--alias)', 'var(--glow-active) var(--glow-active)']) {
    assert(stylesheetViolations('effects.css', `.artifact-card:has(input:checked) { box-shadow: ${value} }`).length > 0, value);
  }
});

test('markup policy rejects effect utilities and inline shadows', () => {
  for (const utility of ['shadow-md', 'hover:shadow-xl', 'drop-shadow-lg', 'focus-visible:ring-2', 'bg-linear-to-r', 'bg-radial-at-t', 'bg-gradient-to-r']) assert(markupViolations('fixture.tsx', `<div className="${utility}" />`).length > 0, utility);
  for (const source of [
    '<div style="box-shadow: 0 0 4px blue" />',
    '<div style={{ boxShadow: "0 0 4px blue" }} />',
    '<div class="bg-[linear-gradient(var(--blue),var(--red))]" />',
    '<div class="[background:linear-gradient(var(--blue),var(--red))]" />',
    '<div className="hover:bg-[image:radial-gradient(var(--blue),var(--red))]" />',
    '<div className="[background-image:conic-gradient(var(--blue),var(--red))]" />',
    '<div class="bg-conic-180" />',
    '<div class="bg-[-webkit-gradient(linear,left_top,left_bottom,from(var(--blue)),to(var(--red)))]" />',
    '<div class="[filter:DROP-SHADOW(0_0_4px_var(--blue))]" />',
    '<div class="[BOX-SHADOW:0_0_4px_var(--blue)]" />',
    '<div class="bg-[var(--cover-wash)]" />',
    '<div className="bg-(--glow-primary-fill)" />',
    '<div className="[box-shadow:var(--glow-primary)]" />',
    '<div style={{ backgroundImage: "repeating-linear-gradient(var(--blue),var(--red))" }} />',
  ]) assert(markupViolations('fixture.tsx', source).length > 0, source);
  assert.deepEqual(markupViolations('fixture.astro', '<button data-variant="primary">Publicar</button>'), []);
});

function readerViolations(filename: string, source: string) {
  const issues: string[] = [];
  if (filename.startsWith('apps/dashboard/src/')) {
    for (const match of source.matchAll(/versión/gi)) issues.push(`${filename}:${source.slice(0, match.index).split('\n').length} publication copy must name a revision`);
  }
  if (!filename.startsWith('apps/dashboard/') && !filename.startsWith('tests/')) {
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']@artifacts\/artifacts\/panel(?:\/model)?["']/g)) issues.push(`${filename}: panel imports belong to the dashboard or tests`);
  }
  if (filename === 'packages/artifacts/src/panel/model.ts' && /(?:^|\n)\s*import\s+(?!type\b)/.test(source)) issues.push(`${filename}: panel model imports must be type-only`);
  if (filename.startsWith('apps/dashboard/src/components/') && filename.endsWith('.tsx') && /new\s+Date\s*\(|Date\.now\s*\(|toLocale/.test(source)) issues.push(`${filename}: islands must receive preformatted dates`);
  return issues;
}

test('panel revision copy and reader imports preserve the package boundary', async () => {
  const files = (await Promise.all(['apps', 'packages', 'scripts', 'tests'].map((directory) => sourceFiles(resolve(directory))))).flat();
  const issues = (await Promise.all(files.filter((filename) => /\.(?:astro|[cm]?[jt]sx?)$/.test(filename) && !filename.includes('/node_modules/')).map(async (filename) => readerViolations(relative(resolve('.'), filename), await readFile(filename, 'utf8'))))).flat();
  assert.deepEqual(issues, []);
});

test('reader policy rejects version labels, external imports, and runtime model imports', () => {
  assert.deepEqual(readerViolations('apps/dashboard/src/fixture.astro', '<p>Versión 2</p>\n<p>versión anterior</p>'), ['apps/dashboard/src/fixture.astro:1 publication copy must name a revision', 'apps/dashboard/src/fixture.astro:2 publication copy must name a revision']);
  for (const source of ["import { createPanel } from '@artifacts/artifacts/panel';", "import('@artifacts/artifacts/panel');", "import '@artifacts/artifacts/panel/model';"]) assert.deepEqual(readerViolations('apps/mcp/src/fixture.ts', source), ['apps/mcp/src/fixture.ts: panel imports belong to the dashboard or tests']);
  assert.deepEqual(readerViolations('apps/dashboard/src/fixture.ts', "import { createPanel } from '@artifacts/artifacts/panel';"), []);
  assert.deepEqual(readerViolations('packages/artifacts/src/panel/model.ts', "import { z } from 'zod';"), ['packages/artifacts/src/panel/model.ts: panel model imports must be type-only']);
  assert.deepEqual(readerViolations('packages/artifacts/src/panel/model.ts', "import type { Actor } from '../contracts.ts';"), []);
});

test('islands receive preformatted dates', () => {
  for (const source of ['new Date(value)', 'Date.now()', 'value.toLocaleString()']) assert.deepEqual(readerViolations('apps/dashboard/src/components/Fixture.tsx', source), ['apps/dashboard/src/components/Fixture.tsx: islands must receive preformatted dates']);
});
