import { deleteSchema, type DeleteInput } from '@artifacts/artifacts/contracts';

export async function parseDeletionForm(request: Request, artifactId: string | undefined): Promise<DeleteInput> {
  const invalid = () => new Response('El formulario de eliminación no es válido.', { status: 400 });
  if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw invalid();
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); throw invalid(); }
    chunks.push(value);
  }
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    for (const part of body.split('&')) for (const value of part.split('=')) decodeURIComponent(value.replace(/\+/g, ' '));
  } catch { throw invalid(); }
  const fields = new URLSearchParams(body);
  const names = ['artifactId', 'expectedRevisionId', 'expectedPublicationVersion', 'requestId'];
  if ([...fields.keys()].some((name) => !names.includes(name)) || names.some((name) => fields.getAll(name).length !== 1)) throw invalid();
  const version = fields.get('expectedPublicationVersion')!;
  if (!/^(0|[1-9]\d*)$/.test(version) || !Number.isSafeInteger(Number(version)) || fields.get('artifactId') !== artifactId) throw invalid();
  const parsed = deleteSchema.safeParse({ ...Object.fromEntries(fields), expectedPublicationVersion: Number(version) });
  if (!parsed.success) throw invalid();
  return parsed.data;
}
