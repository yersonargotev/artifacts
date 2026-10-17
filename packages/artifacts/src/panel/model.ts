import type { Revision } from '../contracts.ts';
import type { RevisionComparison } from '../workflow.ts';

export type ProjectName = string & { readonly __brand: 'ProjectName' };
export type ContentKind = 'html' | 'markdown' | 'text';

export const projectKey = (name: string) => name.toLowerCase();
export const libraryStatuses = ['all', 'published', 'unpublished', 'pending'] as const;
export const libraryPageSize = 25;
export type LibraryStatus = typeof libraryStatuses[number];

export type ScopeRequest =
  | { readonly kind: 'all' }
  | { readonly kind: 'project'; readonly name: string }
  | { readonly kind: 'unfiled' };

export type LibraryQuery = {
  readonly scope: ScopeRequest;
  readonly status: LibraryStatus;
  readonly q: string;
  readonly cursor?: string;
};

export type Tally = { readonly count: number; readonly published: number; readonly pending: number };
export type ProjectAggregate = Tally & { readonly name: ProjectName; readonly updatedAt: Date };
export type Workspace = {
  readonly total: Tally;
  readonly unfiled: Tally;
  readonly projects: readonly ProjectAggregate[];
};

export type LibraryScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'project'; readonly project: ProjectAggregate }
  | { readonly kind: 'vanishedProject'; readonly name: string }
  | { readonly kind: 'unfiled'; readonly tally: Tally };

export type RevisionRef = { readonly revisionId: string; readonly sequence: number; readonly createdAt: Date };
export type CardPublication =
  | { readonly state: 'unpublished' }
  | { readonly state: 'published' | 'pending'; readonly url: string; readonly version: number; readonly revision: RevisionRef };

export type ArtifactCard = {
  readonly artifactId: string;
  readonly title: string;
  readonly description: string;
  readonly kind: ContentKind;
  readonly project: ProjectName | null;
  readonly head: RevisionRef;
  readonly publication: CardPublication;
};

export type LibraryPage = {
  readonly scope: LibraryScope;
  readonly status: LibraryStatus;
  readonly q: string;
  readonly counts: Readonly<Record<LibraryStatus, number>>;
  readonly cards: readonly ArtifactCard[];
  readonly next: string | null;
  readonly continued: boolean;
};

export type LibrarySnapshot = { readonly workspace: Workspace; readonly page: LibraryPage };

export type RecentArtifact = Pick<ArtifactCard, 'artifactId' | 'title'>;
export type ProjectsOverview = {
  readonly projects: readonly { readonly project: ProjectAggregate; readonly recent: readonly RecentArtifact[] }[];
  readonly unfiled: { readonly tally: Tally; readonly recent: readonly RecentArtifact[] };
};
export type ProjectsSnapshot = { readonly workspace: Workspace; readonly overview: ProjectsOverview };

export type ClientRef = { readonly clientId: string; readonly name: string | null };
export type DetailQuery = {
  readonly artifactId: string;
  readonly revisionId?: string;
  readonly compareTo?: string;
  readonly before?: number;
  readonly includeComparison: boolean;
};
export type RevisionEntry = RevisionRef & { readonly author: ClientRef };
export type ArtifactDetail = {
  readonly artifactId: string;
  readonly project: ProjectName | null;
  readonly createdAt: Date;
  readonly selected: { readonly revision: Revision; readonly author: ClientRef };
  readonly head: RevisionRef;
  readonly publication: { readonly revision: RevisionRef; readonly version: number; readonly url: string } | null;
  readonly history: { readonly entries: readonly RevisionEntry[]; readonly before: number | null; readonly olderBefore: number | null };
  readonly choices: readonly RevisionRef[];
  readonly compared: RevisionRef | null;
  readonly comparison: RevisionComparison | null;
};
export type DetailSnapshot = { readonly workspace: Workspace; readonly detail: ArtifactDetail };

export const isSelectedPublished = (detail: ArtifactDetail) => detail.publication?.revision.revisionId === detail.selected.revision.id;
export const isPending = (detail: ArtifactDetail) => detail.publication !== null && detail.publication.revision.revisionId !== detail.head.revisionId;
