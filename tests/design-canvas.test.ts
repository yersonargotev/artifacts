import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSchema, parseCanvas, snapshotSchema, type Snapshot } from '../packages/artifacts/src/index.ts';
import { designSnapshot } from './helpers.ts';

type Entry = Record<string, unknown> | null;
type CanvasJson = { boards: Record<string, Entry>; order: string[]; notes?: Record<string, Entry>; pages?: { id: string; name: string }[] } & Record<string, unknown>;

const base = designSnapshot();
const [first, second] = base.files.map((file) => file.path) as [string, string, string];

function design(change: (canvas: CanvasJson) => void, files: Snapshot['files'] = base.files): Snapshot {
  const canvas = JSON.parse(base.content.text) as CanvasJson;
  change(canvas);
  return { ...base, content: { kind: 'design', text: JSON.stringify(canvas) }, files };
}

function rejection(snapshot: unknown) {
  const result = snapshotSchema.safeParse(snapshot);
  assert.equal(result.success, false, 'the snapshot must be rejected');
  return result.error.issues;
}

test('a valid design parses unchanged and resolves its boards back to front', () => {
  const home = '<!doctype html><title>Inicio</title><h1>Inicio</h1>';
  const phone = '<!doctype html><title>Móvil</title><h1>Móvil 🌎</h1>';
  const canvas = {
    v: 1,
    boards: { 'boards/Home.html': { x: -1_000_000, y: 1_000_000, w: 1440, h: 900, title: 'I'.repeat(256), page: 'web' }, 'boards/Phone_v2.html': { x: 1520.5, y: -40, w: 40, h: 8000, page: 'mobile' } },
    order: ['boards/Phone_v2.html', 'boards/Home.html'],
    notes: { 'contrast-1': { x: 0, y: -200, text: 'Revisar contraste', w: 320, page: 'web' }, ['n'.repeat(40)]: { x: 10, y: 10, text: '' } },
    pages: [{ id: 'web', name: 'Web' }, { id: 'mobile', name: 'Móvil' }],
  };
  const snapshot: Snapshot = {
    metadata: { title: 'Two pages', description: '' },
    content: { kind: 'design', text: JSON.stringify(canvas) },
    files: [
      { path: 'boards/Home.html', mediaType: 'text/html', encoding: 'utf8', data: home },
      { path: 'notes.txt', mediaType: 'text/plain', encoding: 'utf8', data: 'Notas' },
      { path: 'boards/Phone_v2.html', mediaType: 'text/html', encoding: 'utf8', data: phone },
    ],
  };
  assert.deepEqual(snapshotSchema.parse(snapshot), snapshot);
  const parsed = parseCanvas(snapshot);
  assert.deepEqual(parsed.index, canvas);
  assert.deepEqual(parsed.boards, [
    { path: 'boards/Phone_v2.html', x: 1520.5, y: -40, w: 40, h: 8000, page: 'mobile', html: phone },
    { path: 'boards/Home.html', x: -1_000_000, y: 1_000_000, w: 1440, h: 900, title: 'I'.repeat(256), page: 'web', html: home },
  ]);
});

test('parseCanvas throws a ZodError when the index or a board file breaks a snapshot rule', () => {
  assert.throws(() => parseCanvas({ content: { kind: 'html', text: base.content.text }, files: base.files }), TypeError);
  assert.throws(() => parseCanvas({ content: base.content, files: base.files.slice(0, 2) }), {
    name: 'ZodError', issues: [{ code: 'custom', path: ['content', 'text', 'boards', 'boards/Board-3.html'], message: 'Canvas board boards/Board-3.html has no matching file' }],
  });
  assert.throws(() => parseCanvas({ content: base.content, files: [base.files[0]!, { path: second, mediaType: 'image/png', encoding: 'base64', data: 'iVBORw0KGgo=' }, base.files[2]!] }), {
    name: 'ZodError', issues: [{ code: 'custom', path: ['files', 1], message: `Canvas board ${second} must be a text/html file with utf8 encoding` }],
  });
  assert.throws(() => parseCanvas({ content: { kind: 'design', text: '<h1>Not a canvas</h1>' }, files: [] }), {
    name: 'ZodError', issues: [{ code: 'custom', path: ['content', 'text'], message: 'Design content must be a canvas index in JSON' }],
  });
  assert.throws(() => parseCanvas(design((canvas) => { canvas.order.pop(); })), (error: { name: string; issues: { path: unknown[] }[] }) => error.name === 'ZodError' && error.issues.length === 1 && error.issues[0]!.path.join('/') === 'content/text/order');
});

