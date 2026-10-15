import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { createSchema, publishSchema, updateSchema } from '@artifacts/contracts';
import { canonicalResource } from '@artifacts/contracts/http';
import type { ArtifactHttpClient } from '@artifacts/client';

const binding = {
  version: z.literal(1),
  resource: z.string().transform(canonicalResource),
  ownerId: z.string().min(1).max(128),
};

export const operationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...binding, kind: z.literal('create'), command: createSchema }),
  z.strictObject({ ...binding, kind: z.literal('update'), command: updateSchema }),
  z.strictObject({ ...binding, kind: z.literal('publish'), command: publishSchema }),
]);
export type PreparedOperation = z.infer<typeof operationSchema>;
export type Mutation =
  | { kind: 'create'; command: z.input<typeof createSchema> }
  | { kind: 'update'; command: z.input<typeof updateSchema> }
  | { kind: 'publish'; command: z.input<typeof publishSchema> };

export function operationPath(stateDir: string, resource: string, requestId: string): string {
  createSchema.shape.requestId.parse(requestId);
  return join(stateDir, 'operations', `${createHash('sha256').update(JSON.stringify([canonicalResource(resource), requestId])).digest('hex')}.json`);
}

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid()) || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw new Error(`The state directory must be private and owned by the current user: ${path}`);
}

export async function retainOperation(stateDir: string, resource: string, ownerId: string, mutation: Mutation): Promise<PreparedOperation> {
  const operation = operationSchema.parse({ version: 1, resource, ownerId, ...mutation });
  await privateDirectory(stateDir);
  const directory = join(stateDir, 'operations');
  await privateDirectory(directory);
  const path = operationPath(stateDir, resource, operation.command.requestId);
  let file;
  try { file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`An operation already exists for ${operation.command.requestId}. Use artifacts retry ${operation.command.requestId} to send the retained command.`);
    throw error;
  }
  try {
    await file.writeFile(`${JSON.stringify(operation)}\n`, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  if (process.platform !== 'win32') {
    const handle = await open(directory, constants.O_RDONLY);
    try { await handle.sync(); }
    finally { await handle.close(); }
  }
  return operation;
}

export async function loadOperation(stateDir: string, requestId: string, resource: string, ownerId: string): Promise<PreparedOperation> {
  await privateDirectory(stateDir);
  await privateDirectory(join(stateDir, 'operations'));
  const file = await open(operationPath(stateDir, resource, requestId), constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024 || (process.getuid && stat.uid !== process.getuid()) || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw new Error('The retained operation must be a private regular file no larger than 8 MiB');
    bytes = await file.readFile();
  } finally {
    await file.close();
  }
  const operation = operationSchema.parse(JSON.parse(bytes.toString('utf8')));
  if (operation.command.requestId !== requestId) throw new Error('The retained request ID does not match the requested operation');
  if (operation.resource !== canonicalResource(resource)) throw new Error('The retained operation belongs to a different server resource');
  if (operation.ownerId !== ownerId) throw new Error('The retained operation belongs to a different owner');
  return operation;
}

export function submitOperation(client: ArtifactHttpClient, operation: PreparedOperation) {
  switch (operation.kind) {
    case 'create': return client.create(operation.command);
    case 'update': return client.update(operation.command);
    case 'publish': return client.publish(operation.command);
  }
}
