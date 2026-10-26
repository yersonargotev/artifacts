import type { ArtifactRead, SharedRead, Snapshot } from '@artifacts/artifacts/contracts';

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

export function previewDocument(artifact: { revision: { snapshot: Pick<Snapshot, 'content'> } }, interactive = false) {
  const { content } = artifact.revision.snapshot;
  const body = content.kind === 'html' && interactive ? content.text : `${content.kind === 'html' ? '<p>Vista de código. Abre este HTML en Chrome 152 o posterior para usar su versión interactiva.</p>' : ''}<pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:17px/1.6 system-ui">${escapeHtml(content.text)}</pre>`;
  const policy = interactive ? framePolicy : framePolicy.replace("script-src 'unsafe-inline'", "script-src 'none'");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(policy)}"><meta name="referrer" content="no-referrer"></head><body>${body}</body></html>`;
}

export function publicationDocument(artifact: ArtifactRead | SharedRead, urls: PublicationUrls, interactive = false) {
  const { snapshot } = artifact.revision;
  const owner = 'ownerId' in artifact ? artifact : null;
  const guest = 'ownerName' in artifact ? artifact : null;
  const library = guest ? new URL('#shared-with-me', urls.library).href : urls.library;
  const attribution = guest ? `<p class="shared-owner">Compartido por ${escapeHtml(guest.ownerName)}</p>` : '';
  const guestStyle = guest ? '.shared-owner{margin:0 10px 6px 64px;color:var(--subtext0);overflow-wrap:anywhere}@media(max-width:620px){.shared-owner{margin-left:58px}}' : '';
  const files = snapshot.files.map((file) => `<a href="${escapeHtml(urls.attachment(file.path))}" download>${escapeHtml(file.path)}</a>`).join('');
  const projectName = owner?.project ?? null;
  const project = projectName === null ? '' : `<nav class="project-navigation" aria-label="Proyecto"><span class="route-separator" aria-hidden="true">/</span><a href="${escapeHtml(urls.project(projectName))}" rel="noreferrer" aria-label="Volver al proyecto ${escapeHtml(projectName)}" title="Volver al proyecto ${escapeHtml(projectName)}"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2 -2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2H5a2 2 0 0 1 -2 -2z"/></svg><span>${escapeHtml(projectName)}</span></a><span class="route-separator" aria-hidden="true">/</span></nav>`;
  const metadata = `<dl><dt>Título</dt><dd>${escapeHtml(snapshot.metadata.title)}</dd><dt>Descripción</dt><dd>${escapeHtml(snapshot.metadata.description)}</dd>${snapshot.metadata.custom !== undefined ? `<dt>Metadatos personalizados</dt><dd><pre>${escapeHtml(JSON.stringify(snapshot.metadata.custom, null, 2))}</pre></dd>` : ''}<dt>Artefacto</dt><dd>${escapeHtml(artifact.artifactId)}</dd><dt>Revisión</dt><dd>${escapeHtml(artifact.revision.id)}</dd>${owner ? `<dt>Cliente autor</dt><dd>${escapeHtml(owner.revision.authorClientId)}</dd>` : ''}<dt>Creada</dt><dd>${escapeHtml(artifact.revision.createdAt)}</dd><dt>SHA-256</dt><dd>${escapeHtml(artifact.revision.sha256)}</dd><dt>Versión publicada</dt><dd>${artifact.publication?.version ?? 0}</dd></dl>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(snapshot.metadata.title)} · Artifacts</title><style>
:root{--base:#1e1e2e;--mantle:#181825;--crust:#11111b;--surface0:#313244;--text:#cdd6f4;--subtext0:#a6adc8;--blue:#89b4fa;--sapphire:#74c7ec}
*{box-sizing:border-box}body{margin:0;height:100vh;height:100dvh;display:grid;grid-template-rows:auto minmax(0,1fr);background:var(--base);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,'Avenir Next',Avenir,'Segoe UI','Helvetica Neue',Cantarell,Ubuntu,Roboto,Noto,Helvetica,Arial,sans-serif;color-scheme:dark}
header{min-width:0;position:relative;z-index:1;padding:6px 12px;border-bottom:1px solid var(--surface0);background:var(--mantle)}
.title-row{display:flex;align-items:center;gap:8px;height:44px;min-width:0}.revision{flex:none;padding:0 4px 0 12px;color:var(--subtext0);font-size:12px;white-space:nowrap}.revision-short{display:none}
.home{flex:none;justify-content:center;width:44px;height:44px;border-radius:7px;color:var(--subtext0);text-decoration:none}.home:hover{background:var(--surface0);color:var(--text)}.home>svg{flex:none;width:19px;height:19px}
.title-menu{flex:1 1 0;min-width:0}.title-menu>summary{display:flex;align-items:center;gap:8px;width:fit-content;max-width:100%;min-height:44px;padding:0 7px;border-radius:7px;list-style:none}.title-menu>summary::-webkit-details-marker{display:none}.title-menu>summary:hover,.title-menu[open]>summary{background:var(--base)}.title-menu>summary>svg{flex:none;width:13px;height:13px;color:var(--subtext0)}h1{min-width:0;font-size:14px;font-weight:500;line-height:1.4;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.disclosures{position:absolute;top:calc(100% + 6px);left:60px;display:grid;grid-template-columns:minmax(0,1fr);width:340px;max-width:calc(100% - 76px);max-height:45vh;max-height:min(45dvh,calc(100dvh - 80px));overflow:auto;padding:12px;border:1px solid var(--surface0);border-radius:10px;background:var(--mantle);box-shadow:0 10px 35px #0003}.menu-title{margin:2px 4px 12px;font-weight:500;overflow-wrap:anywhere}.disclosures>details{border-top:1px solid var(--surface0);min-width:0}summary{cursor:pointer;min-height:44px;padding:12px 0;font-weight:500}
dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 16px;margin:8px 0 16px;line-height:1.5}dt{color:var(--subtext0)}dd{margin:0;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,SFMono-Regular,monospace;margin:0;padding:10px;border-radius:8px;background:var(--crust)}
main{min-height:0;min-width:0;display:grid}main>iframe{display:block;width:100%;height:100%;min-height:0;border:0;background:white}
nav{display:flex;gap:8px 20px;flex-wrap:wrap;padding:8px 0 16px}a{display:inline-flex;align-items:center;min-height:44px;color:var(--blue);overflow-wrap:anywhere;max-width:100%;text-underline-offset:3px}nav a:hover{color:var(--sapphire)}a:focus-visible,summary:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.project-navigation{flex:0 1 auto;align-items:center;flex-wrap:nowrap;gap:4px;max-width:28%;min-width:0;padding:0}.project-navigation>a{flex:1 1 auto;gap:7px;min-width:44px;padding:0 6px;border-radius:7px;color:var(--subtext0);text-decoration:none}.project-navigation>a:hover{background:var(--surface0);color:var(--text)}.project-navigation svg{flex:none;width:16px;height:16px}.project-navigation>a>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.route-separator{flex:none;color:var(--surface0);font-size:17px;user-select:none}
@media(max-width:620px){header{padding:6px}.title-row{gap:3px}.title-menu>summary{gap:4px;padding:0 4px}h1{font-size:13px}.revision{padding:0 4px 0 5px;font-size:11px}.revision-full{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}.revision-short{display:inline}.project-navigation{gap:3px}.project-navigation>a{padding:0 5px}.project-navigation svg{display:none}.route-separator{font-size:15px}.disclosures{left:12px;max-width:calc(100% - 24px)}dl{grid-template-columns:minmax(0,1fr);gap:4px}dd+dt{margin-top:8px}}
${guestStyle}</style></head><body><header><div class="title-row"><a class="home" href="${escapeHtml(library)}" rel="noreferrer" aria-label="Volver a la biblioteca" title="Volver a la biblioteca"><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l-2 0l9 -9l9 9l-2 0"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7"/><path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6"/></svg></a>${project}<details class="title-menu"><summary aria-label="Menú de ${escapeHtml(snapshot.metadata.title)}" title="${escapeHtml(snapshot.metadata.title)}"><h1>${escapeHtml(snapshot.metadata.title)}</h1><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m6 9 6 6 6-6" /></svg></summary><div class="disclosures"><p class="menu-title">${escapeHtml(snapshot.metadata.title)}</p><details class="information"><summary>Información</summary>${metadata}</details><details class="files"><summary>Archivos (${snapshot.files.length})</summary>${files ? `<nav aria-label="Archivos adjuntos">${files}</nav>` : '<p>Esta revisión no tiene archivos adjuntos.</p>'}</details></div></details>${owner ? `<span class="revision" aria-label="Revisión ${owner.revision.sequence}"><span class="revision-full">Revisión ${owner.revision.sequence}</span><span class="revision-short" aria-hidden="true">R${owner.revision.sequence}</span></span>` : ''}</div>${attribution}</header><main data-artifact-id="${escapeHtml(artifact.artifactId)}" data-revision-id="${escapeHtml(artifact.revision.id)}" data-revision-sha256="${escapeHtml(artifact.revision.sha256)}" data-publication-version="${escapeHtml(String(artifact.publication?.version ?? 0))}"><iframe title="Contenido del artefacto" sandbox="${interactive ? 'allow-scripts' : ''}" referrerpolicy="no-referrer" src="${escapeHtml(urls.content)}"></iframe></main></body></html>`;
}

export function attachmentResponse(file: { path: string; mediaType: string; encoding: 'utf8' | 'base64'; data: string }) {
  const bytes = file.encoding === 'utf8' ? new TextEncoder().encode(file.data) : Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0));
  const name = file.path.split('/').at(-1)!;
  return new Response(bytes, { headers: { 'content-type': file.mediaType, 'content-disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name)}`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } });
}
