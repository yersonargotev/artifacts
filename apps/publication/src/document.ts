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
  const metadata = `<dl><dt>Título</dt><dd>${escapeHtml(snapshot.metadata.title)}</dd><dt>Descripción</dt><dd>${escapeHtml(snapshot.metadata.description)}</dd>${snapshot.metadata.custom !== undefined ? `<dt>Metadatos personalizados</dt><dd><pre>${escapeHtml(JSON.stringify(snapshot.metadata.custom, null, 2))}</pre></dd>` : ''}<dt>Artefacto</dt><dd>${escapeHtml(artifact.artifactId)}</dd><dt>Revisión</dt><dd>${escapeHtml(artifact.revision.id)}</dd><dt>Cliente autor</dt><dd>${escapeHtml(artifact.revision.authorClientId)}</dd><dt>Creada</dt><dd>${escapeHtml(artifact.revision.createdAt)}</dd><dt>SHA-256</dt><dd>${escapeHtml(artifact.revision.sha256)}</dd><dt>Versión publicada</dt><dd>${artifact.publication?.version ?? 0}</dd></dl>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(snapshot.metadata.title)} · Artifacts</title><style>
*{box-sizing:border-box}body{margin:0;height:100vh;height:100dvh;display:grid;grid-template-rows:auto minmax(0,1fr);background:#151515;color:#ecebe7;font:14px/1.45 system-ui,sans-serif;color-scheme:dark}
header{padding:4px 16px;max-height:45vh;max-height:45dvh;overflow:auto;border-bottom:1px solid #333;background:#151515}
.title-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:12px}.title-row>span{padding:14px 0;color:#a7a6a0;font-size:12px;white-space:nowrap}
.title-menu{min-width:0}.title-menu>summary{display:flex;align-items:center;gap:10px;width:fit-content;max-width:100%;min-height:44px;padding:0 10px;border-radius:8px;list-style:none}.title-menu>summary::-webkit-details-marker{display:none}.title-menu>summary:hover,.title-menu[open]>summary{background:#222}.title-menu>summary>svg{flex:none;color:#a7a6a0}h1{min-width:0;font-size:15px;font-weight:500;line-height:1.4;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.disclosures{display:grid;grid-template-columns:minmax(0,1fr);max-width:700px;padding:8px 10px 4px}.disclosures>details{border-top:1px solid #333;min-width:0}summary{cursor:pointer;min-height:44px;padding:12px 0;font-weight:500}
dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 16px;margin:8px 0 16px;line-height:1.5}dt{color:#a7a6a0}dd{margin:0;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,SFMono-Regular,monospace;margin:0}
main{min-height:0;min-width:0;display:grid}main>iframe{display:block;width:100%;height:100%;min-height:0;border:0;background:white}
nav{display:flex;gap:8px 20px;flex-wrap:wrap;padding:8px 0 16px}a{display:inline-flex;align-items:center;min-height:44px;color:#ecebe7;overflow-wrap:anywhere;max-width:100%;text-underline-offset:3px}a:focus-visible,summary:focus-visible{outline:2px solid #8eb5ff;outline-offset:2px}
@media(max-width:620px){header{padding:4px 8px}.title-row{gap:8px}.title-menu>summary{padding:0 6px}.title-row>span{font-size:11px}.disclosures{padding:8px 6px 4px}dl{grid-template-columns:minmax(0,1fr);gap:4px}dd+dt{margin-top:8px}}
</style></head><body><header><div class="title-row"><details class="title-menu"><summary aria-label="Menú de ${escapeHtml(snapshot.metadata.title)}"><h1>${escapeHtml(snapshot.metadata.title)}</h1><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m6 9 6 6 6-6" /></svg></summary><div class="disclosures"><details class="information"><summary>Información</summary>${metadata}</details><details class="files"><summary>Archivos (${snapshot.files.length})</summary>${files ? `<nav aria-label="Archivos adjuntos">${files}</nav>` : '<p>Esta revisión no tiene archivos adjuntos.</p>'}</details></div></details><span>Revisión ${sequence}</span></div></header><main data-artifact-id="${escapeHtml(artifact.artifactId)}" data-revision-id="${escapeHtml(artifact.revision.id)}" data-revision-sha256="${escapeHtml(artifact.revision.sha256)}" data-publication-version="${escapeHtml(String(artifact.publication?.version ?? 0))}"><iframe title="Contenido del artefacto" sandbox="${interactive ? 'allow-scripts' : ''}" referrerpolicy="no-referrer" srcdoc="${escapeHtml(previewDocument(artifact, interactive))}"></iframe></main></body></html>`;
}

export function attachmentResponse(file: { path: string; mediaType: string; encoding: 'utf8' | 'base64'; data: string }) {
  const bytes = file.encoding === 'utf8' ? new TextEncoder().encode(file.data) : Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0));
  const name = file.path.split('/').at(-1)!;
  return new Response(bytes, { headers: { 'content-type': file.mediaType, 'content-disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name)}`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } });
}
