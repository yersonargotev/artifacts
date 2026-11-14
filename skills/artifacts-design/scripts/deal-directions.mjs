#!/usr/bin/env node
import { randomInt } from 'node:crypto';

const axes = {
  ground: [
    'white page, with surfaces set apart by rules',
    'cool gray page',
    'warm paper page',
    'page tinted with the accent hue at low chroma',
    'neutral page under a full-width header band in a deep shade of the accent',
  ],
  accent: ['blue', 'indigo', 'violet', 'magenta', 'teal', 'cyan', 'copper', 'olive', 'ink, with no hue: the accent is the strongest text color'],
  type: [
    '--f-display "Bricolage Grotesque","Avenir Next",system-ui,sans-serif; --f-body "Public Sans","Segoe UI",system-ui,sans-serif',
    '--f-display "Newsreader",Charter,Georgia,serif; --f-body "Public Sans","Segoe UI",system-ui,sans-serif',
    '--f-display and --f-body "Newsreader",Charter,Georgia,serif; controls in "Public Sans","Segoe UI",system-ui,sans-serif',
    '--f-display "JetBrains Mono",ui-monospace,Menlo,Consolas,monospace; --f-body "Public Sans","Segoe UI",system-ui,sans-serif',
    '--f-display and --f-body "Public Sans","Segoe UI",system-ui,sans-serif, with contrast from weight and size',
    '--f-display "Bricolage Grotesque","Avenir Next",system-ui,sans-serif; --f-body "Newsreader",Charter,Georgia,serif',
    '--f-display Charter,"Iowan Old Style",Georgia,serif; --f-body system-ui,"Segoe UI",sans-serif',
    '--f-display ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif; --f-body system-ui,"Segoe UI",sans-serif',
    '--f-display Rockwell,"Roboto Slab",Georgia,serif; --f-body "Public Sans","Segoe UI",system-ui,sans-serif',
    '--f-display "Avenir Next",Montserrat,"Segoe UI",system-ui,sans-serif; --f-body Charter,"Iowan Old Style",Georgia,serif',
  ],
  shape: [
    'square corners and hairline rules, with no filled surfaces',
    '4 px radius and bordered surfaces',
    '10 px radius and filled surfaces without borders',
    '18 px radius, soft shadows, and generous padding',
    'square corners, 2 px rules, and solid blocks of the text color',
  ],
};

const usage = 'Usage: deal-directions.mjs [--seed <integer>]';
const args = process.argv.slice(2);
let next = (size) => randomInt(size);
if (args.length) {
  const seed = Number(args[1]);
  if (args.length !== 2 || args[0] !== '--seed' || !Number.isSafeInteger(seed)) {
    process.stderr.write(`${usage}\n`);
    process.exit(2);
  }
  let state = seed >>> 0;
  next = (size) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) % size;
  };
}

const directions = [{}, {}];
for (const [axis, values] of Object.entries(axes)) {
  const first = next(values.length);
  const second = (first + 1 + next(values.length - 1)) % values.length;
  directions[0][axis] = values[first];
  directions[1][axis] = values[second];
}
process.stdout.write(directions.map((direction, index) => `Direction ${'AB'[index]}\n${Object.entries(direction).map(([axis, value]) => `  ${axis}: ${value}`).join('\n')}\n`).join('\n'));
