export async function readForm(request: Request, names: readonly string[]): Promise<URLSearchParams | undefined> {
  if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) return undefined;
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); return undefined; }
    chunks.push(value);
  }
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    for (const part of body.split('&')) for (const value of part.split('=')) decodeURIComponent(value.replace(/\+/g, ' '));
  } catch { return undefined; }
  const fields = new URLSearchParams(body);
  if ([...fields.keys()].some((name) => !names.includes(name)) || names.some((name) => fields.getAll(name).length !== 1)) return undefined;
  return fields;
}
