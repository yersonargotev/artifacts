import { marked, type Token } from 'marked';
import { slugSchema } from '../contracts.ts';

export type BrokenLinkReason = 'missing' | 'outside' | 'unslugged';
export type LinkCandidate =
  | { readonly kind: 'slug'; readonly slug: string }
  | { readonly kind: 'broken'; readonly reason: BrokenLinkReason };
export type PageLinkCandidate = { readonly href: string; readonly text: string; readonly candidate: LinkCandidate };

const scheme = /^[a-z][a-z0-9+.-]*:/i;

function plainText(token: Token): string {
  if ('tokens' in token && token.tokens) return token.tokens.map(plainText).join('');
  if (token.type === 'br') return ' ';
  return 'text' in token && typeof token.text === 'string' ? token.text : '';
}

export function resolveLink(path: string, from: string | null): LinkCandidate {
  const rooted = path.startsWith('/');
  if (!rooted && from === null) return { kind: 'broken', reason: 'unslugged' };
  const segments = rooted ? [] : from!.split('/').slice(0, -1);
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') segments.push(segment);
    else if (segments.pop() === undefined) return { kind: 'broken', reason: 'outside' };
  }
  let slug: string;
  try { slug = decodeURIComponent(segments.join('/').replace(/\.md$/, '')); }
  catch { return { kind: 'broken', reason: 'missing' }; }
  return slugSchema.safeParse(slug).success ? { kind: 'slug', slug } : { kind: 'broken', reason: 'missing' };
}

// markdown.ts renders the owner preview from the same lexer and looks each link up by href, so both agree on what is a wiki link.
export function pageLinks(markdown: string, from: string | null): PageLinkCandidate[] {
  const links = new Map<string, PageLinkCandidate>();
  marked.walkTokens(marked.lexer(markdown), (token) => {
    if (token.type !== 'link' || links.has(token.href)) return;
    const { href } = token;
    if (scheme.test(href) || href.startsWith('//')) return;
    const path = href.split(/[?#]/, 1)[0]!;
    if (path === '') return;
    links.set(href, { href, text: plainText(token), candidate: resolveLink(path, from) });
  });
  return [...links.values()];
}
