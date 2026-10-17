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
const embedded = /<style data-artifacts-fonts>[\s\S]*?<\/style>\n?/;

const paths = process.argv.slice(2);
if (paths.length !== 1) {
  process.stderr.write('Usage: node embed-fonts.mjs PAGE.html\nEmbeds the bundled font faces that PAGE.html names, in place.\n');
  process.exit(2);
}
const [path] = paths;
const page = (await readFile(path, 'utf8')).replace(embedded, '');
const italic = /font-style\s*:\s*italic|<(em|i|cite)[\s>]/i.test(page);
const used = faces.filter((face) => page.includes(face.family) && (face.style === 'normal' || italic));
const rules = await Promise.all(used.map(async (face) => {
  const data = (await readFile(join(fonts, face.file))).toString('base64');
  return `@font-face{font-family:"${face.family}";font-style:${face.style};font-weight:${face.weight};font-display:swap;src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${latin}}`;
}));
const block = rules.length ? `<style data-artifacts-fonts>${rules.join('')}</style>\n` : '';

const anchor = page.search(/<style[\s>]/i);
const head = /<head[^>]*>\n?/i.exec(page) ?? /<!doctype[^>]*>\n?/i.exec(page);
const at = anchor >= 0 ? anchor : head ? head.index + head[0].length : 0;
const output = page.slice(0, at) + block + page.slice(at);
const bytes = Buffer.byteLength(output);
if (bytes > limit) {
  process.stderr.write(`Not written. ${path} would be ${bytes} bytes, above the 1 MiB revision limit. Drop a family or the italic faces, or shrink the content.\n`);
  process.exit(1);
}
await writeFile(path, output);
const names = used.map((face) => `${face.family}${face.style === 'italic' ? ' italic' : ''}`);
process.stdout.write(`${names.length ? `Embedded ${names.join(', ')}` : 'No bundled family named; nothing embedded'}. ${path} is ${bytes} bytes.\n`);
