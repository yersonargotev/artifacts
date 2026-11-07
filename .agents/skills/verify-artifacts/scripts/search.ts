import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { artifactReadSchema, searchResultSchema } from '../../../../packages/artifacts/src/contracts.ts';

type CliResult = { code: number | null; stdout: string; stderr: string };
interface SearchDrive {
  checks: string[];
  call(name: string, input?: unknown, allowError?: boolean): Promise<Record<string, any>>;
  cli(...args: string[]): Promise<CliResult>;
  ok(...args: string[]): Promise<any>;
}

export async function driveSearch({ checks, call, cli, ok }: SearchDrive) {
  const page = (text: string) => ({ metadata: { title: 'Viaje a Antioquia', description: 'Notas de viaje.' }, content: { kind: 'markdown' as const, text }, files: [] });
  const created = artifactReadSchema.parse(await call('artifacts_create', { requestId: randomUUID(), snapshot: page('# Viaje\n\nUna tarde en Envigado con amigos.\n'), project: 'Mi-Wiki', slug: 'viajes/antioquia' }));
  const before = searchResultSchema.parse(await call('artifacts_search', { query: 'envigado' }));
  assert.deepEqual(before.items.map((item) => item.artifactId), [created.artifactId], 'MCP search finds the created page');

  const updated = artifactReadSchema.parse(await call('artifacts_update', { requestId: randomUUID(), artifactId: created.artifactId, expectedRevisionId: created.revision.id, snapshot: page('# Viaje\n\nUna mañana de Búsqueda en Sabaneta.\n') }));
  assert.equal(updated.revision.parentRevisionId, created.revision.id);

  const viaMcp = searchResultSchema.parse(await call('artifacts_search', { query: 'busqueda sabaneta', project: 'mi-wiki' }));
  assert.equal(viaMcp.items.length, 1, 'MCP search finds the updated page by its new text without accents');
  const [hit] = viaMcp.items;
  assert.deepEqual({ artifactId: hit!.artifactId, project: hit!.project, slug: hit!.slug, title: hit!.title, nextCursor: viaMcp.nextCursor }, { artifactId: created.artifactId, project: 'Mi-Wiki', slug: 'viajes/antioquia', title: 'Viaje a Antioquia', nextCursor: null });
  assert.match(hit!.snippet, /\*\*Búsqueda\*\* en \*\*Sabaneta\*\*/, 'The snippet highlights both terms');

  const viaCli = searchResultSchema.parse(await ok('search', 'busqueda sabaneta', '--project', 'mi-wiki'));
  assert.deepEqual(viaCli, viaMcp, 'CLI search over REST equals the MCP result');

  assert.deepEqual(searchResultSchema.parse(await call('artifacts_search', { query: 'envigado' })).items, [], 'MCP search no longer finds the removed text');
  assert.deepEqual(searchResultSchema.parse(await ok('search', 'envigado')).items, [], 'CLI search no longer finds the removed text');
  assert.deepEqual(searchResultSchema.parse(await ok('search', '"foo" OR NEAR(')).items, [], 'Operator text returns no results instead of a syntax error');
  const blank = await cli('search', ' ');
  assert.equal(blank.code, 1, 'A blank CLI query exits 1');
  assert.match(blank.stderr, /"code":"invalid_input"/, 'A blank CLI query reports invalid_input');

  const html = artifactReadSchema.parse(await call('artifacts_create', { requestId: randomUUID(), snapshot: { metadata: { title: 'Mapa del oriente', description: '' }, content: { kind: 'html', text: '<!doctype html><html><head><style>.medellin{color:red}</style><script>var itagui = 1</script></head><body><p class="bello" data-place="caldas">Un paseo por <b>Rionegro</b></p></body></html>' }, files: [] } }));
  assert.deepEqual(searchResultSchema.parse(await call('artifacts_search', { query: 'rionegro' })).items.map((item) => item.artifactId), [html.artifactId], 'MCP search finds the HTML page by its visible text');
  for (const query of ['medellin', 'itagui', 'bello', 'caldas', 'class', 'script']) assert.deepEqual(searchResultSchema.parse(await call('artifacts_search', { query })).items, [], `MCP search does not find the HTML page by ${query}`);

  const board = 'boards/Guarne.html';
  const canvas = { v: 1, boards: { [board]: { x: 0, y: 0, w: 1440, h: 900, title: 'Guarne' } }, order: [board] };
  const design = artifactReadSchema.parse(await call('artifacts_create', { requestId: randomUUID(), snapshot: { metadata: { title: 'Tablero de Guatape', description: 'Bocetos de Jardin.' }, content: { kind: 'design', text: JSON.stringify(canvas) }, files: [{ path: board, mediaType: 'text/html', encoding: 'utf8', data: '<!doctype html><html lang="es"><meta charset="utf-8"><title>Guarne</title><h1>Guarne</h1></html>' }] } }));
  const designHits = searchResultSchema.parse(await call('artifacts_search', { query: 'guatape' }));
  assert.deepEqual(designHits.items.map((item) => item.artifactId), [design.artifactId], 'MCP search finds the design by its title');
  assert.deepEqual(searchResultSchema.parse(await call('artifacts_search', { query: 'jardin' })).items.map((item) => item.artifactId), [design.artifactId], 'MCP search finds the design by its description');
  assert.deepEqual(searchResultSchema.parse(await call('artifacts_search', { query: 'guarne' })).items, [], 'MCP search does not find the design by a canvas or board word');
  assert.deepEqual(searchResultSchema.parse(await ok('search', 'guatape')), designHits, 'CLI design search over REST equals the MCP result');

  checks.push('HTTP MCP create and update of a Markdown page with project and slug', 'HTTP MCP search finds the new head text without accents, with project, slug, title, and a highlighted snippet', 'Source CLI search over REST equals the MCP result', 'Removed text no longer matches through MCP or the CLI', 'Operator text returns no results instead of a syntax error', 'Blank CLI query fails with invalid_input', 'HTTP MCP search finds an HTML page by visible text and not by a style, script, tag, or attribute word', 'HTTP MCP search finds a design by title and description and not by a canvas or board word', 'Source CLI design search over REST equals the MCP result');
}
