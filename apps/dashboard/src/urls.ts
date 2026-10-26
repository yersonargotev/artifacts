import { z } from 'zod';
import { panelDetailQuerySchema, panelLibraryQuerySchema, panelMoveIdsSchema } from '@artifacts/artifacts/panel';
import type { DetailQuery, LibraryQuery, LibraryScope, ScopeRequest } from '@artifacts/artifacts/panel/model';

export function readLibraryUrl(url: URL): LibraryQuery {
  const params = url.searchParams;
  const unfiled = params.has('unfiled');
  if (unfiled && params.has('project')) throw new z.ZodError([{ code: 'custom', path: ['scope'], message: 'Project and unfiled scopes cannot be combined' }]);
  if (unfiled) z.literal('1').parse(params.get('unfiled'));
  const status = panelLibraryQuerySchema.shape.status.safeParse(params.get('status') ?? undefined);
  return panelLibraryQuerySchema.parse({ scope: unfiled ? { kind: 'unfiled' } : params.has('project') ? { kind: 'project', name: params.get('project') } : { kind: 'all' }, q: params.get('q') ?? undefined, status: status.success ? status.data : 'all', ...(params.has('cursor') ? { cursor: params.get('cursor') } : {}) });
}

export function scopeRequestOf(scope: LibraryScope): ScopeRequest {
  return scope.kind === 'project' ? { kind: 'project', name: scope.project.name } : scope.kind === 'vanishedProject' ? { kind: 'project', name: scope.name } : { kind: scope.kind };
}

export function libraryHref(query: LibraryQuery, patch: Partial<LibraryQuery> = {}): string {
  const { scope, status, q } = { ...query, ...patch };
  const params = new URLSearchParams({ ...(scope.kind === 'project' ? { project: scope.name } : scope.kind === 'unfiled' ? { unfiled: '1' } : {}), ...(q ? { q } : {}), ...(status !== 'all' ? { status } : {}), ...(patch.cursor ? { cursor: patch.cursor } : {}) });
  return params.size ? `/?${params}` : '/';
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
