import type { ArtifactRead } from '@artifacts/artifacts/contracts';

export const documentPolicy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const framePolicy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const previewPolicy = `${framePolicy}; frame-ancestors 'self'; sandbox allow-scripts`;
export const inertPreviewPolicy = `${framePolicy.replace("script-src 'unsafe-inline'", "script-src 'none'")}; frame-ancestors 'self'; sandbox`;

export function supportsInteractiveHtml(userAgent: string | null) {
  if (!userAgent || /Edg|OPR|SamsungBrowser|CriOS|FxiOS/.test(userAgent)) return false;
  const version = /(?:Headless)?Chrome\/(\d+)\./.exec(userAgent);
  return version !== null && Number(version[1]) >= 152;
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function previewDocument(artifact: ArtifactRead, interactive = false) {
  const { content } = artifact.revision.snapshot;
  const body = content.kind === 'html' && interactive ? content.text : `${content.kind === 'html' ? '<p>Vista de código. Abre este HTML en Chrome 152 o posterior para usar su versión interactiva.</p>' : ''}<pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:17px/1.6 system-ui">${escapeHtml(content.text)}</pre>`;
  const policy = interactive ? framePolicy : framePolicy.replace("script-src 'unsafe-inline'", "script-src 'none'");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(policy)}"><meta name="referrer" content="no-referrer"></head><body>${body}</body></html>`;
}

export function publicationDocument(artifact: ArtifactRead, attachmentUrl: (path: string) => string, interactive = false) {
  const { snapshot, sequence } = artifact.revision;
  const files = snapshot.files.map((file) => `<a href="${escapeHtml(attachmentUrl(file.path))}" download>${escapeHtml(file.path)}</a>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(snapshot.metadata.title)} · Artifacts</title><style>*{box-sizing:border-box}body{margin:0;background:#eaf0f5;color:#132943;font:17px Optima,Candara,system-ui}header{padding:24px 32px;display:flex;gap:24px;justify-content:space-between;align-items:baseline;border-bottom:1px solid #c7d5e3}h1{font-size:25px;font-weight:500;margin:0}p{margin:8px 0 0;color:#48617b}main{padding:24px;max-width:1400px;margin:auto}iframe{display:block;width:100%;height:75vh;min-height:420px;border:0;background:white;border-radius:8px}nav{display:flex;gap:16px;flex-wrap:wrap;padding:24px 0}a{color:#2546c0;overflow-wrap:anywhere}a:focus-visible{outline:3px solid #6885ff;outline-offset:4px}@media(max-width:620px){header{padding:20px 24px;display:block}header span{display:block;margin-top:12px}main{padding:16px}iframe{height:75vh}}</style></head><body><header><div><h1>${escapeHtml(snapshot.metadata.title)}</h1><p>${escapeHtml(snapshot.metadata.description)}</p></div><span>Revisión ${sequence}</span></header><main data-artifact-id="${escapeHtml(artifact.artifactId)}" data-revision-id="${escapeHtml(artifact.revision.id)}" data-revision-sha256="${escapeHtml(artifact.revision.sha256)}" data-publication-version="${escapeHtml(String(artifact.publication?.version ?? 0))}"><iframe title="Contenido del artefacto" sandbox="${interactive ? 'allow-scripts' : ''}" referrerpolicy="no-referrer" srcdoc="${escapeHtml(previewDocument(artifact, interactive))}"></iframe>${files ? `<nav aria-label="Archivos adjuntos">${files}</nav>` : ''}</main></body></html>`;
}

export function attachmentResponse(file: { path: string; mediaType: string; encoding: 'utf8' | 'base64'; data: string }) {
  const bytes = file.encoding === 'utf8' ? new TextEncoder().encode(file.data) : Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0));
  const name = file.path.split('/').at(-1)!;
  return new Response(bytes, { headers: { 'content-type': file.mediaType, 'content-disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name)}`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } });
}
