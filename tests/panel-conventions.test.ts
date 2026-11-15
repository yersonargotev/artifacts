import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { test } from 'node:test';
import { transform, type Selector } from 'lightningcss';
import { projectTone, projectTones } from '../apps/dashboard/src/presentation.ts';
import { themeColors, themes } from '../apps/dashboard/src/theme.ts';

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
  '--accent-fill': { property: 'background', subject: 'primary' },
  '--cover-wash': { property: 'background', subject: 'cover' },
  '--shadow-1': { property: 'box-shadow', subject: 'document' },
  '--shadow-2': { property: 'box-shadow', subject: 'overlay' },
} as const;
type EffectToken = keyof typeof effectPolicy;
type Subject = typeof effectPolicy[EffectToken]['subject'];
const isEffectToken = (name: string) => Object.hasOwn(effectPolicy, name) || /^--(?:cover|shadow)-/.test(name);
const isShadowToken = (name: string) => name.startsWith('--shadow-');
const scales = {
  'font-size': ['--text-2xs', '--text-xs', '--text-sm', '--text-md', '--text-lg', '--text-xl', '--text-2xl'],
  'border-radius': ['--r-sm', '--r-md', '--r-lg', '--r-full'],
  motion: ['--dur-1', '--dur-2', '--dur-3', '--ease-out', '--ease-in-out'],
};
const scaleValues = {
  '--text-2xs': '11px', '--text-xs': '12px', '--text-sm': '13px', '--text-md': '14px', '--text-lg': '16px', '--text-xl': '20px', '--text-2xl': '28px',
  '--r-sm': '6px', '--r-md': '8px', '--r-lg': '12px', '--r-full': '999px',
  '--dur-1': '90ms', '--dur-2': '160ms', '--dur-3': '260ms', '--ease-out': 'cubic-bezier(.2, .8, .2, 1)', '--ease-in-out': 'cubic-bezier(.4, 0, .2, 1)',
};
const fontTokens = ['--font-sans', '--font-mono'];
const fontKeywords = new Set(['inherit', 'normal', 'italic', 'bold']);
const crossOrigin = (url: string) => /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url);
const radiusProperties = new Set(['border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius']);
const motionProperties = new Set(['transition', 'transition-duration', 'transition-timing-function', 'transition-delay', 'animation', 'animation-duration', 'animation-timing-function', 'animation-delay']);

function objects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(objects);
  if (value === null || typeof value !== 'object') return [];
  return [value as Record<string, unknown>, ...Object.values(value).flatMap(objects)];
}

function matchesSubject(selector: Selector, subject: Subject) {
  const lastCombinator = selector.findLastIndex((component) => component.type === 'combinator');
  const target = selector.slice(lastCombinator + 1);
  return target.some((component) => {
    if (subject === 'cover') return component.type === 'class' && component.name === 'project-cover';
    if (subject === 'document') return component.type === 'class' && component.name === 'reader-document';
    if (subject === 'overlay') return (component.type === 'class' && ['artifact-menu', 'choice-list', 'rail-panel', 'dialog-content', 'combobox-content'].includes(component.name)) || (component.type === 'attribute' && component.name === 'data-slot' && component.operation?.operator === 'equal' && component.operation.value === 'dropdown-menu-content');
    return (component.type === 'class' && component.name === 'rail-brand') || (component.type === 'attribute' && !component.namespace && component.name === 'data-variant' && component.operation?.operator === 'equal' && component.operation.value === 'primary');
  });
}

