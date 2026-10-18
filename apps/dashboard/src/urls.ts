import { z } from 'zod';
import { panelLibraryQuerySchema } from '@artifacts/artifacts/panel';
import type { LibraryQuery, LibraryScope, ScopeRequest } from '@artifacts/artifacts/panel/model';

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
