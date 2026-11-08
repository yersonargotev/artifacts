import { markdownPreviewSandbox, projectKey } from '@artifacts/artifacts/panel/model';
import type { ArtifactDetail, ClientRef, ContentKind, RevisionRef, LibraryPage, LibraryQuery, LibraryScope, LibrarySort, ScopeRequest, SortDirection } from '@artifacts/artifacts/panel/model';
import { scopeRequestOf, type LibraryLink, type ListView } from './urls.ts';

export type NavLocation =
  | { readonly kind: 'library' }
  | { readonly kind: 'projects' }
  | { readonly kind: 'project'; readonly name: string }
  | { readonly kind: 'unfiled' }
  | { readonly kind: 'artifact'; readonly project: string | null }
  | { readonly kind: 'read'; readonly scope: ScopeRequest }
  | { readonly kind: 'task' };

export const workspaceQuery: LibraryQuery = { scope: { kind: 'all' }, status: 'all', q: '' };
export const projectTones = ['peach', 'teal', 'pink', 'sky', 'lavender', 'flamingo', 'sapphire', 'maroon'] as const;
export type ProjectTone = typeof projectTones[number];

export function projectTone(name: string): ProjectTone {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(projectKey(name))) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return projectTones[hash % projectTones.length]!;
}

export function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export function createCommand(project: string): string {
  return 'artifacts create --snapshot snapshot.json --project ' + shellQuote(project);
}

export function locationOf(scope: LibraryScope): NavLocation {
  if (scope.kind === 'all') return { kind: 'library' };
  if (scope.kind === 'unfiled') return { kind: 'unfiled' };
  return { kind: 'project', name: scope.kind === 'project' ? scope.project.name : scope.name };
}

export function scopeOf(location: NavLocation): ScopeRequest {
  if (location.kind === 'project') return { kind: 'project', name: location.name };
  if (location.kind === 'unfiled') return { kind: 'unfiled' };
  if (location.kind === 'read') return location.scope;
  if (location.kind === 'artifact') return location.project === null ? { kind: 'unfiled' } : { kind: 'project', name: location.project };
  return { kind: 'all' };
}

export function searchFor(page: LibraryPage, view?: ListView): LibraryLink {
  return { scope: scopeRequestOf(page.scope), status: page.status, q: page.q, sort: page.sort, direction: page.direction, ...(view ? { view } : {}) };
}

export const sortLabels: Readonly<Record<LibrarySort, Readonly<Record<SortDirection, string>>>> = {
  updated: { desc: 'Más recientes primero', asc: 'Más antiguos primero' },
  title: { asc: 'Título A–Z', desc: 'Título Z–A' },
  state: { asc: 'Cambios pendientes primero', desc: 'Publicados primero' },
  revision: { desc: 'Más revisiones primero', asc: 'Menos revisiones primero' },
};

export const clientLabel = (client: ClientRef) => client.name ?? client.clientId;
export const absoluteTime = (at: Date) => `${at.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
export const previewSandbox = (kind: ContentKind) => kind === 'markdown' ? markdownPreviewSandbox : 'allow-scripts';
export const contentLabels = { html: 'HTML', markdown: 'Markdown', text: 'Texto', design: 'Diseño' } as const;
export const publicationStates = {
  unpublished: { label: 'Sin publicar' },
  published: { label: 'Publicado' },
  pending: { label: 'Cambios pendientes' },
} as const;
export const statusTabs = [
  { value: 'all', label: 'Todos' },
  { value: 'published', label: 'Publicados' },
  { value: 'unpublished', label: 'Sin publicar' },
  { value: 'pending', label: 'Cambios pendientes' },
] as const;

export function relativeTime(at: Date, now: Date): string {
  const minutes = Math.round((at.getTime() - now.getTime()) / 60_000);
  const formatter = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  if (Math.abs(minutes) < 1_440) return formatter.format(Math.round(minutes / 60), 'hour');
  return formatter.format(Math.round(minutes / 1_440), 'day');
}

export function revisionLabel(ref: RevisionRef, detail: ArtifactDetail): string {
  return `Revisión ${ref.sequence}${ref.revisionId === detail.publication?.revision.revisionId ? ' · publicada' : ''}${ref.revisionId === detail.head.revisionId ? ' · más reciente' : ''}`;
}

export function retainedMarkers(detail: ArtifactDetail) {
  return { 'data-artifact-id': detail.artifactId, 'data-revision-id': detail.selected.revision.id, 'data-revision-sha256': detail.selected.revision.sha256, 'data-publication-version': String(detail.publication?.version ?? 0) };
}