test('order and boards must name the same boards, each once', () => {
  const missing = rejection(design((canvas) => { canvas.order.push('boards/Missing.html'); }));
  assert.deepEqual(missing.map(({ path }) => path), [['content', 'text', 'order', 3]]);
  assert.match(missing[0]!.message, /boards\/Missing\.html/);
  const omitted = rejection(design((canvas) => { canvas.order = canvas.order.filter((path) => path !== second); }));
  assert.deepEqual(omitted.map(({ path }) => path), [['content', 'text', 'order']]);
  assert.match(omitted[0]!.message, new RegExp(second));
  const repeated = rejection(design((canvas) => { canvas.order.push(first); }));
  assert.deepEqual(repeated.map(({ path }) => path), [['content', 'text', 'order', 3]]);
  assert.match(repeated[0]!.message, new RegExp(first));
  const empty = rejection({ ...base, content: { kind: 'design', text: JSON.stringify({ v: 1, boards: {}, order: [] }) }, files: [] });
  assert.deepEqual(empty.map(({ path, message }) => ({ path, message })), [{ path: ['content', 'text', 'order'], message: 'A canvas needs at least one board' }]);
  const unordered = rejection(design((canvas) => { canvas.order = []; }));
  assert.deepEqual(unordered.map(({ message }) => message), ['A canvas needs at least one board', ...base.files.map(({ path }) => `Canvas order omits board ${path}`)]);
});

test('every board needs a matching utf8 text/html file', () => {
  const missing = rejection(design((canvas) => {
    canvas.boards['boards/Missing.html'] = { x: 0, y: 1000, w: 800, h: 600 };
    canvas.order.push('boards/Missing.html');
  }));
  assert.deepEqual(missing.map(({ path }) => path), [['content', 'text', 'boards', 'boards/Missing.html']]);
  assert.match(missing[0]!.message, /boards\/Missing\.html/);
  for (const file of [{ ...base.files[1]!, mediaType: 'text/plain' }, { ...base.files[1]!, encoding: 'base64' as const, data: Buffer.from(base.files[1]!.data).toString('base64') }]) {
    const issues = rejection(design(() => {}, [base.files[0]!, file, base.files[2]!]));
    assert.deepEqual(issues.map(({ path }) => path), [['files', 1]]);
    assert.match(issues[0]!.message, new RegExp(second));
  }
});

test('boards and notes may name only declared pages', () => {
  const issues = rejection(design((canvas) => {
    canvas.pages = [{ id: 'web', name: 'Web' }, { id: 'web', name: 'Web again' }];
    canvas.boards[first]!.page = 'web';
    canvas.boards[second]!.page = 'tablet';
    canvas.notes = { idea: { x: 0, y: 0, text: 'Idea', page: 'print' } };
  }));
  assert.deepEqual(issues.map(({ path }) => path), [['content', 'text', 'pages', 1, 'id'], ['content', 'text', 'boards', second, 'page'], ['content', 'text', 'notes', 'idea', 'page']]);
  assert.match(issues[1]!.message, /tablet/);
  assert.match(issues[2]!.message, /print/);
  assert.deepEqual(rejection(design((canvas) => { canvas.boards[first]!.page = 'web'; })).map(({ path }) => path), [['content', 'text', 'boards', first, 'page']]);
});

test('board and note widths and heights stay within 40 to 8000', () => {
  const issues = rejection(design((canvas) => {
    canvas.boards[first]!.w = 39;
    canvas.boards[second]!.h = 8001;
    canvas.notes = { idea: { x: 0, y: 0, text: 'Idea', w: 8000.5 } };
  }));
  assert.deepEqual(issues.map(({ path, code }) => ({ path, code })), [
    { path: ['content', 'text', 'boards', first, 'w'], code: 'too_small' },
    { path: ['content', 'text', 'boards', second, 'h'], code: 'too_big' },
    { path: ['content', 'text', 'notes', 'idea', 'w'], code: 'too_big' },
  ]);
});

