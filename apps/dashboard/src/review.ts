import type { createArtifactStore } from '@artifacts/artifacts';
import { historySchema, readSchema, type Actor, type Revision } from '@artifacts/artifacts/contracts';
import { compareRevisions, summarizeRevision } from '@artifacts/artifacts/workflow';

export async function loadArtifactReview(store: ReturnType<typeof createArtifactStore>, actor: Actor, artifactId: string | undefined, search: URLSearchParams) {
  const input = readSchema.parse({ artifactId, revisionId: search.get('revisionId') ?? undefined });
  const historyInput = historySchema.parse({ artifactId: input.artifactId, beforeSequence: search.has('before') ? Number(search.get('before')) : undefined });
  const requestedComparison = search.has('compareTo') ? readSchema.parse({ artifactId: input.artifactId, revisionId: search.get('compareTo') }).revisionId : undefined;
  const [artifact, history] = await Promise.all([store.read(actor, input), store.history(actor, historyInput)]);
  const revisions = new Map<string, Revision>(history.items.map((revision) => [revision.id, revision]));
  revisions.set(artifact.revision.id, artifact.revision);
  const compareTo = [requestedComparison, artifact.publication?.revisionId, artifact.headRevisionId, artifact.revision.parentRevisionId, history.items.find((revision) => revision.id !== artifact.revision.id)?.id].find((id) => id && id !== artifact.revision.id);
  const needed = new Set([artifact.headRevisionId, ...(artifact.publication ? [artifact.publication.revisionId] : []), ...(compareTo ? [compareTo] : [])]);
  await Promise.all([...needed].filter((id) => !revisions.has(id)).map(async (revisionId) => {
    const read = await store.read(actor, { artifactId: input.artifactId, revisionId });
    revisions.set(revisionId, read.revision);
  }));
  const head = revisions.get(artifact.headRevisionId)!;
  const published = artifact.publication ? revisions.get(artifact.publication.revisionId)! : undefined;
  const compared = compareTo ? revisions.get(compareTo)! : undefined;
  const [summary, comparison] = await Promise.all([summarizeRevision(artifact.revision), compared ? compareRevisions(compared, artifact.revision) : undefined]);
  return { artifact, history, head, published, compared, summary, comparison, revisions: [...revisions.values()].filter((revision) => revision.id !== artifact.revision.id).sort((a, b) => b.sequence - a.sequence), before: historyInput.beforeSequence };
}
