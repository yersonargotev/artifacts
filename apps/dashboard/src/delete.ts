import { deleteSchema, type DeleteInput } from '@artifacts/artifacts/contracts';
import { readForm } from './form.ts';

export async function parseDeletionForm(request: Request, artifactId: string | undefined): Promise<DeleteInput> {
  const invalid = () => new Response('El formulario de eliminación no es válido.', { status: 400 });
  const fields = await readForm(request, { artifactId: [1, 1], expectedRevisionId: [1, 1], expectedPublicationVersion: [1, 1], requestId: [1, 1] }, 4096);
  if (!fields) throw invalid();
  const version = fields.get('expectedPublicationVersion')!;
  if (!/^(0|[1-9]\d*)$/.test(version) || !Number.isSafeInteger(Number(version)) || fields.get('artifactId') !== artifactId) throw invalid();
  const parsed = deleteSchema.safeParse({ ...Object.fromEntries(fields), expectedPublicationVersion: Number(version) });
  if (!parsed.success) throw invalid();
  return parsed.data;
}
