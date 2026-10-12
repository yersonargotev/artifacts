import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { unzipSync, zipSync, type Zippable } from 'fflate';
import type { BrowserContext, Frame, Locator, Page, Response as BrowserResponse } from 'playwright';
import { artifactReadSchema, decodeFile, type ArtifactRead } from '../../../../packages/artifacts/src/contracts.ts';
import { documentPolicy, inertPreviewPolicy, previewDocument, previewPolicy, supportsInteractiveHtml } from '../../../../apps/publication/src/document.ts';

export type ContentExpectation =
  | { kind: 'text'; selector: string; text: string }
  | { kind: 'count'; selector: string; count: number }
  | { kind: 'visible'; selector: string }
  | { kind: 'attribute'; selector: string; name: string; value: string | null }
  | { kind: 'click'; selector: string }
  | { kind: 'fill'; selector: string; value: string }
  | { kind: 'check'; selector: string; checked: boolean }
  | { kind: 'select'; selector: string; values: string[] };

export type RetainedVerificationConfig = {
  expected: ArtifactRead;
  panelUrl: string;
  publicationUrl?: string;
  viewports: { width: number; height: number }[];
  expectations: ContentExpectation[];
  evidenceDirectory: string;
  timeoutMs?: number;
};

type IdentityEvidence = 'markers' | 'legacy';
export type RetainedVerificationReport = {
  status: 'passed' | 'failed';
  artifactId: string;
  revisionId: string;
  sha256: string;
  publication: 'verified' | 'not-requested';
  browserVersion: string;
  interactive: boolean;
  evidenceDirectory: string;
  checks: string[];
  viewports: { width: number; height: number; panel: IdentityEvidence; publication?: IdentityEvidence }[];
  attachments: { path: string; bytes: number; sha256: string }[];
  requests: { method: string; url: string }[];
  errors: { kind: 'console' | 'page' | 'mutation' | 'verification'; message: string }[];
};

