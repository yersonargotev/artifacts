import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { test } from 'node:test';
import { transform, type Selector } from 'lightningcss';

const sourceRoot = resolve('apps/dashboard/src');
const styleRoot = resolve(sourceRoot, 'styles');
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
  if (subject === 'overlay') return true;
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
        const effects = variables.filter((name) => name.startsWith('--glow-') || name.startsWith('--cover-'));
        const token = customName && Object.hasOwn(effectPolicy, customName) ? customName as EffectToken : null;
        const hasGradient = nodes.some((node) => node.type === 'gradient' || (node.type === 'function' && /gradient$/i.test((node.value as { name: string }).name)));
        const hasDropShadow = nodes.some((node) => node.type === 'drop-shadow' || (node.type === 'function' && (node.value as { name: string }).name === 'drop-shadow'));
        if (hasGradient && !(tokensFile && token && effectPolicy[token].property === 'background')) report(`${customName ?? property} contains a gradient outside its effect token`);
        if (hasDropShadow) report(`${property} contains a drop shadow`);
        if (customName?.startsWith('--glow-') || customName?.startsWith('--cover-') || customName === '--elevation-overlay') {
          if (!tokensFile || !token) report(`${customName} is not an approved token definition`);
        }
        for (const name of effects) {
          if (filename !== 'effects.css') report(`${name} is referenced outside effects.css`);
          const policy = effectPolicy[name as EffectToken];
          if (!policy || property !== policy.property || !(rule.selectors.length > 0 && rule.selectors.every((item) => matchesSubject(item, policy.subject)))) report(`${name} is used outside its allowed property or subject selector`);
        }
        if (property === 'box-shadow' || property === 'text-shadow') {
          const empty = declaration.property === 'unparsed' && declaration.value.value.length === 1 && declaration.value.value[0].type === 'token' && declaration.value.value[0].value.type === 'ident' && declaration.value.value[0].value.value === 'none';
          const allowed = property === 'box-shadow' && variables.length === 1 && Object.hasOwn(effectPolicy, variables[0]) && effectPolicy[variables[0] as EffectToken].property === 'box-shadow' && (variables[0] !== '--elevation-overlay' || filename !== 'tokens.css');
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
  for (const match of source.matchAll(/\b(?:shadow|drop-shadow|bg-linear|bg-radial|bg-gradient)(?:-[\w[\]/.%-]+)?\b/g)) issues.push(`${filename}: forbidden effect utility ${match[0]}`);
  for (const match of source.matchAll(/\b(?:boxShadow|textShadow|box-shadow|text-shadow)["']?\s*:/g)) issues.push(`${filename}: forbidden inline shadow ${match[0]}`);
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
});

test('markup policy rejects effect utilities and inline shadows', () => {
  for (const utility of ['shadow-md', 'hover:shadow-xl', 'drop-shadow-lg', 'bg-linear-to-r', 'bg-radial-at-t', 'bg-gradient-to-r']) assert(markupViolations('fixture.tsx', `<div className="${utility}" />`).length > 0, utility);
  for (const source of ['<div style="box-shadow: 0 0 4px blue" />', '<div style={{ boxShadow: "0 0 4px blue" }} />']) assert(markupViolations('fixture.tsx', source).length > 0, source);
  assert.deepEqual(markupViolations('fixture.astro', '<button data-variant="primary">Publicar</button>'), []);
});