test('a 33-board canvas breaks both the file limit and the board cap', () => {
  assert.equal(snapshotSchema.safeParse(designSnapshot(32)).success, true);
  assert.deepEqual(rejection(designSnapshot(33)).map(({ path, code }) => ({ path, code })), [
    { path: ['files'], code: 'too_big' },
    { path: ['content', 'text', 'boards'], code: 'too_big' },
    { path: ['content', 'text', 'order'], code: 'too_big' },
  ]);
});

test('a canvas holds at most 32 boards, 200 notes, and 32 pages, and an oversized list reports one issue', () => {
  assert.equal(snapshotSchema.safeParse(design((canvas) => {
    canvas.notes = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`note-${index}`, { x: 0, y: 0, text: '' }]));
    canvas.pages = Array.from({ length: 32 }, (_, index) => ({ id: `page-${index}`, name: `Page ${index}` }));
  })).success, true);
  for (const [change, field, message] of [
    [(canvas) => { canvas.notes = Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`bad id ${index}`, null])); }, 'notes', 'A canvas holds at most 200 notes'],
    [(canvas) => { canvas.pages = Array.from({ length: 33 }, () => ({ id: 'web', name: 'Web' })); }, 'pages', 'A canvas holds at most 32 pages'],
    [(canvas) => { for (let index = 0; index < 30; index++) canvas.boards[`boards/Extra ${index}.html`] = { x: 0, y: 0, w: 1, h: 1 }; }, 'boards', 'A canvas holds at most 32 boards'],
    [(canvas) => { canvas.order = Array.from({ length: 40_000 }, (_, index) => `boards/B${index}.html`); }, 'order', 'A canvas holds at most 32 boards'],
  ] as [(canvas: CanvasJson) => void, string, string][]) {
    assert.deepEqual(rejection(design(change)).map(({ path, code, message }) => ({ path, code, message })), [{ path: ['content', 'text', field], code: 'too_big', message }]);
  }
});

test('an oversized design reports the size limit before its index', () => {
  const order = Array.from({ length: 60_000 }, (_, index) => `boards/Board-${index}.html`);
  const issues = rejection({ ...base, content: { kind: 'design', text: JSON.stringify({ v: 1, boards: {}, order }) } });
  assert(issues.some(({ message }) => message === 'A revision must fit within 1 MiB of decoded content and metadata'));
  assert.equal(issues.filter(({ path }) => path.length > 2).length, 0, 'no canvas index issue is reported');
});

test('design text must be a version 1 canvas index', () => {
  assert.deepEqual(rejection({ ...base, content: { kind: 'design', text: '<h1>Not a canvas</h1>' } }).map(({ path }) => path), [['content', 'text']]);
  for (const [change, path] of [
    [(canvas) => { canvas.v = 2; }, ['content', 'text', 'v']],
    [(canvas) => { canvas.zoom = 1; }, ['content', 'text']],
    [(canvas) => { canvas.boards[first]!.color = 'red'; }, ['content', 'text', 'boards', first]],
  ] as [(canvas: CanvasJson) => void, (string | number)[]][]) {
    assert.deepEqual(rejection(design(change))[0]!.path, path);
  }
});

test('a board path outside boards/NAME.html is rejected even when its file exists', () => {
  const message = 'Use a board path such as boards/Home.html';
  for (const board of ['boards/nested/Deep.html', 'boards/.hid.html', 'boards/a.txt', 'pages/Home.html']) {
    const issues = rejection(design((canvas) => {
      canvas.boards[board] = { x: 0, y: 1000, w: 800, h: 600 };
      canvas.order.push(board);
    }, [...base.files, { path: board, mediaType: 'text/html', encoding: 'utf8', data: '<h1>Board</h1>' }]));
    assert.deepEqual(issues.map(({ path, code, message }) => ({ path, code, message })), [
      { path: ['content', 'text', 'boards', board], code: 'invalid_key', message },
      { path: ['content', 'text', 'order', 3], code: 'invalid_format', message },
    ]);
  }
});

