import assert from 'node:assert/strict';
import test from 'node:test';
import { matchRange, paletteGroups, type PaletteData } from '../apps/dashboard/src/components/palette/entries.ts';

const data: PaletteData = {
  artifacts: [
    { title: 'Informe de retención', project: 'Investigación', tone: 'teal', href: '/read?artifact=a' },
    { title: 'Borrador: política de retención de datos', project: null, tone: undefined, href: '/read?artifact=b' },
  ],
  projects: [{ name: 'Investigación', tone: 'teal', count: 4, href: '/?project=Investigaci%C3%B3n' }],
  reader: '/read',
  readerKey: true,
};
const labels = (query: string, theme: 'dark' | 'light' = 'dark') => paletteGroups(data, query, theme).map((group) => [group.value, group.items.map((item) => item.label)]);

test('an empty query lists the page artifacts, the projects, and the actions, without a search', () => {
  assert.deepEqual(labels(''), [
    ['Artefactos', ['Informe de retención', 'Borrador: política de retención de datos']],
    ['Proyectos', ['Investigación']],
    ['Acciones', ['Ir a Biblioteca', 'Ir a Proyectos', 'Abrir Modo lectura', 'Cambiar a tema claro', 'Conectar herramientas']],
  ]);
  assert.equal(labels('', 'light')[2]![1]![3], 'Cambiar a tema oscuro');
});

test('a query keeps only matching items, ignores case and accents, and always ends with the full search', () => {
  assert.deepEqual(labels('RETEN'), [['Artefactos', ['Informe de retención', 'Borrador: política de retención de datos']], ['Buscar', ['Buscar «RETEN» en toda la biblioteca']]]);
  assert.deepEqual(labels('investigacion'), [['Proyectos', ['Investigación']], ['Buscar', ['Buscar «investigacion» en toda la biblioteca']]]);
  assert.deepEqual(labels('nada'), [['Buscar', ['Buscar «nada» en toda la biblioteca']]]);
});

test('the full search goes to the library GET search with the trimmed query', () => {
  const search = paletteGroups(data, '  plan & co  ', 'dark').at(-1)!.items[0]!;
  assert.deepEqual(search.run, { kind: 'go', href: '/?q=plan+%26+co' });
  const long = paletteGroups(data, 'x'.repeat(300), 'dark').at(-1)!.items[0]!.run;
  assert.equal(long.kind === 'go' && new URL(long.href, 'http://panel.test').searchParams.get('q')!.length, 256, 'the query keeps the search field limit');
});

test('each item says where it goes and which key works on this page', () => {
  const items = paletteGroups(data, '', 'dark').flatMap((group) => group.items);
  assert.deepEqual(items.map((item) => [item.label, item.run, item.key ?? null]), [
    ['Informe de retención', { kind: 'go', href: '/read?artifact=a' }, null],
    ['Borrador: política de retención de datos', { kind: 'go', href: '/read?artifact=b' }, null],
    ['Investigación', { kind: 'go', href: '/?project=Investigaci%C3%B3n' }, null],
    ['Ir a Biblioteca', { kind: 'go', href: '/' }, null],
    ['Ir a Proyectos', { kind: 'go', href: '/projects' }, null],
    ['Abrir Modo lectura', { kind: 'go', href: '/read' }, 'r'],
    ['Cambiar a tema claro', { kind: 'theme' }, 't'],
    ['Conectar herramientas', { kind: 'tools' }, null],
  ]);
  assert.equal(paletteGroups({ ...data, readerKey: false }, '', 'dark').at(-1)!.items.find((item) => item.id === 'reader')!.key, undefined, 'r shows only where it opens read mode');
});

test('matchRange marks the original characters of an accent-insensitive match', () => {
  assert.deepEqual(matchRange('Informe de retención', 'RETENCION'), [11, 20]);
  assert.deepEqual(matchRange('Guía publicada', 'guia'), [0, 4]);
  assert.equal(matchRange('Guía publicada', 'zz'), undefined);
  assert.equal(matchRange('Guía publicada', '   '), undefined);
});
