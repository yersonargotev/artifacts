import { z } from 'zod';
import { panelDetailQuerySchema, panelLibraryQuerySchema, panelMoveIdsSchema } from '@artifacts/artifacts/panel';
import { defaultDirections, libraryPageSize } from '@artifacts/artifacts/panel/model';
import type { DetailQuery, LibraryPage, LibraryQuery, LibraryScope, ScopeRequest } from '@artifacts/artifacts/panel/model';

export const listViews = ['table', 'cards'] as const;
export type ListView = typeof listViews[number];
export const viewCookie = 'panel_view';
/**
 * A library query plus the view, grouping, and offset the URL names. They stay out of the panel query because only the dashboard renders them.
 * The offset counts the artifacts before a cursor's page, so read mode can number its rows.
 */
export type LibraryLink = LibraryQuery & { readonly view?: ListView; readonly group?: 'none'; readonly offset?: number };
const isView = (value: string | null | undefined): value is ListView => listViews.some((view) => view === value);

/** The URL names the view to share it; otherwise the cookie that the toggle writes decides, and the table is the default. */
export function readListView(url: URL, cookie: string | undefined): { view: ListView; named: ListView | undefined } {
  const named = url.searchParams.get('view');
  return isView(named) ? { view: named, named } : { view: isView(cookie) ? cookie : 'table', named: undefined };
}

/** The table groups its rows by project unless the URL turns grouping off. */
export function readListGroup(url: URL): 'none' | undefined {
  return url.searchParams.get('group') === 'none' ? 'none' : undefined;
}

export function readListOffset(url: URL): number | undefined {
  const offset = url.searchParams.get('offset');
  return offset && /^[1-9]\d{0,8}$/.test(offset) ? Number(offset) : undefined;
}

/** Only the dashboard's own page links write the offset, so one that is missing or disagrees with the page's counts returns undefined rather than a guess. */
export function pageOffset(named: number | undefined, page: LibraryPage): number | undefined {
  const offset = page.continued ? named : 0;
  if (offset === undefined || offset % libraryPageSize) return undefined;
  const end = offset + page.cards.length;
  const total = page.counts[page.status];
  return (page.next ? end < total : end === total) ? offset : undefined;
}

export function nextOffset(offset: number | undefined, page: LibraryPage): number | undefined {
  return page.continued ? offset === undefined ? undefined : offset + libraryPageSize : libraryPageSize;
}

export function readLibraryUrl(url: URL): LibraryQuery {
  const params = url.searchParams;
  const unfiled = params.has('unfiled');
  if (unfiled && params.has('project')) throw new z.ZodError([{ code: 'custom', path: ['scope'], message: 'Project and unfiled scopes cannot be combined' }]);
  if (unfiled) z.literal('1').parse(params.get('unfiled'));
  const status = panelLibraryQuerySchema.shape.status.safeParse(params.get('status') ?? undefined);
  const sort = panelLibraryQuerySchema.shape.sort.safeParse(params.get('sort') ?? undefined);
  const direction = panelLibraryQuerySchema.shape.direction.safeParse(params.get('dir') ?? undefined);
  return panelLibraryQuerySchema.parse({ scope: unfiled ? { kind: 'unfiled' } : params.has('project') ? { kind: 'project', name: params.get('project') } : { kind: 'all' }, q: params.get('q') ?? undefined, status: status.success ? status.data : 'all',
    ...(sort.success && sort.data ? { sort: sort.data } : {}), ...(direction.success && direction.data ? { direction: direction.data } : {}), ...(params.has('cursor') ? { cursor: params.get('cursor') } : {}) });
}

export function scopeRequestOf(scope: LibraryScope): ScopeRequest {
  return scope.kind === 'project' ? { kind: 'project', name: scope.project.name } : scope.kind === 'vanishedProject' ? { kind: 'project', name: scope.name } : { kind: scope.kind };
}

function listParams({ scope, status, q, sort = 'updated', direction = defaultDirections[sort] }: LibraryQuery): Record<string, string> {
  return { ...(scope.kind === 'project' ? { project: scope.name } : scope.kind === 'unfiled' ? { unfiled: '1' } : {}), ...(q ? { q } : {}), ...(status !== 'all' ? { status } : {}),
    ...(sort !== 'updated' ? { sort } : {}), ...(direction !== defaultDirections[sort] ? { dir: direction } : {}) };
}

