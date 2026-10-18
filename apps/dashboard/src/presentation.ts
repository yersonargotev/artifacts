import { projectKey } from '@artifacts/artifacts/panel/model';
import type { LibraryPage, LibraryQuery, LibraryScope, ScopeRequest } from '@artifacts/artifacts/panel/model';
import { scopeRequestOf } from './urls.ts';

export type NavLocation =
  | { readonly kind: 'library' }
  | { readonly kind: 'project'; readonly name: string }
  | { readonly kind: 'unfiled' }
  | { readonly kind: 'artifact'; readonly project: string | null }
  | { readonly kind: 'task' };

export const workspaceQuery: LibraryQuery = { scope: { kind: 'all' }, status: 'all', q: '' };
export const projectTones = ['peach', 'teal', 'pink', 'sky', 'lavender', 'flamingo', 'sapphire', 'maroon'] as const;
export type ProjectTone = typeof projectTones[number];

export function projectTone(name: string): ProjectTone {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(projectKey(name))) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return projectTones[hash % projectTones.length]!;
}

export function locationOf(scope: LibraryScope): NavLocation {
  if (scope.kind === 'all') return { kind: 'library' };
  if (scope.kind === 'unfiled') return { kind: 'unfiled' };
  return { kind: 'project', name: scope.kind === 'project' ? scope.project.name : scope.name };
}

export function scopeOf(location: NavLocation): ScopeRequest {
  if (location.kind === 'project') return { kind: 'project', name: location.name };
  if (location.kind === 'unfiled') return { kind: 'unfiled' };
  if (location.kind === 'artifact') return location.project === null ? { kind: 'unfiled' } : { kind: 'project', name: location.project };
  return { kind: 'all' };
}

export function searchFor(page: LibraryPage): LibraryQuery {
  return { scope: scopeRequestOf(page.scope), status: page.status, q: page.q };
}
