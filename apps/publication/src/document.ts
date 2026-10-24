import type { ArtifactRead } from '@artifacts/artifacts/contracts';

export type PublicationUrls = Readonly<{ library: string; project: (name: string) => string; content: string; attachment: (path: string) => string }>;

export const documentPolicy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
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

export function publicationDocument(artifact: ArtifactRead, urls: PublicationUrls, interactive = false) {
  const { snapshot, sequence } = artifact.revision;
  const files = snapshot.files.map((file) => `<a href="${escapeHtml(urls.attachment(file.path))}" download>${escapeHtml(file.path)}</a>`).join('');
  const project = artifact.project === null ? '' : `<nav class="project-navigation" aria-label="Proyecto"><a href="${escapeHtml(urls.project(artifact.project))}" rel="noreferrer" aria-label="Volver al proyecto ${escapeHtml(artifact.project)}" title="Volver al proyecto ${escapeHtml(artifact.project)}"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2 -2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2H5a2 2 0 0 1 -2 -2z"/></svg><span>${escapeHtml(artifact.project)}</span></a></nav>`;
  const metadata = `<dl><dt>Título</dt><dd>${escapeHtml(snapshot.metadata.title)}</dd><dt>Descripción</dt><dd>${escapeHtml(snapshot.metadata.description)}</dd>${snapshot.metadata.custom !== undefined ? `<dt>Metadatos personalizados</dt><dd><pre>${escapeHtml(JSON.stringify(snapshot.metadata.custom, null, 2))}</pre></dd>` : ''}<dt>Artefacto</dt><dd>${escapeHtml(artifact.artifactId)}</dd><dt>Revisión</dt><dd>${escapeHtml(artifact.revision.id)}</dd><dt>Cliente autor</dt><dd>${escapeHtml(artifact.revision.authorClientId)}</dd><dt>Creada</dt><dd>${escapeHtml(artifact.revision.createdAt)}</dd><dt>SHA-256</dt><dd>${escapeHtml(artifact.revision.sha256)}</dd><dt>Versión publicada</dt><dd>${artifact.publication?.version ?? 0}</dd></dl>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(snapshot.metadata.title)} · Artifacts</title><style>
:root{--base:#1e1e2e;--mantle:#181825;--crust:#11111b;--surface0:#313244;--text:#cdd6f4;--subtext0:#a6adc8;--blue:#89b4fa;--sapphire:#74c7ec}
*{box-sizing:border-box}body{margin:0;height:100vh;height:100dvh;display:grid;grid-template-rows:auto minmax(0,1fr);background:var(--base);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,'Avenir Next',Avenir,'Segoe UI','Helvetica Neue',Cantarell,Ubuntu,Roboto,Noto,Helvetica,Arial,sans-serif;color-scheme:dark}
header{padding:6px 16px;max-height:45vh;max-height:45dvh;overflow:auto;border-bottom:1px solid var(--surface0);background:var(--mantle)}
.title-row{display:grid;grid-template-columns:44px minmax(0,1fr) auto;align-items:start;gap:10px}.title-row>span{padding:14px 0;color:var(--subtext0);font-size:12px;white-space:nowrap}
.home{justify-content:center;width:44px;height:44px;border:1px solid var(--surface0);border-radius:10px;background:var(--base);color:var(--blue);text-decoration:none}.home:hover{background:var(--surface0);color:var(--sapphire)}.home>svg{flex:none}
.title-menu{min-width:0}.title-menu>summary{display:flex;align-items:center;gap:10px;width:fit-content;max-width:100%;min-height:44px;padding:0 10px;border-radius:8px;list-style:none}.title-menu>summary::-webkit-details-marker{display:none}.title-menu>summary:hover,.title-menu[open]>summary{background:var(--base)}.title-menu>summary>svg{flex:none;color:var(--blue)}h1{min-width:0;font-size:15px;font-weight:600;line-height:1.4;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.disclosures{display:grid;grid-template-columns:minmax(0,1fr);max-width:700px;padding:8px 10px 4px}.disclosures>details{border-top:1px solid var(--surface0);min-width:0}summary{cursor:pointer;min-height:44px;padding:12px 0;font-weight:500}
dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 16px;margin:8px 0 16px;line-height:1.5}dt{color:var(--subtext0)}dd{margin:0;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,SFMono-Regular,monospace;margin:0;padding:10px;border-radius:8px;background:var(--crust)}
main{min-height:0;min-width:0;display:grid}main>iframe{display:block;width:100%;height:100%;min-height:0;border:0;background:white}
nav{display:flex;gap:8px 20px;flex-wrap:wrap;padding:8px 0 16px}a{display:inline-flex;align-items:center;min-height:44px;color:var(--blue);overflow-wrap:anywhere;max-width:100%;text-underline-offset:3px}nav a:hover{color:var(--sapphire)}a:focus-visible,summary:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.project-navigation{margin-left:54px;padding:0;min-width:0}.project-navigation>a{gap:8px;padding:0 10px;min-width:0}.project-navigation svg{flex:none}.project-navigation span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:620px){header{padding:6px 8px}.title-row{gap:8px}.title-menu>summary{padding:0 6px}.title-row>span{font-size:11px}.disclosures{padding:8px 6px 4px}.project-navigation{margin-left:52px}.project-navigation>a{padding:0 6px}dl{grid-template-columns:minmax(0,1fr);gap:4px}dd+dt{margin-top:8px}}
</style></head><body><header><div class="title-row"><a class="home" href="${escapeHtml(urls.library)}" rel="noreferrer" aria-label="Volver a la biblioteca" title="Volver a la biblioteca"><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l-2 0l9 -9l9 9l-2 0"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7"/><path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6"/></svg></a><details class="title-menu"><summary aria-label="Menú de ${escapeHtml(snapshot.metadata.title)}"><h1>${escapeHtml(snapshot.metadata.title)}</h1><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m6 9 6 6 6-6" /></svg></summary><div class="disclosures"><details class="information"><summary>Información</summary>${metadata}</details><details class="files"><summary>Archivos (${snapshot.files.length})</summary>${files ? `<nav aria-label="Archivos adjuntos">${files}</nav>` : '<p>Esta revisión no tiene archivos adjuntos.</p>'}</details></div></details><span>Revisión ${sequence}</span></div>${project}</header><main data-artifact-id="${escapeHtml(artifact.artifactId)}" data-revision-id="${escapeHtml(artifact.revision.id)}" data-revision-sha256="${escapeHtml(artifact.revision.sha256)}" data-publication-version="${escapeHtml(String(artifact.publication?.version ?? 0))}"><iframe title="Contenido del artefacto" sandbox="${interactive ? 'allow-scripts' : ''}" referrerpolicy="no-referrer" src="${escapeHtml(urls.content)}"></iframe></main></body></html>`;
}

export function attachmentResponse(file: { path: string; mediaType: string; encoding: 'utf8' | 'base64'; data: string }) {
  const bytes = file.encoding === 'utf8' ? new TextEncoder().encode(file.data) : Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0));
  const name = file.path.split('/').at(-1)!;
  return new Response(bytes, { headers: { 'content-type': file.mediaType, 'content-disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name)}`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } });
}