export function libraryHref(query: LibraryLink, patch: Partial<LibraryLink> = {}): string {
  const state = { ...query, ...patch };
  const params = new URLSearchParams({ ...listParams(state), ...(state.view ? { view: state.view } : {}), ...(state.group ? { group: state.group } : {}), ...pageParams(patch) });
  return params.size ? `/?${params}` : '/';
}

function pageParams({ cursor, offset }: Pick<LibraryLink, 'cursor' | 'offset'>): Record<string, string> {
  return { ...(cursor ? { cursor } : {}), ...(cursor && offset ? { offset: String(offset) } : {}) };
}

/** A library link plus the artifact the reader shows. Without one the reader selects the first row of the page, or its last row when `at` says so. */
export type ReaderUrl = Omit<LibraryLink, 'view'> & { readonly artifactId?: string; readonly at?: 'last' };

export function readReaderUrl(url: URL): ReaderUrl {
  const artifactId = url.searchParams.get('artifact');
  const group = readListGroup(url);
  const offset = readListOffset(url);
  return { ...readLibraryUrl(url), ...(group ? { group } : {}), ...(offset ? { offset } : {}), ...(artifactId ? { artifactId } : url.searchParams.get('at') === 'last' ? { at: 'last' } : {}) };
}

/** Like the cursor, the offset and the selection come only from the patch, so a filter or page link starts at that list's first artifact. */
export function readerHref(query: ReaderUrl, patch: Partial<ReaderUrl> = {}): string {
  const state = { ...query, ...patch };
  const params = new URLSearchParams({ ...listParams(state), ...(state.group ? { group: state.group } : {}), ...pageParams(patch), ...(patch.artifactId ? { artifact: patch.artifactId } : patch.at ? { at: patch.at } : {}) });
  return params.size ? `/read?${params}` : '/read';
}

export function scopeHref(scope: ScopeRequest): string {
  return libraryHref({ scope, status: 'all', q: '' });
}

export const detailTabs = [
  { value: 'preview', label: 'Vista previa' },
  { value: 'files', label: 'Archivos' },
  { value: 'compare', label: 'Comparar' },
  { value: 'information', label: 'Información' },
] as const;
export type DetailTab = typeof detailTabs[number]['value'];
export type DetailUrl = Omit<DetailQuery, 'includeComparison'> & { readonly tab: DetailTab };

export function readDetailUrl(artifactId: string | undefined, url: URL): DetailUrl {
  const params = url.searchParams;
  const tab = detailTabs.find(({ value }) => value === params.get('tab'))?.value ?? 'preview';
  const { includeComparison: _, ...query } = panelDetailQuerySchema.parse({ artifactId, revisionId: params.get('revisionId') ?? undefined,
    compareTo: params.get('compareTo') ?? undefined, before: params.has('before') ? Number(params.get('before')) : undefined, includeComparison: tab === 'compare' });
  return { ...query, tab };
}

export function detailQuery({ tab, ...query }: DetailUrl): DetailQuery {
  return { ...query, includeComparison: tab === 'compare' };
}

export function detailHref(state: DetailUrl, patch: Partial<DetailUrl> = {}): string {
  const { artifactId, revisionId, compareTo, before, tab } = { ...state, ...patch };
  const params = new URLSearchParams({ ...(revisionId ? { revisionId } : {}), ...(compareTo && compareTo !== revisionId ? { compareTo } : {}), ...(before === undefined ? {} : { before: String(before) }), ...(tab === 'preview' ? {} : { tab }) });
  return `/artifacts/${encodeURIComponent(artifactId)}${params.size ? `?${params}` : ''}`;
}

export const previewHref = (artifactId: string, revisionId: string) => `/artifacts/${encodeURIComponent(artifactId)}/preview?${new URLSearchParams({ revisionId })}`;
export const exportHref = (artifactId: string, revisionId: string) => `/artifacts/${encodeURIComponent(artifactId)}/export?${new URLSearchParams({ revisionId })}`;

export function moveHref(artifactIds: readonly string[]): string {
  return `/move?${new URLSearchParams(artifactIds.map((id) => ['artifactId', id]))}`;
}

export function readMoveUrl(url: URL): string[] {
  const ids = url.searchParams.getAll('artifactId');
  z.array(z.string()).max(25).parse(ids);
  return panelMoveIdsSchema.parse(ids);
}

export const shareHref = (artifactId: string) => `/artifacts/${encodeURIComponent(artifactId)}/share`;