const markerNames = ['data-artifact-id', 'data-revision-id', 'data-revision-sha256', 'data-publication-version'] as const;
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const canonicalJson = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
const contentPath = (expected: ArtifactRead) => `content.${{ html: 'html', markdown: 'md', text: 'txt' }[expected.revision.snapshot.content.kind]}`;
const safeUrl = (value: string) => { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? `${url.origin}${url.pathname}` : url.protocol === 'about:' ? `about:${url.pathname}` : url.protocol; };
const safeMessage = (value: string) => value.replace(/https?:\/\/[^\s"'<>]+/g, (url) => { try { return safeUrl(url); } catch { return '[URL]'; } }).slice(0, 1000);

function object(value: unknown, name: string): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`);
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], name: string) {
  assert(required.every((key) => Object.hasOwn(value, key)), `${name} has missing fields`);
  assert(Object.keys(value).every((key) => required.includes(key) || optional.includes(key)), `${name} has unknown fields`);
}

function string(value: unknown, name: string): asserts value is string { assert(typeof value === 'string' && value.length > 0 && value.length <= 8192, `${name} must be a nonempty string`); }

function absoluteUrl(value: unknown, name: string) {
  string(value, name);
  const url = new URL(value);
  assert(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.hash, `${name} must be an HTTP URL without credentials or fragment`);
  return url;
}

export function parseRetainedVerificationConfig(value: unknown): RetainedVerificationConfig {
  const input = object(value, 'config');
  keys(input, ['expected', 'panelUrl', 'viewports', 'expectations', 'evidenceDirectory'], ['publicationUrl', 'timeoutMs'], 'config');
  const expected = artifactReadSchema.parse(input.expected);
  assert.equal(hash(canonicalJson(expected.revision.snapshot)), expected.revision.sha256, 'Expected snapshot SHA-256 must match its saved revision');
  const panel = absoluteUrl(input.panelUrl, 'panelUrl');
  assert.equal(panel.pathname, `/artifacts/${encodeURIComponent(expected.artifactId)}`, 'panelUrl must select the expected artifact');
  assert.equal(panel.searchParams.get('revisionId'), expected.revision.id, 'panelUrl must pin the expected revision');
  assert.equal(panel.searchParams.getAll('revisionId').length, 1, 'panelUrl must have one revisionId');
  assert.equal(panel.searchParams.size, 1, 'panelUrl must contain only revisionId');
  if (input.publicationUrl !== undefined) {
    const publication = absoluteUrl(input.publicationUrl, 'publicationUrl');
    assert(expected.publication, 'Publication coverage requires a saved publication');
    assert.equal(expected.publication.revisionId, expected.revision.id, 'Publication coverage requires the selected revision to be published');
    assert.equal(publication.href, expected.publication.url, 'publicationUrl must equal the saved stable URL');
    assert.equal(publication.pathname, `/a/${encodeURIComponent(expected.artifactId)}`, 'publicationUrl must select the expected artifact');
    assert.equal(publication.search, '', 'publicationUrl must be stable');
  }
  assert(Array.isArray(input.viewports) && input.viewports.length > 0 && input.viewports.length <= 10, 'viewports must contain 1 to 10 sizes');
  const viewports = input.viewports.map((value) => {
    const viewport = object(value, 'viewport');
    keys(viewport, ['width', 'height'], [], 'viewport');
    for (const name of ['width', 'height'] as const) assert(Number.isInteger(viewport[name]) && Number(viewport[name]) >= 240 && Number(viewport[name]) <= 7680, `viewport ${name} must be an integer from 240 to 7680`);
    return { width: viewport.width as number, height: viewport.height as number };
  });
  assert(Array.isArray(input.expectations) && input.expectations.length <= 100, 'expectations must be an array of at most 100 content checks');
  const fields = { text: ['text'], count: ['count'], visible: [], attribute: ['name', 'value'], click: [], fill: ['value'], check: ['checked'], select: ['values'] } as const;
  const expectations = input.expectations.map((value) => {
    const expectation = object(value, 'expectation');
    string(expectation.kind, 'expectation kind');
    assert(Object.hasOwn(fields, expectation.kind), 'Unknown content expectation kind');
    const kind = expectation.kind as keyof typeof fields;
    keys(expectation, ['kind', 'selector', ...fields[kind]], [], 'expectation');
    string(expectation.selector, 'content selector');
    if (kind === 'text') assert(typeof expectation.text === 'string', 'Expected text must be a string');
    if (kind === 'count') assert(Number.isInteger(expectation.count) && Number(expectation.count) >= 0, 'Expected count must be a nonnegative integer');
    if (kind === 'attribute') { string(expectation.name, 'attribute name'); assert(expectation.value === null || typeof expectation.value === 'string', 'Expected attribute must be a string or null'); }
    if (kind === 'fill') assert(typeof expectation.value === 'string', 'Fill value must be a string');
    if (kind === 'check') assert(typeof expectation.checked === 'boolean', 'Checked value must be boolean');
    if (kind === 'select') assert(Array.isArray(expectation.values) && expectation.values.every((value) => typeof value === 'string'), 'Select values must be strings');
    return expectation as ContentExpectation;
  });
  string(input.evidenceDirectory, 'evidenceDirectory');
  if (input.timeoutMs !== undefined) assert(Number.isInteger(input.timeoutMs) && Number(input.timeoutMs) >= 100 && Number(input.timeoutMs) <= 60_000, 'timeoutMs must be an integer from 100 to 60000');
  return { expected, panelUrl: panel.href, ...(input.publicationUrl !== undefined ? { publicationUrl: input.publicationUrl as string } : {}), viewports, expectations, evidenceDirectory: resolve(input.evidenceDirectory), ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs as number } : {}) };
}

export function expectedRetainedArchive(expected: ArtifactRead): Uint8Array {
  const { snapshot, ...revision } = expected.revision;
  const files = [...snapshot.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const path = contentPath(expected);
  const manifest = { formatVersion: 1, artifactId: expected.artifactId, ownerId: expected.ownerId, revision, metadata: snapshot.metadata, content: { kind: snapshot.content.kind, path }, files: files.map((file) => ({ path: file.path, mediaType: file.mediaType, encoding: file.encoding, size: decodeFile(file).length, sha256: hash(decodeFile(file)) })) };
  const members: Zippable = { 'artifact.json': Buffer.from(`${canonicalJson(manifest)}\n`), [path]: Buffer.from(snapshot.content.text) };
  for (const file of files) members[`files/${file.path}`] = decodeFile(file);
  return zipSync(members, { level: 0, mtime: new Date(1980, 0, 1, 0, 0, 0), os: 0, attrs: 0 });
}

export function compareRetainedArchive(bytes: Uint8Array, expected: ArtifactRead) {
  const actual = unzipSync(bytes);
  const savedBytes = expectedRetainedArchive(expected);
  const saved = unzipSync(savedBytes);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(saved).sort(), 'Panel ZIP must contain the complete retained inventory');
  for (const [path, data] of Object.entries(saved)) assert.deepEqual(Buffer.from(actual[path]!), Buffer.from(data), `Panel ZIP bytes differ for ${path}`);
  assert.deepEqual(Buffer.from(bytes), Buffer.from(savedBytes), 'Panel ZIP must match the independently constructed saved export exactly');
}

async function identity(page: Page, expected: ArtifactRead): Promise<IdentityEvidence> {
  const sets = await page.locator(markerNames.map((name) => `[${name}]`).join(',')).evaluateAll((elements, names) => elements.map((element) => names.map((name) => element.getAttribute(name))), [...markerNames]);
  if (sets.length === 0) return 'legacy';
  assert.equal(sets.length, 1, 'Exact-state markers must occur on one wrapper');
  assert.deepEqual(sets[0], [expected.artifactId, expected.revision.id, expected.revision.sha256, String(expected.publication?.version ?? 0)], 'Exact-state markers are partial, malformed or mismatched');
  return 'markers';
}

async function panelPublication(page: Page, expected: ArtifactRead, mode: IdentityEvidence) {
  if (mode === 'markers') return;
  const section = page.locator('iframe.preview').locator('xpath=..');
  assert.equal(await section.count(), 1, 'Legacy panel must have one selected revision section');
  assert.equal(await section.locator('dt').filter({ hasText: /^Revisión$/ }).locator('xpath=following-sibling::dd[1]').textContent(), expected.revision.id, 'Legacy panel must display the selected revision ID');
  assert.equal(await section.locator('dt').filter({ hasText: /^SHA-256$/ }).locator('xpath=following-sibling::dd[1]').textContent(), expected.revision.sha256, 'Legacy panel must display the selected SHA-256');
  assert.equal(await section.locator('h2').textContent(), `Revisión ${expected.revision.sequence}`, 'Legacy panel revision sequence differs');
  const publication = page.locator('section.publication');
  if (expected.publication) {
    assert.match((await publication.textContent())!, new RegExp(`Versión ${expected.publication.version}\\.`), 'Legacy panel publication version differs');
    assert.equal(await publication.getByRole('link', { name: 'Abrir publicación', exact: true }).getAttribute('href'), expected.publication.url, 'Legacy panel stable publication URL differs');
    if (expected.publication.revisionId === expected.revision.id) assert.equal(await section.locator('.badge').filter({ hasText: /^Publicada$/ }).count(), 1, 'Legacy panel must identify the exact selected revision as published');
  } else {
    assert.equal(await publication.locator('a').count(), 0, 'Legacy panel unexpectedly has a publication');
    assert.match((await publication.textContent())!, /aún no está publicado/, 'Legacy panel must identify an unpublished artifact');
  }
}

async function policy(response: BrowserResponse, value: string, name: string) {
  assert.equal(response.status(), 200, `${name} must respond successfully`);
  const headers = response.headers();
  assert.equal(headers['content-security-policy'], value, `${name} CSP differs`);
  assert.equal(headers['connection-allowlist'], '()', `${name} must retain connection containment`);
  assert.equal(headers['x-dns-prefetch-control'], 'off', `${name} must disable DNS prefetch`);
  assert(['private, no-store', 'no-store'].includes(headers['cache-control']!), `${name} must forbid storage`);
}

async function contentFrame(page: Page, iframe: Locator, interactive: boolean) {
  assert.equal(await iframe.count(), 1, 'One real content iframe is required');
  assert.equal(await iframe.getAttribute('sandbox'), interactive ? 'allow-scripts' : '', 'Content iframe sandbox differs');
  assert.equal(await iframe.getAttribute('referrerpolicy'), 'no-referrer', 'Content iframe must suppress referrers');
  const frame = await (await iframe.elementHandle())!.contentFrame();
  assert(frame, 'Real content frame must be loaded');
  await frame.waitForLoadState('load');
  return frame;
}

async function expectations(frame: Frame, values: ContentExpectation[], timeout: number) {
  for (const value of values) {
    const locator = frame.locator(value.selector);
    if (value.kind === 'click') await locator.click();
    else if (value.kind === 'fill') await locator.fill(value.value);
    else if (value.kind === 'check') await locator.setChecked(value.checked);
    else if (value.kind === 'select') await locator.selectOption(value.values);
    else if (value.kind === 'visible') await locator.waitFor({ state: 'visible' });
    else {
      const until = Date.now() + timeout;
      let actual: unknown;
      const target = value.kind === 'text' ? value.text : value.kind === 'count' ? value.count : value.value;
      do {
        actual = value.kind === 'count' ? await locator.count() : value.kind === 'attribute' ? await locator.getAttribute(value.name) : await locator.innerText();
        if (actual === target) break;
        await new Promise((done) => setTimeout(done, 50));
      } while (Date.now() < until);
      assert.equal(actual, target, `Content ${value.kind} expectation failed for ${value.selector}`);
    }
  }
}

async function overflow(page: Page, frame: Frame) {
  const wrapper = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert(wrapper.scrollWidth <= wrapper.width + 1, `Wrapper overflows horizontally by ${wrapper.scrollWidth - wrapper.width}px`);
  const content = await frame.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert(content.scrollWidth <= content.width + 1, `Content frame overflows horizontally by ${content.scrollWidth - content.width}px`);
}

async function viewerBounds(page: Page) {
  const bounds = await page.evaluate(() => {
    const header = document.querySelector('header')!.getBoundingClientRect();
    const frame = document.querySelector('main > iframe')!.getBoundingClientRect();
    return { height: innerHeight, header: header.height, frame: frame.height, bottom: frame.bottom, scrollHeight: document.documentElement.scrollHeight };
  });
  assert(bounds.header <= bounds.height * .45 + 1, 'Viewer disclosures must leave the majority of the viewport for the artifact');
  assert(bounds.frame >= bounds.height * .55 - 1 && bounds.bottom <= bounds.height + 1 && bounds.scrollHeight <= bounds.height + 1, 'Viewer frame must fill the usable remainder without wrapper overflow');
}

export async function verifyRetainedArtifact(context: BrowserContext, input: RetainedVerificationConfig): Promise<RetainedVerificationReport> {
  const config = parseRetainedVerificationConfig(input);
  const { expected } = config;
  await mkdir(config.evidenceDirectory, { mode: 0o700 });
  await chmod(config.evidenceDirectory, 0o700);
  const report: RetainedVerificationReport = { status: 'failed', artifactId: expected.artifactId, revisionId: expected.revision.id, sha256: expected.revision.sha256, publication: 'not-requested', browserVersion: context.browser()?.version() ?? 'unknown', interactive: false, evidenceDirectory: config.evidenceDirectory, checks: [], viewports: [], attachments: [], requests: [], errors: [] };
  const pages: Page[] = [];
  const timeout = config.timeoutMs ?? 10_000;
  const json = (name: string, value: unknown) => writeFile(join(config.evidenceDirectory, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  const createPage = async () => {
    const page = await context.newPage();
    pages.push(page);
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);
    page.on('console', (message) => { if (message.type() === 'error') report.errors.push({ kind: 'console', message: safeMessage(message.text()) }); });
    page.on('pageerror', (error) => report.errors.push({ kind: 'page', message: safeMessage(error.message) }));
    page.on('request', (request) => report.requests.push({ method: request.method(), url: safeUrl(request.url()) }));
    await page.route('**/*', async (route) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
        report.errors.push({ kind: 'mutation', message: `Refused ${route.request().method()} ${safeUrl(route.request().url())}` });
        await route.abort();
      } else await route.continue();
    });
    return page;
  };
  const capture = async (page: Page, name: string) => {
    const path = join(config.evidenceDirectory, `${name}.png`);
    await page.screenshot({ path, fullPage: true });
    await chmod(path, 0o600);
  };
  try {
    const panel = await createPage();
    const publication = config.publicationUrl ? await createPage() : undefined;
    const observer = config.publicationUrl ? await createPage() : undefined;
    report.interactive = supportsInteractiveHtml(await panel.evaluate(() => navigator.userAgent));
    const previewUrl = new URL(`/artifacts/${encodeURIComponent(expected.artifactId)}/preview?${new URLSearchParams({ revisionId: expected.revision.id })}`, config.panelUrl).href;
    const exportUrl = new URL(`/artifacts/${encodeURIComponent(expected.artifactId)}/export?${new URLSearchParams({ revisionId: expected.revision.id })}`, config.panelUrl).href;
    const archive = expectedRetainedArchive(expected);
    await writeFile(join(config.evidenceDirectory, 'expected.zip'), archive, { mode: 0o600 });
    const checkPublicationState = async () => {
      assert(observer);
      const response = await observer.goto(config.panelUrl);
      assert.equal(response?.status(), 200, 'Independent panel publication read must succeed');
      assert.equal(observer.url(), config.panelUrl, 'Independent panel read must retain the selected URL');
      const mode = await identity(observer, expected);
      await panelPublication(observer, expected, mode);
      if (mode === 'markers') {
        const section = observer.locator('iframe.preview').locator('xpath=..');
        assert.equal(await section.locator('.badge').filter({ hasText: /^Publicada$/ }).count(), 1, 'Independent panel read must still identify the selected published revision');
      }
    };
    if (observer) { await checkPublicationState(); report.checks.push('Independent publication revision and version before browser checks'); }
    for (const [index, viewport] of config.viewports.entries()) {
      await panel.setViewportSize(viewport);
      const previewResponse = panel.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/preview') && response.request().resourceType() === 'document');
      const [panelResponse, realPreview] = await Promise.all([panel.goto(config.panelUrl), previewResponse]);
      assert.equal(panelResponse?.status(), 200, 'Selected panel must respond successfully');
      assert.equal(panel.url(), config.panelUrl, 'Panel must retain its exact selected URL');
      assert.match(panelResponse!.headers()['content-security-policy'] ?? '', /frame-src 'self'/, 'Panel must retain same-origin frames');
      const panelMode = await identity(panel, expected);
      await panelPublication(panel, expected, panelMode);
      const iframe = panel.locator('iframe.preview');
      assert.equal(new URL((await iframe.getAttribute('src'))!, config.panelUrl).href, previewUrl, 'Panel preview URL must pin the exact revision');
      assert.equal(realPreview.url(), previewUrl, 'Actual iframe response must come from the pinned preview URL');
      await policy(realPreview, report.interactive ? previewPolicy : inertPreviewPolicy, 'Actual iframe preview response');
      assert.deepEqual(await realPreview.body(), Buffer.from(previewDocument(expected, report.interactive)), 'Actual iframe response bytes differ from the expected retained content');
      const frame = await contentFrame(panel, iframe, true);
      assert.equal(frame.url(), previewUrl, 'Actual content frame must load the exact pinned preview URL');
      const exactExport = panel.getByRole('link', { name: `Descargar revisión ${expected.revision.sequence}`, exact: true }).first();
      assert.equal(new URL((await exactExport.getAttribute('href'))!, config.panelUrl).href, exportUrl, 'Selected export URL must pin the expected revision');
      const downloadPromise = panel.waitForEvent('download');
      await exactExport.click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), `${expected.artifactId}-${expected.revision.id}.zip`, 'Panel export filename differs');
      const archivePath = join(config.evidenceDirectory, `panel-${index}.zip`);
      await download.saveAs(archivePath);
      await chmod(archivePath, 0o600);
      compareRetainedArchive(await readFile(archivePath), expected);
      if (index === 0) report.attachments = expected.revision.snapshot.files.map((file) => ({ path: file.path, bytes: decodeFile(file).length, sha256: hash(decodeFile(file)) }));
      await expectations(frame, config.expectations, timeout);
      assert.equal(frame.url(), previewUrl, 'Content expectations must not replace the actual panel frame');
      await overflow(panel, frame);
      await capture(panel, `panel-${index}`);
      const result: RetainedVerificationReport['viewports'][number] = { ...viewport, panel: panelMode };
      if (publication) {
        await publication.setViewportSize(viewport);
        const response = await publication.goto(config.publicationUrl!);
        assert(response, 'Publication must return a response');
        assert.equal(publication.url(), config.publicationUrl, 'Publication admission must end at the expected stable URL');
        await policy(response, documentPolicy, 'Protected publication');
        result.publication = await identity(publication, expected);
        if (result.publication === 'legacy') assert.equal(await publication.locator('header span').textContent(), `Revisión ${expected.revision.sequence}`, 'Legacy publication revision sequence differs');
        const publishedIframe = publication.locator('main > iframe');
        assert.equal(await publishedIframe.getAttribute('src'), null, 'Publication must use its retained srcdoc');
        assert.equal(await publishedIframe.getAttribute('srcdoc'), previewDocument(expected, report.interactive), 'Publication srcdoc bytes differ from the retained revision');
        const publishedFrame = await contentFrame(publication, publishedIframe, report.interactive);
        await overflow(publication, publishedFrame);
        const fileSummary = publication.locator('summary').filter({ hasText: /^Archivos \(/ });
        const informationSummary = publication.locator('summary').filter({ hasText: /^Información$/ });
        const disclosed = await fileSummary.count() === 1 && await informationSummary.count() === 1;
        if (disclosed) await viewerBounds(publication);
        const frameCapture = join(config.evidenceDirectory, `publication-${index}-frame.png`);
        await publishedIframe.screenshot({ path: frameCapture });
        await chmod(frameCapture, 0o600);
        await capture(publication, `publication-${index}-closed`);
        if (await fileSummary.count()) await fileSummary.click();
        const files = expected.revision.snapshot.files;
        const attachmentLinks = publication.locator('nav[aria-label="Archivos adjuntos"] a');
        assert.equal(await publication.locator('a').count(), files.length, 'Publication must contain only its complete retained attachment link inventory');
        assert.equal(await attachmentLinks.count(), files.length, 'Publication must display the complete attachment inventory');
        for (const file of files) {
          const link = attachmentLinks.filter({ hasText: new RegExp(`^${file.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
          assert.equal(await link.count(), 1, `Publication must have one attachment link for ${file.path}`);
          await link.waitFor({ state: 'visible' });
          const url = new URL((await link.getAttribute('href'))!, config.publicationUrl);
          const path = `/a/${encodeURIComponent(expected.artifactId)}/r/${encodeURIComponent(expected.revision.id)}/files/${file.path.split('/').map(encodeURIComponent).join('/')}`;
          assert.equal(url.href, new URL(path, config.publicationUrl).href, `Attachment must bind the exact artifact, revision and normalized path for ${file.path}`);
          const response = await context.request.get(url.href, { maxRedirects: 0 });
          assert.equal(response.status(), 200, `Protected attachment must be readable for ${file.path}`);
          assert.deepEqual(await response.body(), Buffer.from(decodeFile(file)), `Attachment bytes differ for ${file.path}`);
          assert.equal(response.headers()['content-type'], file.mediaType, `Attachment media type differs for ${file.path}`);
          assert.match(response.headers()['content-disposition'] ?? '', /^attachment;/, 'Attachment must download');
          assert.equal(response.headers()['x-content-type-options'], 'nosniff', 'Attachment must suppress MIME sniffing');
          assert.equal(response.headers()['content-security-policy'], "default-src 'none'; sandbox", 'Attachment must retain its inert CSP');
        }
        await expectations(publishedFrame, config.expectations, timeout);
        assert.equal(publishedFrame.url(), 'about:srcdoc', 'Content expectations must not replace the publication frame');
        await overflow(publication, publishedFrame);
        await capture(publication, `publication-${index}`);
        if (disclosed) {
          await informationSummary.press('Enter');
          assert.equal(await publication.locator('details[open]').count(), 2, 'Both native viewer disclosures must open');
          await overflow(publication, publishedFrame);
          await viewerBounds(publication);
          await capture(publication, `publication-${index}-open`);
        }
      }
      report.viewports.push(result);
    }
    if (observer) { await checkPublicationState(); report.checks.push('Independent publication revision and version after browser checks'); report.publication = 'verified'; }
    report.checks.push('Exact selected panel identity, actual preview response and complete downloaded archive', 'Real sandbox and CSP', 'Fresh content expectations and wrapper/frame overflow at every viewport');
    if (publication) report.checks.push('Exact publication identity and srcdoc, complete revision-bound attachment inventory and bytes');
    assert.deepEqual(report.errors, [], 'Browser emitted console/page errors or attempted mutation');
    report.status = 'passed';
  } catch (error) {
    report.errors.push({ kind: 'verification', message: safeMessage(error instanceof Error ? error.message : String(error)) });
    for (const [index, page] of pages.entries()) await capture(page, `failure-${index}`).catch(() => undefined);
  } finally {
    await Promise.all(pages.map((page) => page.close()));
    if (report.errors.length > 0) report.status = 'failed';
    await json('result.json', report);
  }
  return report;
}
