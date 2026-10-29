#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fonts = join(dirname(fileURLToPath(import.meta.url)), '../fonts');
const latin = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const faces = [
  { family: 'Bricolage Grotesque', style: 'normal', weight: '500 800', file: 'bricolage-grotesque.woff2' },
  { family: 'Public Sans', style: 'normal', weight: '400 700', file: 'public-sans.woff2' },
  { family: 'Public Sans', style: 'italic', weight: '400 700', file: 'public-sans-italic.woff2' },
  { family: 'JetBrains Mono', style: 'normal', weight: '400 700', file: 'jetbrains-mono.woff2' },
  { family: 'Newsreader', style: 'normal', weight: '400 700', file: 'newsreader.woff2' },
  { family: 'Newsreader', style: 'italic', weight: '400 700', file: 'newsreader-italic.woff2' },
];
const limit = 1024 * 1024;

function htmlTypographySources(page) {
  const sources = [];
  const managed = [];
  const tags = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?([a-z][a-z0-9:-]*)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  let italic = false;
  let anchor;
  let head;
  let match;
  while ((match = tags.exec(page))) {
    const [tag, name] = match;
    if (tag.startsWith('<!--')) continue;
    if (/^<!doctype\b/i.test(tag)) head ??= tags.lastIndex;
    if (!name || tag.startsWith('</')) continue;
    const lower = name.toLowerCase();
    if (lower === 'head') head = tags.lastIndex;
    const attributes = new Map();
    const attribute = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    const entities = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', sol: '/' };
    for (const entry of tag.slice(name.length + 1, -1).matchAll(attribute)) {
      const key = entry[1].toLowerCase();
      const value = (entry[2] ?? entry[3] ?? entry[4] ?? '').replace(/&(#(?:[xX][\da-fA-F]+|\d+));?|&(quot|QUOT|apos|amp|AMP|lt|LT|gt|GT|sol);/g, (entity, numeric, named) => {
        if (named) return entities[named.toLowerCase()];
        const code = numeric[1].toLowerCase() === 'x' ? parseInt(numeric.slice(2), 16) : Number(numeric.slice(1));
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
      });
      if (!attributes.has(key)) attributes.set(key, value);
    }
    if (attributes.has('style')) sources.push({ css: attributes.get('style'), inline: true });
    if (['em', 'i', 'cite'].includes(lower)) italic = true;
    if (lower === 'plaintext') break;
    if (['style', 'script', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes'].includes(lower)) {
      const close = new RegExp(`</${lower}\\s*>`, 'gi');
      close.lastIndex = tags.lastIndex;
      const end = close.exec(page);
      const contentEnd = end?.index ?? page.length;
      if (lower === 'style') {
        if (attributes.has('data-artifacts-fonts')) {
          let after = end ? close.lastIndex : page.length;
          if (page[after] === '\n') after++;
          managed.push([match.index, after]);
        } else if (!attributes.get('type') || /^text\/css$/i.test(attributes.get('type'))) {
          anchor ??= match.index;
          sources.push({ css: page.slice(tags.lastIndex, contentEnd), inline: false });
        }
      }
      tags.lastIndex = end ? close.lastIndex : page.length;
    }
  }
  return { sources, managed, italic, insertionAt: anchor ?? head ?? 0 };
}

function cssDeclarations(css, inline) {
  const declarations = [];
  const blocks = [];
  let segment = '';
  let quote = '';
  let parentheses = 0;
  let brackets = 0;
  let valueBraces = 0;
  function emit() {
    const match = /^\s*(--[\w-]+|[-a-z]+)\s*:\s*([\s\S]*)$/i.exec(segment);
    if (match && (inline || blocks.length) && !blocks.includes(true)) {
      declarations.push({ property: match[1].startsWith('--') ? match[1] : match[1].toLowerCase(), value: match[2].replace(/\s*!\s*important\s*$/i, '') });
    }
    segment = '';
  }
  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    if (char === '\\') {
      segment += css.slice(index, index + 2);
      index++;
    } else if (quote) {
      segment += char;
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
      segment += char;
    } else if (char === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      index = end < 0 ? css.length : end + 1;
      segment += ' ';
    } else if (char === '(' || char === '[') {
      if (char === '(') parentheses++;
      else brackets++;
      segment += char;
    } else if (char === ')' || char === ']') {
      if (char === ')') parentheses--;
      else brackets--;
      segment += char;
    } else if (!parentheses && !brackets && char === '{') {
      if (valueBraces || /^\s*--[\w-]+\s*:/.test(segment)) {
        valueBraces++;
        segment += char;
      } else {
        blocks.push(/^\s*@font-face\b/i.test(segment));
        segment = '';
      }
    } else if (!parentheses && !brackets && char === '}' && valueBraces) {
      valueBraces--;
      segment += char;
    } else if (!parentheses && !brackets && !valueBraces && (char === ';' || char === '}')) {
      emit();
      if (char === '}') blocks.pop();
    } else segment += char;
  }
  emit();
  return declarations;
}

