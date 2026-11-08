import { markdownDocument } from '@artifacts/artifacts/panel/markdown';
import { markdownPreviewSandbox, type PreviewSnapshot } from '@artifacts/artifacts/panel/model';
import { inertPreviewPolicy, previewDocument, previewPolicy, supportsInteractiveHtml } from '../../publication/src/document.ts';

export const markdownPreviewPolicy = `${inertPreviewPolicy} ${markdownPreviewSandbox}`;

export function previewResponse({ revision: { snapshot }, links }: PreviewSnapshot, userAgent: string | null) {
  const markdown = snapshot.content.kind === 'markdown';
  const interactive = !markdown && supportsInteractiveHtml(userAgent);
  const body = markdown ? markdownDocument(snapshot.content.text, links ?? []) : previewDocument({ revision: { snapshot } }, interactive);
  const policy = markdown ? markdownPreviewPolicy : interactive ? previewPolicy : inertPreviewPolicy;
  // An empty connection allowlist also blocks the link navigations the Markdown preview exists for. Its sandbox grants no scripts, so nothing else could connect.
  const connections: Record<string, string> = markdown ? {} : { 'connection-allowlist': '()' };
  return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'content-security-policy': policy, ...connections, 'x-dns-prefetch-control': 'off', vary: 'User-Agent' } });
}
