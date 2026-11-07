import { ArtifactError, type BatchInput, type BatchResult, type Snapshot } from './contracts.ts';
import { projectKey } from './panel/model.ts';

export type StoredPage = { artifactId: string; project: string | null; slug: string | null; headRevisionId: string; sequence: number };
export type BatchWrite =
  | { op: 'create'; index: number; artifactId: string; revisionId: string; project: string | null; slug: string | null; snapshot: Snapshot }
  | { op: 'update'; index: number; artifactId: string; revisionId: string; parentRevisionId: string; sequence: number; snapshot: Snapshot }
  | { op: 'move'; index: number; artifactId: string; revisionId: string; from: { project: string | null; slug: string | null }; project: string | null; slug: string | null };

// Walks the operations over an in-memory namespace seeded from one read, so every check sees the operations before it.
export function planBatch(operations: BatchInput['operations'], projectNames: readonly string[], stored: readonly StoredPage[], newId: () => string): { results: BatchResult['results']; writes: BatchWrite[] } {
  const spellings = new Map<string, string>();
  const spell = (name: string) => { if (!spellings.has(projectKey(name))) spellings.set(projectKey(name), name); return spellings.get(projectKey(name))!; };
  projectNames.forEach(spell);
  const named = (project: string | null, slug: string) => JSON.stringify([project, slug]);
  const byId = new Map<string, StoredPage & { written: boolean }>();
  const bySlug = new Map<string, StoredPage & { written: boolean }>();
  const locate = (index: number, artifactId: string | undefined, project: string | undefined, slug: string | undefined) => {
    const target = artifactId === undefined ? bySlug.get(named(project === undefined ? null : spell(project), slug!)) : byId.get(artifactId);
    if (!target) throw new ArtifactError('not_found', 'Artifact not found', { index });
    return target;
  };
  const register = (page: StoredPage & { written: boolean }) => {
    byId.set(page.artifactId, page);
    if (page.slug !== null) bySlug.set(named(page.project, page.slug), page);
  };
  for (const page of stored) register({ ...page, written: false });
  const results: BatchResult['results'] = [];
  const writes: BatchWrite[] = [];
  operations.forEach((operation, index) => {
    if (operation.op === 'create') {
      const project = operation.project === undefined ? null : spell(operation.project);
      const slug = operation.slug ?? null;
      const holder = slug === null ? undefined : bySlug.get(named(project, slug));
      if (holder) throw new ArtifactError('slug_conflict', 'The slug already names an artifact in this project', { index, slug, project, artifactId: holder.artifactId });
      const page = { artifactId: newId(), project, slug, headRevisionId: newId(), sequence: 1, written: true };
      register(page);
      writes.push({ op: 'create', index, artifactId: page.artifactId, revisionId: page.headRevisionId, project, slug, snapshot: operation.snapshot });
      results.push({ index, artifactId: page.artifactId, revisionId: page.headRevisionId });
      return;
    }
    if (operation.op === 'move') {
      const target = locate(index, operation.artifactId, operation.from?.project, operation.from?.slug);
      const project = operation.project === undefined ? target.project : operation.project === null ? null : spell(operation.project);
      const slug = operation.slug === undefined ? target.slug : operation.slug;
      const holder = slug === null ? undefined : bySlug.get(named(project, slug));
      if (holder && holder !== target) throw new ArtifactError('slug_conflict', 'The slug already names an artifact in this project', { index, slug, project, artifactId: holder.artifactId });
      if (target.slug !== null) bySlug.delete(named(target.project, target.slug));
      writes.push({ op: 'move', index, artifactId: target.artifactId, revisionId: target.headRevisionId, from: { project: target.project, slug: target.slug }, project, slug });
      Object.assign(target, { project, slug });
      register(target);
      results.push({ index, artifactId: target.artifactId, revisionId: target.headRevisionId });
      return;
    }
    const target = locate(index, operation.artifactId, operation.project, operation.slug);
    // A head written earlier in this batch has an ID the caller cannot know, so only such a head may omit expectedRevisionId.
    const stale = operation.expectedRevisionId === undefined ? !target.written : operation.expectedRevisionId !== target.headRevisionId;
    if (stale) throw new ArtifactError('conflict', 'Artifact head changed', { index, currentRevisionId: target.headRevisionId });
    const revisionId = newId();
    writes.push({ op: 'update', index, artifactId: target.artifactId, revisionId, parentRevisionId: target.headRevisionId, sequence: target.sequence + 1, snapshot: operation.snapshot });
    Object.assign(target, { headRevisionId: revisionId, sequence: target.sequence + 1, written: true });
    results.push({ index, artifactId: target.artifactId, revisionId });
  });
  return { results, writes };
}