function splitValue(value, separator) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '\\') index++;
    else if (quote) { if (char === quote) quote = ''; }
    else if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (!depth && separator.test(char)) {
      parts.push(value.slice(start, index));
      if (char === '/') parts.push('/');
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function fontValueAlternatives(value, properties, visiting = new Set()) {
  let quote = '';
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '\\') index++;
    else if (quote) { if (char === quote) quote = ''; }
    else if (char === '"' || char === "'") quote = char;
    else if (/^var\(/i.test(value.slice(index, index + 4)) && !/[\w-]/.test(value[index - 1] ?? '')) {
      let depth = 1;
      let end = index + 4;
      let innerQuote = '';
      for (; end < value.length && depth; end++) {
        const inner = value[end];
        if (inner === '\\') end++;
        else if (innerQuote) { if (inner === innerQuote) innerQuote = ''; }
        else if (inner === '"' || inner === "'") innerQuote = inner;
        else if (inner === '(') depth++;
        else if (inner === ')') depth--;
      }
      if (depth) return [];
      const [name, ...fallback] = splitValue(value.slice(index + 4, end - 1), /,/);
      const key = name.trim();
      const candidates = [];
      if (!visiting.has(key)) {
        const path = new Set(visiting).add(key);
        for (const definition of properties.get(key) ?? []) candidates.push(...fontValueAlternatives(definition, properties, path));
      }
      if (fallback.length) candidates.push(...fontValueAlternatives(fallback.join(','), properties, visiting));
      return [...new Set(candidates.flatMap((candidate) => fontValueAlternatives(value.slice(0, index) + candidate + value.slice(end), properties, visiting)))];
    }
  }
  return [value];
}

function typographyUsage(document) {
  const declarations = document.sources.flatMap(({ css, inline }) => cssDeclarations(css, inline));
  const properties = new Map();
  for (const { property, value } of declarations) {
    if (property.startsWith('--')) properties.set(property, [...properties.get(property) ?? [], value]);
  }
  const usage = { families: new Set(), italic: document.italic };
  for (const { property, value } of declarations) {
    if (!['font-family', 'font', 'font-style'].includes(property)) continue;
    for (let resolved of fontValueAlternatives(value, properties)) {
      resolved = resolved.trim();
      if (property === 'font-style') {
        if (/^italic$/i.test(resolved)) usage.italic = true;
        continue;
      }
      if (property === 'font') {
        const tokens = splitValue(resolved, /[\s/]/).filter(Boolean);
        const size = tokens.findIndex((token) => /^(?:\d*\.?\d+(?:[a-z]+|%)|0|xx?-small|small|medium|large|x{1,3}-large|smaller|larger)$/i.test(token) || /^(?:calc|min|max|clamp)\(/i.test(token));
        if (size < 0) continue;
        if (tokens.slice(0, size).some((token) => /^italic$/i.test(token))) usage.italic = true;
        resolved = tokens.slice(size + (tokens[size + 1] === '/' ? 3 : 1)).join(' ');
      }
      for (let family of splitValue(resolved, /,/)) {
        family = family.trim();
        if (/^(["'])[\s\S]*\1$/.test(family)) family = family.slice(1, -1);
        family = family.replace(/\\([\da-f]{1,6})(?:\r\n|[\t\n\r\f ])?|\\([^\r\n\f])/gi, (_, hex, escaped) => {
          const code = parseInt(hex, 16);
          return hex ? code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd' : escaped;
        }).replace(/\s+/g, ' ').toLowerCase();
        const face = faces.find((candidate) => candidate.family.toLowerCase() === family);
        if (face) usage.families.add(face.family);
      }
    }
  }
  return usage;
}

const paths = process.argv.slice(2);
if (paths.length !== 1) {
  process.stderr.write('Usage: node embed-fonts.mjs PAGE.html\nEmbeds the bundled font faces that PAGE.html names, in place.\n');
  process.exit(2);
}
const [path] = paths;
let page = await readFile(path, 'utf8');
for (const [start, end] of htmlTypographySources(page).managed.reverse()) page = page.slice(0, start) + page.slice(end);
const document = htmlTypographySources(page);
const usage = typographyUsage(document);
const used = faces.filter((face) => usage.families.has(face.family) && (face.style === 'normal' || usage.italic));
const rules = await Promise.all(used.map(async (face) => {
  const data = (await readFile(join(fonts, face.file))).toString('base64');
  return `@font-face{font-family:"${face.family}";font-style:${face.style};font-weight:${face.weight};font-display:swap;src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${latin}}`;
}));
const block = rules.length ? `<style data-artifacts-fonts>${rules.join('')}</style>\n` : '';

const at = document.insertionAt;
const output = page.slice(0, at) + block + page.slice(at);
const bytes = Buffer.byteLength(output);
if (bytes > limit) {
  process.stderr.write(`Not written. ${path} would be ${bytes} bytes, above the 1 MiB revision limit. Drop a family or the italic faces, or shrink the content.\n`);
  process.exit(1);
}
await writeFile(path, output);
const names = used.map((face) => `${face.family}${face.style === 'italic' ? ' italic' : ''}`);
process.stdout.write(`${names.length ? `Embedded ${names.join(', ')}` : 'No bundled family named; nothing embedded'}. ${path} is ${bytes} bytes.\n`);
