import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSchema, parseCanvas, snapshotSchema, type Snapshot } from '../packages/artifacts/src/index.ts';
import { designSnapshot } from './helpers.ts';

type CanvasJson = { boards: Record<string, Record<string, unknown>>; order: string[]; notes?: Record<string, Record<string, unknown>>; pages?: { id: string; name: string }[] } & Record<string, unknown>;

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
    boards: { 'boards/Home.html': { x: 0, y: 0, w: 1440, h: 900, title: 'Inicio', page: 'web' }, 'boards/Phone_v2.html': { x: 1520.5, y: -40, w: 40, h: 8000, page: 'mobile' } },
    order: ['boards/Phone_v2.html', 'boards/Home.html'],
    notes: { 'contrast-1': { x: 0, y: -200, text: 'Revisar contraste', w: 320, page: 'web' }, loose: { x: 10, y: 10, text: '' } },
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
    { path: 'boards/Home.html', x: 0, y: 0, w: 1440, h: 900, title: 'Inicio', page: 'web', html: home },
  ]);
  assert.throws(() => parseCanvas({ content: { kind: 'html', text: canvas.order[0]! }, files: [] }), TypeError);
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
  assert.deepEqual(empty.map(({ path }) => path), [['content', 'text', 'order']]);
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

test('the 32 file limit caps a canvas at 32 boards', () => {
  assert.equal(snapshotSchema.safeParse(designSnapshot(32)).success, true);
  assert.deepEqual(rejection(designSnapshot(33)).map(({ path, code }) => ({ path, code })), [{ path: ['files'], code: 'too_big' }]);
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
    [(canvas) => { canvas.boards['boards/nested/Deep.html'] = { x: 0, y: 0, w: 100, h: 100 }; canvas.order.push('boards/nested/Deep.html'); }, ['content', 'text', 'boards', 'boards/nested/Deep.html']],
  ] as [(canvas: CanvasJson) => void, (string | number)[]][]) {
    assert.deepEqual(rejection(design(change))[0]!.path, path);
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