function scaleViolation(property: string, declaration: { property: string; value: unknown }, variables: string[], nodes: Record<string, unknown>[]) {
  const lengths = nodes.filter((node) => node.type === 'length' || node.type === 'dimension' || (node.type === 'token' && (node.value as { type?: string })?.type === 'dimension'));
  if (property === 'font-size' || property === 'font') {
    if (declaration.property !== 'unparsed') return 'must use a --text-* size step';
    const keyword = nodes.some((node) => node.type === 'ident' && ['inherit', 'unset', 'initial'].includes(node.value as string));
    if (!variables.length && !keyword) return 'must use a --text-* size step';
    if (variables.some((name) => !scales['font-size'].includes(name) && !(property === 'font' && fontTokens.includes(name)))) return 'uses a size outside the --text-* scale';
    if (lengths.some((node) => (node.value as { unit?: string }).unit !== 'vw')) return 'mixes a literal length into a scale size';
  }
  if (radiusProperties.has(property)) {
    if (declaration.property !== 'unparsed') {
      const values = objects(declaration.value).filter((node) => node.type === 'dimension' || node.type === 'percentage');
      if (values.some((node) => node.type === 'percentage' ? node.value !== 0.5 : (node.value as { value: number }).value !== 0)) return 'must use an --r-* radius step, 0, or 50%';
      return null;
    }
    if (!variables.length || variables.some((name) => !scales['border-radius'].includes(name))) return 'must use an --r-* radius step, 0, or 50%';
    if (lengths.length || nodes.some((node) => node.type === 'token' && (node.value as { type?: string; value?: number }).type === 'number' && (node.value as { value: number }).value !== 0)) return 'mixes a literal length into a radius step';
  }
  if (motionProperties.has(property)) {
    if (declaration.property !== 'unparsed') {
      const timed = objects(declaration.value).some((node) => (node.type === 'seconds' || node.type === 'milliseconds') && node.value !== 0);
      return timed ? 'must take durations and easings from the motion tokens' : null;
    }
    if (variables.some((name) => !scales.motion.includes(name)) || nodes.some((node) => node.type === 'time') || lengths.some((node) => /^m?s$/.test(String((node.value as { unit?: string }).unit)))) return 'must take durations and easings from the motion tokens';
    if (nodes.some((node) => (node.type === 'function' && /^(?:cubic-bezier|steps|linear)$/.test((node.value as { name: string }).name)) || (node.type === 'ident' && /^(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$/.test(node.value as string)))) return 'must take durations and easings from the motion tokens';
  }
  return null;
}

function familyViolation(declaration: { property: string; value: unknown }, variables: string[], nodes: Record<string, unknown>[]) {
  if (declaration.property === 'font-family') return JSON.stringify(declaration.value) === '["inherit"]' ? null : 'must take its family from --font-sans or --font-mono';
  const words = nodes.filter((node) => node.type === 'token' && ['ident', 'string'].includes((node.value as { type: string }).type)).map((node) => node.value as { type: string; value: string });
  const literal = words.some((word) => word.type === 'string' || !fontKeywords.has(word.value));
  if (!literal && !variables.length && words.some((word) => word.value === 'inherit')) return null;
  if (literal || variables.filter((name) => fontTokens.includes(name)).length !== 1 || variables.some((name) => name.startsWith('--font-') && !fontTokens.includes(name))) return 'must take its family from --font-sans or --font-mono';
  return null;
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
        if (rule.type === 'import' && crossOrigin(rule.value.url)) issues.push(`${filename}: @import ${rule.value.url} leaves the panel origin`);
        if (!tokensFile && rule.type === 'media' && JSON.stringify(rule.value.query).includes('"prefers-color-scheme"')) issues.push(`${filename}: a color scheme query belongs in tokens.css`);
        if (!tokensFile && rule.type === 'style' && objects(rule.value.selectors).some((component) => component.type === 'attribute' && component.name === 'data-theme')) issues.push(`${filename}:${line} ${rules.at(-1)!.label}: a theme selector belongs in tokens.css`);
        if (rule.type === 'font-face' && filename !== 'fonts.css') issues.push(`${filename}: @font-face belongs in fonts.css`);
      },
      Url(url) {
        if (crossOrigin(url.url)) issues.push(`${filename}: url(${url.url}) leaves the panel origin`);
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
        const effects = variables.filter(isEffectToken);
        const token = customName && Object.hasOwn(effectPolicy, customName) ? customName as EffectToken : null;
        const hasGradient = nodes.some((node) => node.type === 'gradient' || (node.type === 'function' && /gradient$/i.test((node.value as { name: string }).name)));
        const hasDropShadow = nodes.some((node) => node.type === 'drop-shadow' || (node.type === 'function' && (node.value as { name: string }).name === 'drop-shadow'));
        if ([customName, ...variables].some((name) => name && /glow/i.test(name))) report(`${customName ?? property} names a glow token; current and selected items use the side indicator`);
        if (hasGradient && !(tokensFile && token && effectPolicy[token].property === 'background')) report(`${customName ?? property} contains a gradient outside its effect token`);
        if (hasDropShadow) report(`${property} contains a drop shadow`);
        if (customName?.startsWith('--font-') && !tokensFile) report(`${customName} is defined outside tokens.css`);
        if (!customName && (property === 'font-family' || property === 'font')) {
          const problem = familyViolation(declaration, variables, nodes);
          if (problem) report(`${property} ${problem}`);
        }
        if (customName && isEffectToken(customName)) {
          if (!tokensFile || !token) report(`${customName} is not an approved token definition`);
        }
        for (const name of effects) {
          if (!isShadowToken(name) && filename !== 'effects.css') report(`${name} is referenced outside effects.css`);
          const policy = effectPolicy[name as EffectToken];
          if (!policy || property !== policy.property || !(rule.selectors.length > 0 && rule.selectors.every((item) => matchesSubject(item, policy.subject)))) report(`${name} is used outside its allowed property or subject selector`);
        }
        if (property === 'box-shadow' || property === 'text-shadow') {
          const empty = declaration.property === 'unparsed' && declaration.value.value.length === 1 && declaration.value.value[0].type === 'token' && declaration.value.value[0].value.type === 'ident' && declaration.value.value[0].value.value === 'none';
          const allowed = property === 'box-shadow' && variables.length === 1 && isShadowToken(variables[0]) && Object.hasOwn(effectPolicy, variables[0]);
          const directToken = declaration.property === 'unparsed' && declaration.value.value.length === 1 && declaration.value.value[0].type === 'var' && !declaration.value.value[0].value.fallback;
          if (!empty && !(allowed && directToken)) report(`${property} must use one shadow token without a fallback`);
        }
        if (!customName) {
          const problem = scaleViolation(property, declaration, variables, nodes);
          if (problem) report(`${property} ${problem}`);
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
  for (const match of source.matchAll(/--(?:(?:glow|cover|shadow)-[\w-]+|accent-fill(?![\w-]))/g)) issues.push(`${filename}: effect token ${match[0]} belongs in the stylesheets`);
  for (const [utility] of source.matchAll(/(?<![\w-])text-[\w[\]().%/-]+/g)) if (/^text-(?:base|\d*xl|xs|sm|md|lg|\[.*\]|\(.*\))$/.test(utility) && !/^text-(?:2xs|xs|sm|md|lg|xl|2xl)$/.test(utility)) issues.push(`${filename}: font size ${utility} is outside the type scale`);
  for (const [utility] of source.matchAll(/(?<![\w-])rounded(?:-[\w[\]().%/-]+)?(?![\w-])/g)) if (!/^rounded(?:-(?:[trbl]|tl|tr|br|bl|[se]|ss|se|es|ee))?-(?:sm|md|lg|full|none)$/.test(utility)) issues.push(`${filename}: radius ${utility} is outside the radius scale`);
  for (const match of source.matchAll(/\b(?:fontSize|font-size|fontFamily|font-family|borderRadius|border-radius)["']?\s*:/gi)) issues.push(`${filename}: inline ${match[0]} bypasses the scales`);
  for (const [utility] of source.matchAll(/(?<![\w-])dark:[\w[\]-]+/g)) issues.push(`${filename}: ${utility} branches on the theme outside tokens.css`);
  for (const [utility] of source.matchAll(/(?<![\w-])(?:bg|text|border|outline|fill|stroke|decoration|accent|caret|placeholder|from|via|to|divide)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+|\[(?:#|rgb|hsl|oklch|color)[^\]]*\])(?:\/\d+)?(?![\w-])/g)) issues.push(`${filename}: literal color ${utility} belongs in tokens.css`);
  for (const match of source.matchAll(/\b(?:color|background(?:-color)?|backgroundColor|border-color|borderColor)["']?\s*:\s*["']?(?:#[\da-f]{3,8}\b|(?:rgb|hsl|oklch)a?\()/gi)) issues.push(`${filename}: inline literal color ${match[0]} belongs in tokens.css`);
  for (const [tag] of source.matchAll(/<link\b[^>]*>/gi)) if (!/\brel=["']icon["']/i.test(tag) || !/\bhref=["']\/(?!\/)/i.test(tag)) issues.push(`${filename}: ${tag} loads a resource outside the panel stylesheets`);
  return issues;
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? sourceFiles(resolve(directory, entry.name)) : [resolve(directory, entry.name)]))).flat();
}

test('panel styles and markup follow the effects and scale policy', async () => {
  const files = await sourceFiles(sourceRoot);
  const issues = (await Promise.all(files.map(async (filename) => {
    const source = await readFile(filename, 'utf8');
    if (filename.startsWith(`${styleRoot}/`) && filename.endsWith('.css')) return stylesheetViolations(relative(styleRoot, filename), source);
    if (/\.(astro|tsx)$/.test(filename)) {
      const styles = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].flatMap((match) => stylesheetViolations(relative(sourceRoot, filename), match[1]));
      return [...styles, ...markupViolations(relative(sourceRoot, filename), source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, ''))];
    }
    return [];
  }))).flat();
  assert.deepEqual(issues, []);
});

test('tokens define the type, radius, and motion scales and the reduced-motion rule removes all motion', async () => {
  const tokens = await readFile(resolve(styleRoot, 'tokens.css'), 'utf8');
  const defined = Object.fromEntries([...tokens.matchAll(/(--(?:text-\d?x?[sml]\w*|r-\w+|dur-\d|ease-[\w-]+)):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
  assert.deepEqual(defined, scaleValues);
  const panel = await readFile(resolve(styleRoot, 'panel.css'), 'utf8');
  assert.match(panel, /@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{[^}]*transition: none !important;[^}]*animation: none !important;/);
});

function themeBlocks(tokens: string) {
  const declarations = (body: string) => Object.fromEntries([...body.matchAll(/(--[\w-]+|color-scheme):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]));
  return {
    root: declarations(tokens.match(/^:root \{([^}]*)\}/m)![1]!),
    ...Object.fromEntries(themes.map((theme) => [theme, declarations(tokens.match(new RegExp(`^\\[data-theme="${theme}"\\] \\{([^}]*)\\}`, 'm'))?.[1] ?? '')])),
  } as Record<'root' | typeof themes[number], Record<string, string>>;
}

test('both themes define the same tokens, their color scheme, and the browser theme color', async () => {
  const blocks = themeBlocks(await readFile(resolve(styleRoot, 'tokens.css'), 'utf8'));
  const names = (theme: typeof themes[number]) => Object.keys(blocks[theme]).sort();
  assert(names('dark').length > 20, 'the dark block defines the theme tokens');
  assert.deepEqual(names('light'), names('dark'));
  for (const theme of themes) {
    assert.equal(blocks[theme]['color-scheme'], theme);
    assert.equal(blocks[theme]['--bg'], themeColors[theme], `the ${theme} theme-color meta matches --bg`);
  }
  assert.deepEqual(Object.keys(blocks.root).filter((name) => Object.hasOwn(blocks.dark, name)), [], 'a token defined per theme has no shared :root value');
});

test('theme and color policy keeps theme branches and literal colors in tokens.css', () => {
  for (const source of ['.rail-link { color: #fff }', '.rail-link { background: rgb(0 0 0 / .5) }', '.rail-link { border-color: white }', '[data-theme="light"] .rail-link { color: var(--text) }', '@media (prefers-color-scheme: light) { .rail-link { color: var(--text) } }']) {
    assert(stylesheetViolations('panel.css', source).length > 0, source);
    assert(stylesheetViolations('components/Fixture.astro', source).length > 0, source);
  }
  assert.deepEqual(stylesheetViolations('tokens.css', '[data-theme="light"] { --text: #32354d } @media (prefers-color-scheme: light) { :root { --x: 1px } }'), []);
  assert.deepEqual(stylesheetViolations('panel.css', '.rail-link { color: var(--text); background: transparent; border-color: currentColor }'), []);
  for (const source of ['<div className="dark:bg-muted" />', '<div className="bg-white" />', '<div class="text-black/50" />', '<div className="bg-red-500" />', '<div class="border-[#ccd0da]" />', '<div className="fill-[rgb(0,0,0)]" />', '<div style="color: #fff" />', '<div style={{ backgroundColor: "rgb(0 0 0)" }} />']) assert(markupViolations('fixture.tsx', source).length > 0, source);
  assert.deepEqual(markupViolations('fixture.tsx', '<div className="bg-transparent border-transparent text-foreground bg-muted hover:bg-muted/80 text-muted-foreground" />'), []);
});

test('effect policy rejects glow, stray gradients, shadows, aliases, and selector escapes', () => {
  for (const source of [
    '.rail-link { background: linear-gradient(red, blue) }',
    '.rail-link { box-shadow: 0 0 12px blue }',
    '.rail-link { box-shadow: var(--shadow-2) }',
    '.choice-list .rail-link { box-shadow: var(--shadow-2) }',
    '.choice-list, .rail-link { box-shadow: var(--shadow-2) }',
    '.artifact-menu { box-shadow: var(--shadow-1) }',
    '.preview { box-shadow: var(--shadow-1) }',
    '[aria-current] { box-shadow: var(--glow-active) }',
    '[data-variant="primary"] { box-shadow: var(--glow-primary) }',
    '.rail-link { --glow: 0 0 12px blue }',
    '.rail-link { box-shadow: inset 3px 0 0 var(--accent) }',
    '.rail-link { --wash: var(--cover-wash) }',
    '.rail-link { background: var(--accent-fill) }',
    '[data-variant="primary"] .rail-link { background: var(--accent-fill) }',
    '.rail-link { --accent-fill: red }',
    '.rail-link { --shadow-3: 0 0 12px blue }',
    '.artifact-menu { box-shadow: var(--shadow-2, 0 0 12px blue) }',
    '.rail-link { filter: drop-shadow(0 0 12px blue) }',
    '.rail-link { --wash: linear-gradient(red, blue) }',
    '@keyframes glow { to { box-shadow: 0 0 12px blue } }',
    '@keyframes wash { to { background: linear-gradient(red, blue) } }',
  ]) assert(stylesheetViolations('effects.css', source).length > 0, source);
  assert.match(stylesheetViolations('panel.css', '\n.rail-link { box-shadow: 0 0 12px blue }').join('\n'), /panel\.css:2 \.rail-link: box-shadow/);
  assert.match(stylesheetViolations('panel.css', '\n.rail-link { background: linear-gradient(red, blue) }').join('\n'), /panel\.css:2 \.rail-link: background contains a gradient/);
});

test('effect policy permits scoped effect tokens and shadow tokens on their subjects', () => {
  assert.deepEqual(stylesheetViolations('effects.css', '[data-variant="primary"]:hover { background: var(--accent-fill) } .rail-brand { background: var(--accent-fill) } .project-cover { background: var(--cover-wash) } .rail-link[aria-current]::before { background: var(--accent) }'), []);
  for (const selector of ['.artifact-menu', '.choice-list', '.rail-panel', '.dialog-content', '.combobox-content', '[data-slot=dropdown-menu-content]']) assert.deepEqual(stylesheetViolations('panel.css', `${selector} { box-shadow: var(--shadow-2) }`), [], selector);
  assert.deepEqual(stylesheetViolations('panel.css', '.reader-document { box-shadow: var(--shadow-1) }'), []);
  assert.notDeepEqual(stylesheetViolations('panel.css', '.reader-pane { box-shadow: var(--shadow-1) }'), [], 'the reader pane holds the header and the document card, so only the card takes the document shadow');
  assert.deepEqual(stylesheetViolations('panel.css', '.rail-link { box-shadow: none }'), []);
});

test('scale policy accepts only scale steps for sizes, radii, and motion', () => {
  for (const declaration of [
    'font-size: var(--text-sm)', 'font: var(--text-md)/1.5 var(--font-sans)', 'font: inherit', 'font-size: clamp(var(--text-xl), 6vw, var(--text-2xl))',
    'border-radius: var(--r-md)', 'border-radius: var(--r-lg) var(--r-lg) 0 0', 'border-radius: 50%', 'border-radius: 0',
    'transition: color var(--dur-1) var(--ease-out), transform var(--dur-2) var(--ease-in-out)', 'transition: none', 'animation: none',
  ]) assert.deepEqual(stylesheetViolations('panel.css', `.rail-link { ${declaration} }`), [], declaration);
  for (const declaration of [
    'font-size: 13px', 'font-size: 1rem', 'font: 12px/1.6 var(--font-mono)', 'font-size: var(--text-3xl)', 'font-size: calc(var(--text-sm) + 1px)', 'font-size: clamp(36px, 6vw, 54px)',
    'border-radius: 4px', 'border-radius: 30%', 'border-radius: var(--r-xl)', 'border-radius: var(--r-md) 4px', 'border-top-left-radius: 3px',
    'transition: color 90ms ease', 'transition: color var(--dur-1) ease-in', 'transition: color 200ms var(--ease-out)', 'transition-duration: .2s', 'animation: spin 1s linear infinite', 'transition: color var(--dur-1) cubic-bezier(0, 0, 1, 1)',
  ]) assert(stylesheetViolations('panel.css', `.rail-link { ${declaration} }`).length > 0, declaration);
});

test('markup policy rejects effect utilities, off-scale sizes and radii, and inline styles', () => {
  for (const utility of ['shadow-md', 'hover:shadow-xl', 'drop-shadow-lg', 'focus-visible:ring-2', 'bg-linear-to-r', 'bg-radial-at-t', 'bg-gradient-to-r', 'text-base', 'text-3xl', 'text-[13px]', 'rounded', 'rounded-xl', 'rounded-[10px]', 'rounded-t-2xl']) assert(markupViolations('fixture.tsx', `<div className="${utility}" />`).length > 0, utility);
  for (const source of [
    '<div style="box-shadow: 0 0 4px blue" />',
    '<div style={{ boxShadow: "0 0 4px blue" }} />',
    '<div style={{ fontSize: 13 }} />',
    '<div style="border-radius: 4px" />',
    '<div class="bg-[linear-gradient(var(--accent),var(--danger))]" />',
    '<div class="[background:linear-gradient(var(--accent),var(--danger))]" />',
    '<div className="hover:bg-[image:radial-gradient(var(--accent),var(--danger))]" />',
    '<div className="[background-image:conic-gradient(var(--accent),var(--danger))]" />',
    '<div class="bg-conic-180" />',
    '<div class="bg-[-webkit-gradient(linear,left_top,left_bottom,from(var(--accent)),to(var(--danger)))]" />',
    '<div class="[filter:DROP-SHADOW(0_0_4px_var(--accent))]" />',
    '<div class="[BOX-SHADOW:0_0_4px_var(--accent)]" />',
    '<div class="bg-[var(--cover-wash)]" />',
    '<div className="bg-(--accent-fill)" />',
    '<div className="[box-shadow:var(--glow-primary)]" />',
    '<div style={{ backgroundImage: "repeating-linear-gradient(var(--accent),var(--danger))" }} />',
  ]) assert(markupViolations('fixture.tsx', source).length > 0, source);
  assert.deepEqual(markupViolations('fixture.tsx', '<div className="rounded-md rounded-t-lg text-sm text-muted-foreground text-foreground rounded-full text-2xs" />'), []);
  assert.deepEqual(markupViolations('fixture.astro', '<button data-variant="primary">Publicar</button>'), []);
});

test('tokens and fonts.css define two self-hosted variable families', async () => {
  const tokens = await readFile(resolve(styleRoot, 'tokens.css'), 'utf8');
  assert.match(tokens, /--font-sans: 'Inter Variable', [^;]+, sans-serif;/);
  assert.match(tokens, /--font-mono: 'JetBrains Mono Variable', [^;]+, monospace;/);
  const fonts = await readFile(resolve(styleRoot, 'fonts.css'), 'utf8');
  const faces = [...fonts.matchAll(/@font-face \{([^}]*)\}/g)].map(([, body]) => Object.fromEntries([...body!.matchAll(/([\w-]+): ([^;]+);/g)].map((match) => [match[1], match[2]])));
  assert.deepEqual(faces.map((face) => [face['font-family'], face.src]), [
    ["'Inter Variable'", "url('@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2') format('woff2-variations')"],
    ["'Inter Variable'", "url('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2') format('woff2-variations')"],
    ["'JetBrains Mono Variable'", "url('@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-ext-wght-normal.woff2') format('woff2-variations')"],
    ["'JetBrains Mono Variable'", "url('@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2') format('woff2-variations')"],
  ]);
  assert(faces.every((face) => face['font-style'] === 'normal' && face['font-display'] === 'swap'));
  const { dependencies } = JSON.parse(await readFile(resolve('apps/dashboard/package.json'), 'utf8')) as { dependencies: Record<string, string> };
  for (const name of ['@fontsource-variable/inter', '@fontsource-variable/jetbrains-mono']) assert.match(dependencies[name] ?? '', /^\d+\.\d+\.\d+$/, `${name} is pinned to an exact version`);
});

test('font policy rejects other families, remote URLs, and font links', () => {
  for (const source of [
    ".rail-link { font-family: 'Inter' }",
    '.rail-link { font-family: var(--font-sans), serif }',
    '.rail-link { font-family: var(--font-display) }',
    '.rail-link { font: var(--text-md)/1.5 a, b }',
    ".rail-link { font: 600 var(--text-xs) 'JetBrains Mono' }",
    '.rail-link { --font-sans: serif }',
    '.rail-link { background: url(https://cdn.test/a.png) }',
    '.rail-link { background: url(//cdn.test/a.png) }',
    '@import url(https://fonts.googleapis.com/css2?family=Inter);',
    "@font-face { font-family: 'Inter Variable'; src: url('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2') }",
  ]) assert(stylesheetViolations('panel.css', source).length > 0, source);
  assert(stylesheetViolations('fonts.css', "@font-face { font-family: 'Inter Variable'; src: url(https://cdn.jsdelivr.net/npm/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2) }").length > 0);
  for (const source of ['.rail-link { font-family: var(--font-mono) }', '.rail-link { font: 600 var(--text-xs) var(--font-mono) }', '.rail-link { font: inherit }', '.rail-link { font-family: inherit }', "@import 'tailwindcss';"]) assert.deepEqual(stylesheetViolations('panel.css', source), [], source);
  assert.deepEqual(stylesheetViolations('fonts.css', "@font-face { font-family: 'Inter Variable'; src: url('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2') format('woff2-variations') }"), []);
  for (const source of [
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
    '<link rel="preload" as="font" href="/_astro/inter-latin-wght-normal.woff2" crossorigin>',
    '<link rel="icon" href="//cdn.test/favicon.svg">',
    '<div style="font-family: serif" />',
    '<div style={{ fontFamily: "serif" }} />',
  ]) assert(markupViolations('fixture.astro', source).length > 0, source);
  assert.deepEqual(markupViolations('fixture.astro', '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />'), []);
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
