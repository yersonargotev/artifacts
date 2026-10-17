export async function readForm(request: Request, spec: Readonly<Record<string, readonly [number, number]>>, maxBytes: number): Promise<URLSearchParams | undefined> {
  if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) return undefined;
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); return undefined; }
    chunks.push(value);
  }
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    for (const part of body.split('&')) for (const value of part.split('=')) decodeURIComponent(value.replace(/\+/g, ' '));
  } catch { return undefined; }
  const fields = new URLSearchParams(body);
  if ([...fields.keys()].some((name) => !Object.hasOwn(spec, name)) || Object.entries(spec).some(([name, [min, max]]) => {
    const count = fields.getAll(name).length;
    return count < min || count > max;
  })) return undefined;
  return fields;
}