test('each malformed note, page, or board field reports its own path and code, with the id rule in the message', () => {
  const idMessage = 'Use 1 to 40 letters, digits, underscores, or hyphens';
  const protoMessage = 'Use an id other than __proto__';
  const note = { x: 0, y: 0, text: 'Idea' };
  for (const [change, path, code, message] of [
    [(canvas) => { canvas.notes = { idea: { ...note, color: 'red' } }; }, ['notes', 'idea'], 'unrecognized_keys', 'Unrecognized key: "color"'],
    [(canvas) => { canvas.pages = [{ id: 'web', name: 'Web', order: 1 } as { id: string; name: string }]; }, ['pages', 0], 'unrecognized_keys', 'Unrecognized key: "order"'],
    [(canvas) => { canvas.notes = { ['n'.repeat(41)]: note }; }, ['notes', 'n'.repeat(41)], 'invalid_key', idMessage],
    [(canvas) => { canvas.notes = { 'bad id': note }; }, ['notes', 'bad id'], 'invalid_key', idMessage],
    [(canvas) => { canvas.notes = { 'bad id': null }; }, ['notes', 'bad id'], 'invalid_key', idMessage],
    [(canvas) => { canvas.boards = [canvas.boards[first]] as unknown as CanvasJson['boards']; }, ['boards'], 'invalid_type'],
    [(canvas) => { canvas.notes = JSON.parse('{"__proto__":{"x":0,"y":0,"text":"Idea"}}'); }, ['notes', '__proto__'], 'invalid_key', protoMessage],
    [(canvas) => { canvas.pages = [{ id: 'p'.repeat(41), name: 'Page' }]; }, ['pages', 0, 'id'], 'invalid_format', idMessage],
    [(canvas) => { canvas.pages = [{ id: '__proto__', name: 'Page' }]; }, ['pages', 0, 'id'], 'custom', protoMessage],
    [(canvas) => { canvas.boards[first]!.title = ''; }, ['boards', first, 'title'], 'too_small'],
    [(canvas) => { canvas.boards[first]!.title = 'T'.repeat(257); }, ['boards', first, 'title'], 'too_big'],
    [(canvas) => { canvas.pages = [{ id: 'web', name: '' }]; }, ['pages', 0, 'name'], 'too_small'],
    [(canvas) => { canvas.pages = [{ id: 'web', name: 'P'.repeat(257) }]; }, ['pages', 0, 'name'], 'too_big'],
    [(canvas) => { canvas.boards[first]!.x = '0'; }, ['boards', first, 'x'], 'invalid_type'],
    [(canvas) => { canvas.boards[first]!.y = null; }, ['boards', first, 'y'], 'invalid_type'],
    [(canvas) => { canvas.boards[first]!.x = 1e308; }, ['boards', first, 'x'], 'too_big'],
    [(canvas) => { canvas.boards[first]!.y = 1_000_001; }, ['boards', first, 'y'], 'too_big'],
    [(canvas) => { canvas.notes = { idea: { ...note, x: -1_000_001 } }; }, ['notes', 'idea', 'x'], 'too_small'],
    [(canvas) => { canvas.notes = { idea: { ...note, y: 1_000_001 } }; }, ['notes', 'idea', 'y'], 'too_big'],
    [(canvas) => { canvas.notes = { idea: { x: 0, y: 0 } }; }, ['notes', 'idea', 'text'], 'invalid_type'],
  ] as [(canvas: CanvasJson) => void, (string | number)[], string, string?][]) {
    const issues = rejection(design(change));
    assert.deepEqual(issues.map(({ path, code }) => ({ path, code })), [{ path: ['content', 'text', ...path], code }], `${path.join('/')} ${code}`);
    if (message) assert.equal(issues[0]!.message, message);
  }
});

test('the create command reports a canvas error under the snapshot path', () => {
  const result = createSchema.safeParse({ requestId: 'design-request-1', snapshot: design((canvas) => { canvas.order[0] = 'boards/Missing.html'; }) });
  assert.equal(result.success, false);
  assert(result.error.issues.some((issue) => issue.path.join('/') === 'snapshot/content/text/order/0' && issue.message.includes('boards/Missing.html')));
});

test('other content kinds keep accepting text and files that look like a canvas', () => {
  for (const kind of ['html', 'markdown', 'text'] as const) {
    const snapshot: Snapshot = { ...base, content: { kind, text: '{"v":1,"boards":{},"order":["boards/Missing.html"]}' }, files: [{ ...base.files[0]!, mediaType: 'text/plain' }] };
    assert.deepEqual(snapshotSchema.parse(snapshot), snapshot);
  }
});
