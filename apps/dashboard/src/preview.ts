import { markdownDocument } from '@artifacts/artifacts/panel/markdown';
import type { PreviewSnapshot } from '@artifacts/artifacts/panel/model';
import { frameLinkScript } from './frame-links.ts';
import { inertPreviewPolicy, markdownPolicy, previewDocument, previewPolicy, supportsInteractiveHtml } from '../../publication/src/document.ts';

/** The document the panel frames for HTML, text, and design: the shared preview document, plus the link script in interactive HTML. */
export const panelPreviewDocument = (artifact: { revision: { snapshot: PreviewSnapshot['revision']['snapshot'] } }, interactive: boolean) =>
  previewDocument(artifact, interactive, interactive && artifact.revision.snapshot.content.kind === 'html' ? frameLinkScript : '');

export function previewResponse({ revision: { snapshot }, links }: PreviewSnapshot, userAgent: string | null) {
  const markdown = snapshot.content.kind === 'markdown';
  const interactive = !markdown && supportsInteractiveHtml(userAgent);
  const body = markdown ? markdownDocument(snapshot.content.text, links ?? []) : panelPreviewDocument({ revision: { snapshot } }, interactive);
  const policy = markdown ? markdownPolicy : interactive ? previewPolicy : inertPreviewPolicy;
  // An empty connection allowlist also blocks the link navigations the Markdown preview exists for. Its sandbox grants no scripts, so nothing else could connect.
  const connections: Record<string, string> = markdown ? {} : { 'connection-allowlist': '()' };
  return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'content-security-policy': policy, ...connections, 'x-dns-prefetch-control': 'off', vary: 'User-Agent' } });
}

// The panel shows a preview error inside its iframe, and the panel's default policy forbids framing.
export function framedPreviewError(response: Response) {
  response.headers.set('content-security-policy', inertPreviewPolicy);
  return response;
}
