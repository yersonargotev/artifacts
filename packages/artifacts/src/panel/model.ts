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
