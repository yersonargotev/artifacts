import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewResponse } from '../apps/dashboard/src/preview.ts';
import { inertPreviewPolicy, previewDocument, previewPolicy } from '../apps/publication/src/document.ts';
import { markdownDocument } from '../packages/artifacts/src/panel/markdown.ts';
import { brokenLinks, markdownPreviewSandbox, type PageLink } from '../packages/artifacts/src/panel/model.ts';

const body = (markdown: string, links: readonly PageLink[] = []) => {
  const document = markdownDocument(markdown, links);
  assert(document.startsWith('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>'));
  return /<main>([\s\S]*)<\/main>/.exec(document)![1]!;
};

test('Markdown renders headings, lists, tables, code, and emphasis', () => {
  const html = body('# Title\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1 < 2;\n```\n\n*em* **strong** `<code>`');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ul>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/);
  assert.match(html, /<table>[\s\S]*<th>a<\/th>[\s\S]*<td>2<\/td>[\s\S]*<\/table>/);
  assert.match(html, /<pre><code class="language-js">const x = 1 &lt; 2;\n<\/code><\/pre>/);
  assert.match(html, /<em>em<\/em> <strong>strong<\/strong> <code>&lt;code&gt;<\/code>/);
});

test('raw HTML in Markdown comes out as escaped text, block and inline', () => {
  const html = body('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\nSee <a href="javascript:alert(1)">this</a> and <b>bold</b>.');
  assert(!/<script|<img|<a |<b>/.test(html), html);
  assert(html.includes('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'), html);
  assert(html.includes('<p>&lt;img src=x onerror=alert(1)&gt;</p>'));
  assert(html.includes('&lt;a href=&quot;javascript:alert(1)&quot;&gt;this&lt;/a&gt;'));
});

test('links follow their shared resolution, scheme, and fragment rules', () => {
  const links: PageLink[] = [
    { href: '../concepts/rag.md#history', text: 'RAG', target: { state: 'resolved', artifactId: 'id/"x', slug: 'concepts/rag', title: 'Retrieval <RAG>' } },
    { href: '../concepts/missing.md', text: 'gone', target: { state: 'broken', reason: 'missing' } },
    { href: '../../raw/x.md', text: 'raw', target: { state: 'broken', reason: 'outside' } },
  ];
  const html = body('[RAG](../concepts/rag.md#history) [gone](../concepts/missing.md) [raw](../../raw/x.md) [web](https://karpathy.ai "Site") <http://auto.example> [mail](mailto:a@example.com) [top](#intro) [js](javascript:alert(1)) [data](data:text/html,x) [net](//evil.example) [unknown](other.md)', links);
  assert(html.includes('<a href="/artifacts/id%2F%22x" target="_top" title="Retrieval &lt;RAG&gt;">RAG</a>'), html);
  assert(html.includes('<span class="broken-link" title="No existe">gone</span>'));
  assert(html.includes('<span class="broken-link" title="Sale del proyecto">raw</span>'));
  assert(html.includes('<a href="https://karpathy.ai" title="Site" target="_blank" rel="noopener noreferrer">web</a>'));
  assert(html.includes('<a href="http://auto.example" target="_blank" rel="noopener noreferrer">http://auto.example</a>'));
  assert(html.includes('<a href="mailto:a@example.com">mail</a>'));
  assert(html.includes('<a href="#intro">top</a>'));
  assert(html.includes(' js ') && html.includes(' data ') && html.includes(' net ') && html.includes(' unknown'), html);
  assert(!/javascript:|data:text|evil\.example|other\.md/.test(html), 'unsupported targets leave no href behind');
});

test('only data: images render; other images show their alt text', () => {
  const html = body('![diagram](https://example.com/a.png) ![pixel](data:image/png;base64,AA== "Pixel") ![js](javascript:alert(1)) ![<b>](x.png)');
  assert(html.includes('diagram <img src="data:image/png;base64,AA==" alt="pixel" title="Pixel"> js &lt;b&gt;'), html);
  assert(!/https:\/\/example|javascript:|x\.png/.test(html));
});

const snapshot = (kind: 'html' | 'markdown' | 'text', text: string) => ({ metadata: { title: 'Page', description: '' }, content: { kind, text }, files: [] });
const preview = (kind: 'html' | 'markdown' | 'text', text: string, links: readonly PageLink[] | null = null) =>
  ({ artifactId: 'page', links, revision: { id: 'r1', parentRevisionId: null, sequence: 1, authorUserId: 'owner', authorClientId: 'panel', createdAt: '2026-11-07T00:00:00.000Z', sha256: 'x', snapshot: snapshot(kind, text) } });
const chrome = 'Mozilla/5.0 Chrome/156.0.0.0 Safari/537.36';
const firefox = 'Mozilla/5.0 Firefox/152.0';

test('the panel preview renders Markdown under a script-free policy that only adds link navigation', async () => {
  for (const agent of [chrome, firefox]) {
    const response = previewResponse(preview('markdown', '# Wiki [web](https://example.com)', []), agent);
    const policy = response.headers.get('content-security-policy')!;
    assert.equal(policy, `${inertPreviewPolicy} allow-top-navigation-by-user-activation allow-popups allow-popups-to-escape-sandbox`);
    assert(policy.includes("script-src 'none'") && policy.includes("frame-ancestors 'self'") && !/allow-scripts|allow-same-origin/.test(policy));
    assert.equal(markdownPreviewSandbox, 'allow-top-navigation-by-user-activation allow-popups allow-popups-to-escape-sandbox');
    assert.equal(response.headers.get('connection-allowlist'), null, 'an empty allowlist would block the link navigations');
    assert.deepEqual([response.headers.get('cache-control'), response.headers.get('x-dns-prefetch-control')], ['private, no-store', 'off']);
    assert((await response.text()).includes('<h1>Wiki <a href="https://example.com" target="_blank" rel="noopener noreferrer">web</a></h1>'));
  }
});

test('the panel preview of HTML and text keeps its document and policy', async () => {
  for (const [kind, text] of [['html', '<h1>Hi</h1>'], ['text', '# not a heading']] as const) {
    const supported = previewResponse(preview(kind, text), chrome);
    assert.equal(supported.headers.get('content-security-policy'), previewPolicy);
    assert.equal(supported.headers.get('connection-allowlist'), '()');
    assert.equal(await supported.text(), previewDocument({ revision: { snapshot: snapshot(kind, text) } }, true));
    const unsupported = previewResponse(preview(kind, text), firefox);
    assert.equal(unsupported.headers.get('content-security-policy'), inertPreviewPolicy);
    assert.equal(await unsupported.text(), previewDocument({ revision: { snapshot: snapshot(kind, text) } }, false));
  }
});

test('brokenLinks keeps only the links the Enlaces card lists', () => {
  const links: PageLink[] = [
    { href: 'a.md', text: 'a', target: { state: 'resolved', artifactId: 'a', slug: 'a', title: 'A' } },
    { href: 'b.md', text: 'b', target: { state: 'broken', reason: 'missing' } },
  ];
  assert.deepEqual(brokenLinks(links).map(({ href }) => href), ['b.md']);
  assert.deepEqual(brokenLinks(links.slice(0, 1)), []);
});
