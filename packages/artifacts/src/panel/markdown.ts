import { Marked, type Tokens } from 'marked';
import { brokenLinkLabels, type PageLink } from './model.ts';

const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const scheme = /^([a-z][a-z0-9+.-]*):/i;
const titled = (title: string | null | undefined) => title ? ` title="${escape(title)}"` : '';

const style = [
  ':root{color:#1f2328;background:#fff;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}',
  'body{margin:0;padding:24px 20px 40px}main{max-width:72ch;margin:0 auto;overflow-wrap:anywhere}main>:first-child{margin-top:0}',
  'h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.4em 0 .5em}h1{font-size:2em}h2{font-size:1.5em;border-bottom:1px solid #d1d9e0;padding-bottom:.3em}',
  'a{color:#0969da}.broken-link{color:#cf222e;text-decoration:underline wavy;text-underline-offset:3px}',
  'code{font:.9em/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:#f6f8fa;border-radius:4px;padding:.15em .35em}',
  'pre{background:#f6f8fa;border-radius:8px;padding:12px 16px;overflow:auto}pre code{padding:0;background:none}',
  'blockquote{margin:0;padding:0 1em;color:#59636e;border-left:4px solid #d1d9e0}',
  'table{border-collapse:collapse;display:block;max-width:100%;overflow:auto}th,td{border:1px solid #d1d9e0;padding:6px 12px}th{background:#f6f8fa}',
  'img{max-width:100%}hr{border:0;border-top:1px solid #d1d9e0}',
].join('');

export function markdownDocument(markdown: string, links: readonly PageLink[]) {
  const byHref = new Map(links.map((link) => [link.href, link]));
  const renderer = new Marked({ gfm: true, async: false, renderer: {
    html: ({ text, block }: Tokens.HTML | Tokens.Tag) => block ? `<p>${escape(text.trimEnd())}</p>\n` : escape(text),
    link(token: Tokens.Link) {
      const body = this.parser.parseInline(token.tokens);
      const { href } = token;
      if (href.startsWith('#')) return `<a href="${escape(href)}"${titled(token.title)}>${body}</a>`;
      const protocol = scheme.exec(href)?.[1]?.toLowerCase();
      if (protocol === 'http' || protocol === 'https') return `<a href="${escape(href)}"${titled(token.title)} target="_blank" rel="noopener noreferrer">${body}</a>`;
      if (protocol === 'mailto') return `<a href="${escape(href)}"${titled(token.title)}>${body}</a>`;
      const link = protocol === undefined ? byHref.get(href) : undefined;
      if (link?.target.state === 'resolved') return `<a href="/artifacts/${escape(encodeURIComponent(link.target.artifactId))}" target="_top"${titled(link.target.title)}>${body}</a>`;
      if (link?.target.state === 'broken') return `<span class="broken-link" title="${escape(brokenLinkLabels[link.target.reason])}">${body}</span>`;
      return body;
    },
    image: ({ href, title, text }: Tokens.Image) => /^data:image\//i.test(href) ? `<img src="${escape(href)}" alt="${escape(text)}"${titled(title)}>` : escape(text),
  } });
  const body = renderer.parse(markdown) as string;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>${style}</style></head><body><main>${body}</main></body></html>`;
}
