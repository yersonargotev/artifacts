import { z } from 'zod';
import { ArtifactError, artifactReadSchema, createSchema, decodeFile, readSchema, snapshotSchema, updateSchema, type ArtifactRead, type Revision, type Snapshot, type UpdateInput } from './contracts.ts';
import { canonicalJson, sha256 } from './serialization.ts';

export type { UpdateInput } from './contracts.ts';

export type AttachmentSummary = {
  path: string;
  mediaType: string;
  encoding: 'utf8' | 'base64';
  decodedBytes: number;
  sha256: string;
};

export type RevisionSummary = Omit<Revision, 'snapshot'> & {
  metadata: Pick<Snapshot['metadata'], 'title' | 'description'>;
  content: { kind: Snapshot['content']['kind']; utf8Bytes: number };
  files: AttachmentSummary[];
};

export type CompactArtifactRead = Omit<ArtifactRead, 'revision'> & { revision: RevisionSummary };
export type MetadataChange =
  | { field: 'title' | 'description'; before: string; after: string }
  | { field: 'custom'; before?: Snapshot['metadata']['custom']; after?: Snapshot['metadata']['custom'] };
export type AttachmentChange =
  | { path: string; change: 'added'; before: null; after: AttachmentSummary }
  | { path: string; change: 'removed'; before: AttachmentSummary; after: null }
  | { path: string; change: 'changed'; before: AttachmentSummary; after: AttachmentSummary };
export type RevisionComparison = {
  beforeRevisionId: string;
  afterRevisionId: string;
  metadata: MetadataChange[];
  content: { before: Snapshot['content']; after: Snapshot['content']; kindChanged: boolean; textChanged: boolean };
  files: AttachmentChange[];
};

async function summarizeFiles(files: Snapshot['files']): Promise<AttachmentSummary[]> {
  return Promise.all([...files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0).map(async ({ path, mediaType, encoding, data }) => {
    const bytes = decodeFile({ encoding, data });
    return { path, mediaType, encoding, decodedBytes: bytes.length, sha256: await sha256(bytes) };
  }));
}

export async function summarizeRevision(revision: Revision): Promise<RevisionSummary> {
  const { snapshot, ...identity } = revision;
  return {
    ...identity,
    metadata: { title: snapshot.metadata.title, description: snapshot.metadata.description },
    content: { kind: snapshot.content.kind, utf8Bytes: Buffer.byteLength(snapshot.content.text) },
    files: await summarizeFiles(snapshot.files),
  };
}

export async function compactArtifactRead(document: ArtifactRead): Promise<CompactArtifactRead> {
  const { revision, ...identity } = document;
  return { ...identity, revision: await summarizeRevision(revision) };
}

export async function compareRevisions(before: Revision, after: Revision): Promise<RevisionComparison> {
  const metadata: MetadataChange[] = [];
  for (const field of ['title', 'description'] as const) {
    if (before.snapshot.metadata[field] !== after.snapshot.metadata[field]) metadata.push({ field, before: before.snapshot.metadata[field], after: after.snapshot.metadata[field] });
  }
  if (canonicalJson(before.snapshot.metadata.custom) !== canonicalJson(after.snapshot.metadata.custom)) {
    metadata.push({ field: 'custom', before: structuredClone(before.snapshot.metadata.custom), after: structuredClone(after.snapshot.metadata.custom) });
  }
  const [beforeFiles, afterFiles] = await Promise.all([summarizeFiles(before.snapshot.files), summarizeFiles(after.snapshot.files)]);
  const beforeByPath = new Map(beforeFiles.map((file) => [file.path, file]));
  const afterByPath = new Map(afterFiles.map((file) => [file.path, file]));
  const files: AttachmentChange[] = [];
  for (const path of [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])].sort()) {
    const previous = beforeByPath.get(path);
    const next = afterByPath.get(path);
    if (!previous && next) files.push({ path, change: 'added', before: null, after: next });
    else if (previous && !next) files.push({ path, change: 'removed', before: previous, after: null });
    else if (previous && next && (previous.sha256 !== next.sha256 || previous.mediaType !== next.mediaType || previous.encoding !== next.encoding)) files.push({ path, change: 'changed', before: previous, after: next });
  }
  return {
    beforeRevisionId: before.id,
    afterRevisionId: after.id,
    metadata,
    content: {
      before: { ...before.snapshot.content },
      after: { ...after.snapshot.content },
      kindChanged: before.snapshot.content.kind !== after.snapshot.content.kind,
      textChanged: before.snapshot.content.text !== after.snapshot.content.text,
    },
    files,
  };
}

export type ArtifactEditClient = { read(input: { artifactId: string }): Promise<ArtifactRead> };
export type PrepareArtifactEditInput = {
  artifactId: string;
  requestId: string;
  changes: {
    metadata?: Partial<Snapshot['metadata']>;
    content?: Partial<Snapshot['content']>;
    files?: Snapshot['files'];
  };
};

const prepareEditSchema = z.strictObject({
  artifactId: readSchema.shape.artifactId,
  requestId: createSchema.shape.requestId,
  changes: z.strictObject({
    metadata: snapshotSchema.shape.metadata.partial().optional(),
    content: snapshotSchema.shape.content.partial().optional(),
    files: snapshotSchema.shape.files.optional(),
  }),
});

function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

export async function prepareArtifactEdit(client: ArtifactEditClient, value: PrepareArtifactEditInput): Promise<UpdateInput> {
  const input = prepareEditSchema.parse(structuredClone(value));
  const current = artifactReadSchema.parse(structuredClone(await client.read({ artifactId: input.artifactId })));
  if (current.artifactId !== input.artifactId) throw new TypeError('Artifact reader returned a different artifact');
  if (current.revision.id !== current.headRevisionId) throw new ArtifactError('conflict', 'Artifact reader did not return the current head', { currentRevisionId: current.headRevisionId });
  const snapshot = current.revision.snapshot;
  const metadata = { ...snapshot.metadata, ...input.changes.metadata };
  if (Object.hasOwn(input.changes.metadata ?? {}, 'custom') && input.changes.metadata?.custom === undefined) delete metadata.custom;
  return freezeJson(updateSchema.parse({
    artifactId: input.artifactId,
    requestId: input.requestId,
    expectedRevisionId: current.headRevisionId,
    snapshot: {
      metadata,
      content: { ...snapshot.content, ...input.changes.content },
      files: input.changes.files ?? snapshot.files,
    },
  }));
}
