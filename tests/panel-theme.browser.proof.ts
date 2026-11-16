import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import { observeMoveReadiness, waitForMoveReadiness } from '../.agents/skills/verify-artifacts/scripts/move-readiness.ts';
import { projectPalette } from '../apps/dashboard/src/presentation.ts';

const execute = promisify(execFile);
const control = (command: string[]) => execute(process.execPath, ['--import', 'tsx', '.agents/skills/verify-artifacts/scripts/control.ts', ...command]);
const run = resolve(`.test-artifacts/verify-artifacts/panel-theme-${randomUUID()}`);
const minimum = 4.5;
const themes = ['dark', 'light'] as const;
type Theme = typeof themes[number];
type Mode = 'text' | 'selection' | 'placeholder';
type Row = { text: string; element: string; fg: string; bg: string; ratio: number };
type Measured = Row & { theme: Theme; width: number; page: string; state: string };

/** Runs in the page. Measures each rendered text node inside root against the background it is painted on, composited through every layer under it. */
function textContrast(root: Element, mode: Mode): Row[] {
  type RGBA = [number, number, number, number];
  const canvas = new OffscreenCanvas(1, 1);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const parse = (value: string): RGBA => {
    const rgb = value.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
    if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
    const srgb = value.match(/^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/);
    if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, srgb[4] === undefined ? 1 : Number(srgb[4])];
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return [r!, g!, b!, a! / 255];
  };
  const over = (top: RGBA, bottom: RGBA): RGBA => [top[0] * top[3] + bottom[0] * (1 - top[3]), top[1] * top[3] + bottom[1] * (1 - top[3]), top[2] * top[3] + bottom[2] * (1 - top[3]), 1];
  const channel = (value: number) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const luminance = ([r, g, b]: RGBA) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const ratio = (a: RGBA, b: RGBA) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
  const hex = (color: RGBA) => `#${color.slice(0, 3).map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
  const layers = (element: Element): RGBA[][] => {
    const style = getComputedStyle(element);
    const result: RGBA[][] = [];
    const color = parse(style.backgroundColor);
    if (color[3] > 0) result.push([color]);
    if (style.backgroundImage !== 'none') {
      const stops = (style.backgroundImage.match(/rgba?\([^)]*\)|color\([^)]*\)/g) ?? []).map(parse).filter((stop) => stop[3] > 0);
      if (stops.length) result.push(stops);
    }
    return result;
  };
  const describe = (element: Element) => {
    const parts: string[] = [];
    for (let e: Element | null = element; e && e !== document.body && parts.length < 4; e = e.parentElement) parts.unshift(`${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className.trim() ? `.${e.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`);
    return parts.join('>');
  };
  const opacityOf = (element: Element) => { let value = 1; for (let e: Element | null = element; e; e = e.parentElement) value *= Number(getComputedStyle(e).opacity); return value; };
  const backgroundsAt = (element: Element, x: number, y: number) => {
    const hits = y >= 0 && y < innerHeight && x >= 0 && x < innerWidth ? document.elementsFromPoint(x, y) : [];
    const index = hits.findIndex((hit) => hit.contains(element));
    const stack: Element[] = index < 0 ? [] : hits.slice(index);
    if (!stack.length) for (let e: Element | null = element; e; e = e.parentElement) stack.push(e);
    let backgrounds: RGBA[] = [[255, 255, 255, 1]];
    for (const layer of stack.slice().reverse().flatMap(layers)) backgrounds = backgrounds.flatMap((below) => layer.map((paint) => over(paint, below))).slice(0, 8);
    return backgrounds;
  };
  const measureAt = (element: Element, text: string, ink: RGBA, x: number, y: number, top?: RGBA): Row => {
    const foreground: RGBA = [ink[0], ink[1], ink[2], ink[3] * opacityOf(element)];
    const backgrounds = backgroundsAt(element, x, y).map((bg) => top ? over(top, bg) : bg);
    const worst = backgrounds.map((bg) => ({ bg, value: ratio(over(foreground, bg), bg) })).sort((a, b) => a.value - b.value)[0]!;
    return { text: text.slice(0, 60), element: describe(element), fg: hex(over(foreground, worst.bg)), bg: hex(worst.bg), ratio: Math.round(worst.value * 100) / 100 };
  };
  const targets: { element: Element; text: string; rect: () => DOMRect | undefined }[] = [];
  if (mode === 'placeholder') {
    for (const input of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[placeholder], textarea[placeholder]')) if (!input.value && input.checkVisibility()) targets.push({ element: input, text: input.placeholder, rect: () => input.getBoundingClientRect() });
  } else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue?.trim();
      const element = node.parentElement;
      if (!text || !element || element.closest('script, style, template, noscript, option') || !element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) || opacityOf(element) === 0) continue;
      const box = element.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      targets.push({ element, text, rect: () => Array.from(range.getClientRects()).find((box) => box.width > 1 && box.height > 1) });
    }
    for (const input of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type=hidden], [type=checkbox], [type=radio]), textarea')) if (input.value && input.checkVisibility()) targets.push({ element: input, text: input.value, rect: () => input.getBoundingClientRect() });
  }
  const rows: Row[] = [];
  const start = scrollY;
  const pending = new Set(targets);
  for (let offset = 0; pending.size; offset += innerHeight) {
    const last = offset + innerHeight >= document.documentElement.scrollHeight;
    if (offset !== scrollY) scrollTo(0, offset);
    for (const target of [...pending]) {
      const rect = target.rect();
      if (!rect) { pending.delete(target); continue; }
      const y = rect.top + rect.height / 2;
      if (!last && y >= innerHeight) continue;
      pending.delete(target);
      if (offset === 0 && rect.bottom <= 0) continue;
      const x = Math.min(Math.max(rect.left + (mode === 'placeholder' ? 48 : rect.width / 2), 0), innerWidth - 1);
      const style = getComputedStyle(target.element, mode === 'placeholder' ? '::placeholder' : mode === 'selection' ? '::selection' : null);
      if (mode === 'selection' && getComputedStyle(target.element).userSelect === 'none') continue;
      const top = mode === 'selection' ? parse(style.backgroundColor) : undefined;
      rows.push(measureAt(target.element, target.text, parse(style.color), x, y, top));
    }
    if (last) break;
  }
  scrollTo(0, start);
  return rows;
}

/** Runs in the page. Reports the box and paint of the rail, top bar, status bar, and current rail item against the theme tokens. */
function shellGeometry() {
  const paint = (property: 'backgroundColor' | 'color', value: string) => { const probe = document.createElement('i'); probe.style[property] = value; document.body.append(probe); const result = getComputedStyle(probe)[property]; probe.remove(); return result; };
  const box = (selector: string) => {
    const element = document.querySelector(selector)!;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom, position: style.position, background: style.backgroundColor };
  };
  const current = document.querySelector('.rail a[aria-current]')!;
  const indicator = getComputedStyle(current, '::before');
  const currentBox = current.getBoundingClientRect();
  const indicatorBox = { left: Number.parseFloat(indicator.left), top: Number.parseFloat(indicator.top) };
  return {
    viewport: { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth },
    tokens: { chrome: paint('backgroundColor', 'var(--bg-chrome)'), bg: paint('backgroundColor', 'var(--bg)'), accentA2: paint('backgroundColor', 'var(--accent-a2)'), accent: paint('color', 'var(--accent)') },
    rail: box('.rail'), bar: box('.top-bar'), status: box('.status-bar'),
    keys: getComputedStyle(document.querySelector('.status-keys')!).display,
    current: { href: current.getAttribute('href'), name: current.getAttribute('aria-label'), background: getComputedStyle(current).backgroundColor, color: getComputedStyle(current).color, size: [currentBox.width, currentBox.height], indicator: { width: indicator.width, height: indicator.height, background: indicator.backgroundColor, ...indicatorBox } },
  };
}

/** Runs in the page. Reports a library row's height, whether its actions show, which inline actions it renders, and its side indicator. */
function rowState(row: Element) {
  const actions = row.querySelector<HTMLElement>('.artifact-actions')!;
  const first = row.firstElementChild!;
  const indicator = getComputedStyle(first, '::before');
  return {
    height: Math.round(row.getBoundingClientRect().height),
    actions: getComputedStyle(actions).opacity,
    links: [...actions.querySelectorAll<HTMLElement>('.row-action')].filter((link) => link.checkVisibility()).map((link) => link.textContent!.trim()),
    menu: Boolean(actions.querySelector('.artifact-title-trigger')?.checkVisibility()),
    indicator: indicator.content === 'none' ? 'auto' : indicator.width,
    shadow: [row, ...row.children].map((cell) => getComputedStyle(cell).boxShadow).find((value) => value !== 'none') ?? 'none',
  };
}

/** Runs in the page. Reports a reader row's height, paint, and side indicator. */
function readerRowState(row: Element) {
  const indicator = getComputedStyle(row, '::before');
  const box = row.getBoundingClientRect();
  return {
    height: Math.round(box.height),
    background: getComputedStyle(row).backgroundColor,
    indicator: indicator.content === 'none' ? 'auto' : indicator.width,
    indicatorHeight: indicator.content === 'none' ? 0 : Math.round(Number.parseFloat(indicator.height)),
    shadow: [row, ...row.querySelectorAll('*')].map((element) => getComputedStyle(element).boxShadow).find((value) => value !== 'none') ?? 'none',
  };
}

await control(['launch', '--allow-guests', '--run', run]);
const evidence = resolve(process.env.PANEL_THEME_EVIDENCE ?? join(run, 'panel-theme'));
await mkdir(evidence, { recursive: true });
const instance = JSON.parse(await readFile(join(run, 'instance.json'), 'utf8')) as { panel: string; mcp: string };
const credentials = JSON.parse(await readFile(join(run, 'runtime/credentials.json'), 'utf8')) as { password: string; accessToken: string };
const browser = await chromium.launch({ ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : { channel: 'chrome' }) });
const contexts: BrowserContext[] = [];
const errors: string[] = [];
const checks: string[] = [];
const measured: Measured[] = [];
const shells: (ReturnType<typeof shellGeometry> & { theme: Theme; width: number; scrolled?: boolean })[] = [];
const rowStates: (ReturnType<typeof rowState> & { theme: Theme; width: number; state: string })[] = [];
const readerStates: (ReturnType<typeof readerRowState> & { theme: Theme; width: number; state: string })[] = [];
let active: Page | undefined;

async function call(name: string, input: unknown, token = credentials.accessToken): Promise<Record<string, any>> {
  const response = await fetch(instance.mcp, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } }) });
  assert.equal(response.status, 200, `${name} HTTP status`);
  const body = await response.text();
  const { result } = JSON.parse(body.startsWith('event:') ? body.split('\n').find((line) => line.startsWith('data:'))!.slice(5) : body) as { result: { isError?: boolean; structuredContent: Record<string, any> } };
  assert(!result.isError, `${name} succeeded: ${JSON.stringify(result.structuredContent)}`);
  return result.structuredContent;
}
async function context(theme: Theme | undefined, options: Parameters<typeof browser.newContext>[0] = {}) {
  const value = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES', timezoneId: 'UTC', reducedMotion: 'reduce', ...options });
  contexts.push(value);
  // tsx keeps function names with a __name helper that page.evaluate does not carry into the page.
  await value.addInitScript('globalThis.__name = (target) => target');
  if (theme) await value.addCookies([{ name: 'panel_theme', value: theme, url: instance.panel }]);
  value.on('page', (page) => { page.on('pageerror', (error) => errors.push(error.message)); page.on('console', (message) => { if (message.type() === 'error' && message.location().url.startsWith(instance.panel)) errors.push(`${message.text()} ${message.location().url}`); }); });
  return value;
}
async function login(page: Page, email = 'owner@example.test') {
  await page.goto(instance.panel);
  await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: 'Biblioteca', exact: true }).waitFor();
}
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => document.querySelectorAll('astro-island[ssr]').length === 0);
  await page.evaluate(() => document.fonts.ready);
}
async function measure(page: Page, theme: Theme, label: string, state: string, root: Locator = page.locator('body'), mode: Mode = 'text') {
  const rows = await root.evaluate(textContrast, mode);
  const width = page.viewportSize()!.width;
  measured.push(...rows.map((row) => ({ ...row, theme, width, page: label, state })));
  return rows.length;
}
/** Hovers one element of each distinct styling and measures the text it paints. */
async function hoverStates(page: Page, theme: Theme, label: string) {
  const count = await page.evaluate(() => {
    const seen = new Set<string>();
    let index = 0;
    for (const element of document.querySelectorAll<HTMLElement>('a, button, summary, label, tbody tr, .reader-item, [role=menuitem], [role=option]')) {
      if (!element.checkVisibility() || !element.textContent?.trim()) continue;
      const key = [element, element.parentElement, element.parentElement?.parentElement].map((e) => `${e?.tagName}.${e?.getAttribute('class') ?? ''}[${e?.getAttribute('aria-current') ?? ''}]`).join('<');
      if (seen.has(key)) continue;
      seen.add(key);
      element.dataset.contrastTarget = String(index++);
    }
    return index;
  });
  for (let index = 0; index < count; index++) {
    const target = page.locator(`[data-contrast-target="${index}"]`);
    const reach = await target.evaluate((element) => {
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { reachable: Boolean(hit && element.contains(hit)), name: `${element.tagName.toLowerCase()}.${[...element.classList].join('.')} "${element.textContent!.trim().slice(0, 40)}"`, hit: hit ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join('.')}` : 'nothing', expected: element.matches('a.skip-link, label.sr-only') };
    });
    if (!reach.reachable) {
      // The skip link sits above the viewport until focused and sr-only labels lie under their control, so a pointer cannot reach them. Any other target must be hoverable.
      assert(reach.expected, `${theme} ${label}: hover target ${reach.name} is covered by ${reach.hit}`);
      continue;
    }
    await target.hover({ timeout: 2_000 });
    await measure(page, theme, label, 'hover', target);
  }
  await page.mouse.move(0, 0);
}
/** Walks the page with Tab and measures each focused element that carries text. */
async function focusStates(page: Page, theme: Theme, label: string) {
  await page.locator('body').focus();
  const seen = new Set<string>();
  for (let step = 0; step < 120; step++) {
    await page.keyboard.press('Tab');
    const key = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body || !element.textContent?.trim()) return null;
      element.setAttribute('data-contrast-focus', '');
      return `${element.tagName}.${element.getAttribute('class') ?? ''}[${element.getAttribute('aria-current') ?? ''}]<${element.parentElement?.getAttribute('class') ?? ''}`;
    });
    if (key && !seen.has(key)) {
      seen.add(key);
      await measure(page, theme, label, 'focus', page.locator('[data-contrast-focus]'));
    }
    if (await page.evaluate(() => { document.querySelector('[data-contrast-focus]')?.removeAttribute('data-contrast-focus'); return document.activeElement === document.body; })) break;
  }
}

try {
  await control(['account', '--email', 'guest@example.test', '--run', run]);
  const guest = JSON.parse(await readFile(join(run, 'runtime/accounts/guest@example.test.json'), 'utf8')) as { accessToken: string };
  const handbook = await call('artifacts_create', { requestId: randomUUID(), snapshot: { metadata: { title: 'Guest handbook', description: 'Shared by the guest.' }, content: { kind: 'markdown', text: '# Guest handbook\n' }, files: [] } }, guest.accessToken);
  await call('artifacts_publish', { requestId: randomUUID(), artifactId: handbook.artifactId, revisionId: handbook.revision.id, expectedPublicationVersion: 0 }, guest.accessToken);
  await call('artifacts_share', { requestId: randomUUID(), artifactId: handbook.artifactId, email: 'owner@example.test' }, guest.accessToken);
  const toneProjects = Array.from({ length: projectPalette.length - 1 }, (_, index) => `Tono ${index}`);
  const html = (heading: string) => `<!doctype html><html lang="en"><meta charset="utf-8"><title>Theme</title><h1>${heading}</h1><p>Preview body.</p></html>`;
  const seeds = [
    { title: 'Alpha overview', project: 'Alpha', slug: 'alpha/overview', kind: 'html', publication: 'pending', files: true },
    { title: 'Alpha delivery', project: 'Alpha', slug: 'alpha/delivery', kind: 'markdown', text: '# Alpha delivery\n\nSee [the overview](overview.md) and [a missing page](missing.md).\n', publication: 'current' },
    { title: 'Alpha notes', project: 'Alpha', kind: 'text', publication: 'draft' },
    { title: 'Unfiled notes', kind: 'markdown', publication: 'draft' },
    ...toneProjects.map((project, index) => ({ title: `${project} notes`, project, kind: 'text', publication: index % 2 ? 'current' : 'draft' } as const)),
  ] as const;
  const ids: Record<string, string> = {};
  for (const seed of seeds) {
    const content = seed.kind === 'html' ? { kind: 'html', text: html('Revision 1') } : { kind: seed.kind, text: 'text' in seed ? seed.text : `# ${seed.title}\n\nTheme proof document.\n` };
    const snapshot = { metadata: { title: seed.title, description: `Theme fixture for ${seed.title}.` }, content, files: 'files' in seed ? [{ path: 'notes.txt', mediaType: 'text/plain', encoding: 'utf8', data: 'Attachment.\n' }] : [] };
    let artifact = await call('artifacts_create', { requestId: randomUUID(), snapshot, ...('project' in seed ? { project: seed.project } : {}), ...('slug' in seed ? { slug: seed.slug } : {}) });
    if (seed.publication !== 'draft') await call('artifacts_publish', { requestId: randomUUID(), artifactId: artifact.artifactId, revisionId: artifact.revision.id, expectedPublicationVersion: 0 });
    if (seed.publication === 'pending') artifact = await call('artifacts_update', { requestId: randomUUID(), artifactId: artifact.artifactId, expectedRevisionId: artifact.revision.id, snapshot: { ...snapshot, content: { kind: 'html', text: html('Revision 2') } } });
    ids[seed.title] = artifact.artifactId;
  }
  const setup = await context(undefined);
  const setupPage = await setup.newPage();
  await login(setupPage);
  await setupPage.goto(`${instance.panel}/projects`);
  const renderedTones = await setupPage.locator('.project-card').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-tone')));
  assert.equal(new Set(renderedTones).size, projectPalette.length, 'the seed covers every project tone');
  const owner = await setup.storageState();

  const overview = encodeURIComponent(ids['Alpha overview']!);
  const delivery = encodeURIComponent(ids['Alpha delivery']!);
  const pages = [
    ['library-table', '/?view=table'], ['library-ungrouped', '/?view=table&group=none'], ['library-pending', '/?view=table&status=pending'], ['library-cards', '/?view=cards'], ['project-table', '/?project=Alpha&view=table'], ['project-cards', '/?project=Alpha&view=cards'],
    ['unfiled', '/?unfiled=1'], ['no-match', '/?q=sin-coincidencias'], ['read', '/read'], ['read-pending', `/read?project=Alpha&artifact=${overview}`],
    ['detail-preview', `/artifacts/${overview}`], ['detail-files', `/artifacts/${overview}?tab=files`], ['detail-compare', `/artifacts/${overview}?tab=compare`], ['detail-information', `/artifacts/${overview}?tab=information`],
    ['detail-links', `/artifacts/${delivery}`], ['projects', '/projects'], ['move', `/move?artifactId=${overview}`], ['delete', `/artifacts/${overview}/delete`], ['share', `/artifacts/${overview}/share`],
  ] as const;
  const previews: Record<Theme, unknown> = { dark: undefined, light: undefined };
  for (const theme of themes) {
    const signedOut = await context(theme);
    for (const width of [1440, 390]) {
      const page = active = await signedOut.newPage();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(instance.panel);
      await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).waitFor();
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      await measure(page, theme, 'logged-out', 'static');
      if (width === 1440) await hoverStates(page, theme, 'logged-out');
      await page.close();
    }
    const signedIn = await context(theme, { storageState: owner });
    await observeMoveReadiness(signedIn);
    for (const width of [1440, 390]) {
      const page = active = await signedIn.newPage();
      await page.setViewportSize({ width, height: 900 });
      for (const [label, path] of pages) {
        assert.equal((await page.goto(`${instance.panel}${path}`))?.status(), 200, `${label} responds 200`);
        await settle(page);
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme, `${label} renders the ${theme} theme from the cookie`);
        await measure(page, theme, label, 'static');
        await measure(page, theme, label, 'placeholder', page.locator('body'), 'placeholder');
        if (width !== 1440) continue;
        await measure(page, theme, label, 'selection', page.locator('body'), 'selection');
        await hoverStates(page, theme, label);
        await focusStates(page, theme, label);
        if (label === 'detail-preview') {
          const frame = page.frameLocator('iframe.preview');
          await frame.locator('h1').waitFor();
          previews[theme] = { iframe: await page.locator('iframe.preview').evaluate((element) => getComputedStyle(element).backgroundColor), document: await frame.locator('html').evaluate((element) => [getComputedStyle(element).colorScheme, getComputedStyle(element).backgroundColor, getComputedStyle(document.body).color, element.getAttribute('data-theme')]) };
        }
        if (label === 'share') {
          await page.locator('main button, main input').evaluateAll((controls) => controls.forEach((control) => (control as HTMLButtonElement).disabled = true));
          await measure(page, theme, label, 'disabled', page.locator('main'));
        }
      }

      await page.goto(`${instance.panel}/?view=table`);
      await settle(page);
      shells.push({ theme, width, ...await page.evaluate(shellGeometry) });
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      shells.push({ theme, width, scrolled: true, ...await page.evaluate(shellGeometry) });
      await page.evaluate(() => scrollTo(0, 0));
      for (const [label, summary, panel] of [['rail-tools', '#connect-tools > summary', '#connect-tools .rail-panel'], ['rail-account', 'summary[aria-label="Mi cuenta"]', '.identity .rail-panel']] as const) {
        await page.locator(summary).click();
        await page.locator(panel).waitFor();
        const box = (await page.locator(panel).boundingBox())!;
        const viewport = page.viewportSize()!;
        assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, `${label} opens inside the ${width}px viewport: ${JSON.stringify(box)}`);
        await measure(page, theme, label, 'static', page.locator(panel));
        for (const control of await page.locator(`${panel} a, ${panel} button`).all()) { await control.hover(); await measure(page, theme, label, 'hover', control); await control.focus(); await measure(page, theme, label, 'focus', control); }
        await page.locator(summary).focus();
        await page.keyboard.press('Escape');
        await page.locator(panel).waitFor({ state: 'hidden' });
        assert.equal(await page.locator(summary).evaluate((element) => element === document.activeElement), true, `Escape closes ${label} and keeps focus on its rail button`);
      }
      await page.goto(`${instance.panel}/?view=table`);
      await settle(page);
      await page.getByRole('button', { name: 'Menú de Unfiled notes', exact: true }).first().click();
      const menu = page.locator('[data-slot=dropdown-menu-content]');
      await menu.waitFor();
      await measure(page, theme, 'library-menu', 'static');
      for (const item of await menu.locator('[data-slot=dropdown-menu-item]').all()) { await item.hover(); await measure(page, theme, 'library-menu', 'hover', item); }
      await page.keyboard.press('Escape');

      await page.goto(`${instance.panel}/?view=table`);
      await settle(page);
      for (const link of await page.locator('.library-bar > nav a, .library-bar .view-toggle a').all()) { await link.hover(); await measure(page, theme, 'library-filters', 'hover', link); await link.focus(); await measure(page, theme, 'library-filters', 'focus', link); }
      for (const name of ['Agrupar', 'Ordenar']) {
        const menu = page.locator('details.choice-menu').filter({ has: page.locator(`nav[aria-label="${name}"]`) });
        await menu.locator('summary').click();
        const list = menu.getByRole('navigation', { name, exact: true });
        await list.waitFor();
        const box = (await list.boundingBox())!;
        assert(box.x >= 0 && box.x + box.width <= width, `${name} opens inside the ${width}px viewport: ${JSON.stringify(box)}`);
        await measure(page, theme, `${name.toLowerCase()}-menu`, 'static', menu);
        for (const link of await list.getByRole('link').all()) { await link.hover(); await measure(page, theme, `${name.toLowerCase()}-menu`, 'hover', link); }
        await page.keyboard.press('Escape');
        await list.waitFor({ state: 'hidden' });
      }
      const banner = page.getByRole('region', { name: 'Cambios sin publicar', exact: true });
      await measure(page, theme, 'pending-banner', 'static', banner);
      for (const control of await banner.locator('a, button').all()) { await control.hover(); await measure(page, theme, 'pending-banner', 'hover', control); await control.focus(); await measure(page, theme, 'pending-banner', 'focus', control); }
      await measure(page, theme, 'group-header', 'static', page.locator('.artifact-table-group').first());
      const rows = page.locator('.artifact-table tbody tr:not(.artifact-table-group)');
      const row = rows.nth(1);
      rowStates.push({ theme, width, state: 'rest', ...await row.evaluate(rowState) });
      await row.hover();
      await page.waitForTimeout(300);
      rowStates.push({ theme, width, state: 'hover', ...await row.evaluate(rowState) });
      await measure(page, theme, 'row-actions', 'hover', row);
      if (width === 1440) for (const action of await row.locator('.row-action').all()) { await action.hover(); await measure(page, theme, 'row-actions', 'hover', action); }
      await page.mouse.move(0, 0);
      await rows.nth(2).locator('.artifact-table-name > a').focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(300);
      rowStates.push({ theme, width, state: 'focus', ...await rows.nth(2).evaluate(rowState) });
      await measure(page, theme, 'row-actions', 'focus', rows.nth(2));
      await page.keyboard.press('Tab');
      if (width === 1440) await measure(page, theme, 'row-actions', 'focus', rows.nth(2).getByRole('link', { name: 'Leer', exact: true }));
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

      await page.goto(`${instance.panel}/read?project=Alpha&artifact=${overview}`);
      await settle(page);
      const selectedItem = page.locator('.reader-item[aria-current]');
      const restItem = page.locator('.reader-item:not([aria-current])').first();
      await page.mouse.move(0, 0);
      readerStates.push({ theme, width, state: 'selected', ...await selectedItem.evaluate(readerRowState) }, { theme, width, state: 'rest', ...await restItem.evaluate(readerRowState) });
      await measure(page, theme, 'reader-row', 'selected', selectedItem);
      await measure(page, theme, 'reader-row', 'rest', restItem);
      await restItem.hover();
      await page.waitForTimeout(300);
      readerStates.push({ theme, width, state: 'hover', ...await restItem.evaluate(readerRowState) });
      await measure(page, theme, 'reader-row', 'hover', restItem);
      await page.mouse.move(0, 0);
      await page.locator('.reader-item').first().focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => document.activeElement?.matches('.reader-item:focus-visible')), true, 'a reader row takes keyboard focus');
      const focusedItem = page.locator('.reader-item:focus');
      readerStates.push({ theme, width, state: 'focus', ...await focusedItem.evaluate(readerRowState) });
      await measure(page, theme, 'reader-row', 'focus', focusedItem);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const head = page.locator('.reader-head');
      assert.deepEqual(await head.locator('a[href], button:not([hidden])').evaluateAll((controls) => controls.map((control) => control.getAttribute('aria-label') ?? control.textContent!.trim())), ['Anterior', 'Compartir', 'Detalle', 'Abrir publicación', 'Publicar rev. 2', 'Pantalla completa'], 'the pending pane header offers every action');
      await measure(page, theme, 'reader-head', 'static', head);
      for (const control of await head.locator('a[href], button:not([hidden])').all()) { await control.hover(); await measure(page, theme, 'reader-head', 'hover', control); await control.focus(); await measure(page, theme, 'reader-head', 'focus', control); }
      await page.mouse.move(0, 0);

      await page.goto(`${instance.panel}/?project=Alpha&view=table`);
      await settle(page);
      for (const title of ['Alpha overview', 'Alpha delivery']) await page.getByRole('checkbox', { name: `Seleccionar ${title}`, exact: true }).check();
      await page.locator('[data-selection-count]').getByText('2 seleccionados', { exact: true }).waitFor();
      await page.mouse.move(0, 0);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.waitForTimeout(300);
      rowStates.push({ theme, width, state: 'selected', ...await page.locator('.artifact-table tbody tr').filter({ has: page.getByRole('checkbox', { name: 'Seleccionar Alpha delivery', exact: true }) }).evaluate(rowState) });
      await measure(page, theme, 'project-selection', 'static');
      if (width === 1440) await hoverStates(page, theme, 'project-selection');
      await page.goto(`${instance.panel}/?project=Alpha&view=cards`);
      await settle(page);
      await page.getByRole('checkbox', { name: 'Seleccionar Alpha overview', exact: true }).check();
      await measure(page, theme, 'card-selection', 'static');
      await waitForMoveReadiness(page);
      await page.getByRole('button', { name: 'Mover a otro proyecto', exact: true }).press('Enter');
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Proyecto', { exact: true }).waitFor();
      await measure(page, theme, 'move-dialog', 'placeholder', page.locator('body'), 'placeholder');
      await dialog.getByLabel('Proyecto', { exact: true }).fill('New project');
      await page.getByRole('option', { name: 'Crear proyecto «New project»', exact: true }).waitFor();
      await measure(page, theme, 'move-dialog', 'static');
      for (const option of await page.getByRole('option').all()) { await option.hover(); await measure(page, theme, 'move-dialog', 'hover', option); }

      await page.goto(`${instance.panel}/?view=table`);
      await settle(page);
      await page.waitForFunction(() => document.querySelector('[data-palette-open]:not([hidden])'));
      if (width === 1440) await page.keyboard.press('ControlOrMeta+k');
      else await page.getByRole('button', { name: 'Abrir la paleta de comandos', exact: true }).click();
      const palette = page.getByRole('dialog', { name: 'Paleta de comandos', exact: true });
      const query = palette.getByRole('combobox', { name: 'Buscar en la paleta', exact: true });
      await page.waitForFunction(() => document.activeElement?.matches('[data-palette] [role=combobox]'));
      await page.mouse.move(0, 0);
      await measure(page, theme, 'palette', 'placeholder', palette, 'placeholder');
      await measure(page, theme, 'palette', 'active', palette.locator('[role=option][data-highlighted]'));
      // The list scrolls inside the palette, so each part is measured where it is shown rather than where it is clipped.
      for (const part of await palette.locator('.palette-eyebrow, [role=option]').all()) { await part.scrollIntoViewIfNeeded(); await measure(page, theme, 'palette', 'static', part); }
      await measure(page, theme, 'palette', 'static', palette.locator('.palette-footer'));
      await query.fill('Alpha');
      await palette.locator('[role=option]').first().waitFor();
      await measure(page, theme, 'palette', 'input', palette);
      if (width === 1440) for (const option of await palette.getByRole('option').all()) { await option.hover(); await measure(page, theme, 'palette', 'hover', option); }
      await query.fill('sin coincidencias');
      await palette.getByRole('status').waitFor();
      await measure(page, theme, 'palette', 'empty', palette);
      await page.keyboard.press('Escape');
      await palette.waitFor({ state: 'detached' });
      checks.push(`${theme} ${width}: the palette measures its placeholder, rest and active options, typed query, ${width === 1440 ? 'hovered options, ' : ''}and empty state`);

      await page.goto(`${instance.panel}/?project=Alpha&view=table`);
      await settle(page);
      await page.waitForFunction(() => document.querySelector('[data-palette-open]:not([hidden])'));
      await page.mouse.move(0, 0);
      while (await page.locator('[data-library-item][data-selected] .artifact-table-name > a').textContent().catch(() => null) !== 'Alpha overview') await page.keyboard.press('j');
      await page.waitForTimeout(300);
      await measure(page, theme, 'library-selected', 'selected', page.locator('[data-library-item][data-selected]'));
      await page.keyboard.press('p');
      const confirm = page.getByRole('dialog', { name: 'Publicar rev. 2', exact: true });
      await confirm.waitFor();
      await measure(page, theme, 'publish-dialog', 'static', confirm);
      for (const control of await confirm.getByRole('button').all()) { await control.focus(); await measure(page, theme, 'publish-dialog', 'focus', control); if (width === 1440) { await control.hover(); await measure(page, theme, 'publish-dialog', 'hover', control); } }
      await page.keyboard.press('Escape');
      await confirm.waitFor({ state: 'hidden' });
      await page.close();
    }
    const plainTheme = await context(theme, { storageState: owner, javaScriptEnabled: false });
    for (const width of [1440, 390]) {
      const page = active = await plainTheme.newPage();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${instance.panel}/?view=table`);
      const fallback = page.locator('summary[aria-label="Menú de Unfiled notes"]');
      await fallback.click();
      const list = page.getByRole('navigation', { name: 'Acciones de Unfiled notes', exact: true });
      await list.waitFor();
      assert.deepEqual(await list.getByRole('link').allTextContents(), ['Ver artefacto', 'Compartir', 'Descargar revisión más reciente', 'Mover a proyecto', 'Modo lectura', 'Eliminar artefacto'], 'without JavaScript the row menu falls back to the same links');
      const box = (await list.boundingBox())!;
      assert(box.x >= 0 && box.x + box.width <= width, `the fallback menu opens inside the ${width}px viewport`);
      assert.equal(await list.getByRole('link', { name: 'Eliminar artefacto', exact: true }).evaluate((link) => { const probe = document.createElement('i'); probe.style.color = 'var(--danger)'; document.body.append(probe); const danger = getComputedStyle(probe).color; probe.remove(); return getComputedStyle(link).color === danger; }), true, 'the fallback menu marks Eliminar artefacto with --danger');
      await measure(page, theme, 'row-menu-fallback', 'static', list);
      if (width === 1440) for (const link of await list.getByRole('link').all()) { await link.hover(); await measure(page, theme, 'row-menu-fallback', 'hover', link); }
      await page.close();
    }
  }
  for (const state of rowStates) {
    const label = `${state.theme} ${state.width} ${state.state}`;
    if (state.width === 1440) assert.equal(state.height, 38, `${label}: a row is 38px tall`);
    const shown = state.width !== 1440 || state.state !== 'rest';
    assert.equal(state.actions, shown ? '1' : '0', `${label}: row actions are ${shown ? 'shown' : 'hidden until hover, focus, or selection'}`);
    if (state.width === 1440) assert.deepEqual(state.links, ['Leer', 'Compartir'], `${label}: Leer and Compartir sit beside the menu`);
    else assert.deepEqual(state.links, [], `${label}: a phone row keeps only the menu button, which lists Leer and Compartir`);
    assert.equal(state.menu, true, `${label}: the row keeps its menu button`);
    const indicated = state.state === 'focus' || state.state === 'selected';
    assert.equal(state.indicator, indicated ? '3px' : 'auto', `${label}: ${indicated ? 'a 3px side indicator' : 'no indicator'}`);
    assert.equal(state.shadow, 'none', `${label}: no glow`);
  }
  await writeFile(join(evidence, 'rows.json'), JSON.stringify(rowStates, null, 1));
  for (const state of readerStates) {
    const label = `${state.theme} ${state.width} reader ${state.state}`;
    assert.equal(state.height, 55, `${label}: a reader row is 55px tall, as in the prototype`);
    assert.deepEqual([state.indicator, state.indicatorHeight], state.state === 'selected' ? ['3px', state.height - 1] : ['auto', 0], `${label}: ${state.state === 'selected' ? 'a 3px side indicator over the whole row above its bottom border' : 'no indicator'}`);
    assert.equal(state.shadow, 'none', `${label}: no glow`);
  }
  for (const theme of themes) for (const width of [1440, 390]) {
    const paint = Object.fromEntries(readerStates.filter((state) => state.theme === theme && state.width === width).map((state) => [state.state, state.background]));
    assert.equal(new Set([paint.rest, paint.hover, paint.selected]).size, 3, `${theme} ${width}: rest, hover, and selected reader rows paint differently`);
  }
  await writeFile(join(evidence, 'reader-rows.json'), JSON.stringify(readerStates, null, 1));
  checks.push('a reader row is 55px in both themes at 1440 and 390; rest, hover, and selected paint differently, only the selected row carries the 3px indicator over its whole height, and none has a glow; the pending pane header offers Anterior, Compartir, Detalle, Abrir publicación, Publicar rev. 2, and fullscreen');
  checks.push('a library row is 38px; its Leer, Compartir, and menu actions appear on hover, keyboard focus, and selection at 1440 and stay visible at 390; focus and selection add the 3px indicator without a glow; without JavaScript the menu falls back to a native disclosure with the same links');
  for (const shell of shells) {
    const label = `${shell.theme} ${shell.width}${shell.scrolled ? ' scrolled' : ''}`;
    const { rail, bar, status, tokens, current, viewport } = shell;
    assert.equal(viewport.overflow, false, `${label}: no horizontal overflow`);
    assert.equal(rail.background, tokens.chrome, `${label}: the rail sits on --bg-chrome`);
    assert.equal(status.background, tokens.chrome, `${label}: the status bar sits on --bg-chrome`);
    assert.equal(bar.background, tokens.bg, `${label}: the top bar sits on --bg`);
    assert.deepEqual([current.href, current.name, current.background, current.color], ['/', 'Biblioteca', tokens.accentA2, tokens.accent], `${label}: Biblioteca is the current rail item on --accent-a2 in --accent`);
    assert.equal(current.indicator.background, tokens.accent, `${label}: the current item carries the accent indicator`);
    if (shell.width === 1440) {
      assert.deepEqual([rail.left, rail.top, rail.width, rail.height], [0, 0, 56, viewport.height], `${label}: the rail is 56px wide and fills the viewport height`);
      assert.deepEqual([bar.left, bar.top, bar.height], [56, 0, 52], `${label}: the top bar is 52px tall beside the rail`);
      assert.deepEqual([status.left, status.height, status.bottom], [56, 30, viewport.height], `${label}: the status bar is 30px tall at the bottom of the viewport`);
      assert.deepEqual([current.size, current.indicator.width, current.indicator.left], [[36, 36], '3px', -10], `${label}: a 36px item with a 3px indicator on the rail edge`);
      assert.equal(shell.keys, 'flex', `${label}: the status bar keeps a slot for shortcut hints`);
    } else {
      assert.deepEqual([rail.left, rail.width, rail.height, rail.bottom, rail.position], [0, viewport.width, 56, viewport.height, 'fixed'], `${label}: the rail becomes a 56px bottom bar`);
      assert.deepEqual([bar.position, current.indicator.height], ['static', '3px'], `${label}: the top bar scrolls away and the indicator sits on the top edge`);
      assert.equal(shell.keys, 'none', `${label}: the status bar drops the shortcut hints`);
    }
  }
  await writeFile(join(evidence, 'shell.json'), JSON.stringify(shells, null, 1));
  checks.push('the rail, top bar, and status bar keep their size, position, and tokens in both themes at 1440 and 390, before and after scrolling; the tools and account panels open inside the viewport, measure every text node, and close on Escape');
  assert.deepEqual(previews.light, previews.dark, 'The sandboxed preview keeps its own document background in both panel themes');
  assert.equal((previews.dark as { iframe: string }).iframe, 'rgb(255, 255, 255)');
  checks.push(`the preview iframe keeps a white background and its own document in both themes: ${JSON.stringify(previews.dark)}`);

  const failing = measured.filter((row) => row.ratio < minimum);
  const summary = Object.fromEntries(themes.map((theme) => {
    const rows = measured.filter((row) => row.theme === theme);
    const lowest = new Map<string, Measured>();
    for (const row of rows.slice().sort((a, b) => a.ratio - b.ratio)) { const key = `${row.fg} ${row.bg}`; if (!lowest.has(key)) lowest.set(key, row); }
    return [theme, { nodes: rows.length, states: Object.fromEntries([...new Set(rows.map((row) => `${row.state} ${row.width}`))].map((key) => [key, rows.filter((row) => `${row.state} ${row.width}` === key).length])), lowest: [...lowest.values()].slice(0, 12) }];
  }));
  await writeFile(join(evidence, 'contrast.json'), JSON.stringify({ minimum, summary, failing }, null, 1));
  for (const theme of themes) {
    console.log(`${theme}: ${summary[theme]!.nodes} text nodes measured`, summary[theme]!.states);
    console.table(summary[theme]!.lowest.map(({ ratio, fg, bg, width, page, state, element, text }) => ({ ratio, fg, bg, width, page, state, element: element.split('>').at(-1), text: text.slice(0, 28) })));
  }
  assert.deepEqual(failing.map(({ theme, width, page, state, ratio, fg, bg, element, text }) => `${theme} ${width} ${page} ${state} ${ratio} ${fg} on ${bg} ${element} "${text}"`), [], `every text node measures at least ${minimum}`);
  checks.push(`every text node measures at least ${minimum} in both themes at 1440 and 390, static, hover, focus, selection, placeholder, disabled, menu, dialog, and selected rows`);

  const owned = await context(undefined, { storageState: owner });
  const page = active = await owned.newPage();
  const theme = async () => [await page.locator('html').getAttribute('data-theme'), await page.locator('meta[name="theme-color"]').getAttribute('content')];
  const stored = async (target = owned) => (await target.cookies()).find(({ name }) => name === 'panel_theme')?.value;
  await page.goto(`${instance.panel}/?project=Alpha&view=table`);
  await settle(page);
  assert.deepEqual(await theme(), ['dark', '#1e1e2e']);
  await page.getByRole('button', { name: 'Cambiar a tema claro', exact: true }).waitFor();
  await page.getByRole('checkbox', { name: 'Seleccionar Alpha notes', exact: true }).check();
  await page.evaluate(() => { (window as Window & { samePage?: boolean }).samePage = true; });
  await page.getByRole('button', { name: 'Cambiar a tema claro', exact: true }).click();
  await page.getByRole('button', { name: 'Cambiar a tema oscuro', exact: true }).waitFor();
  assert.deepEqual(await theme(), ['light', '#eff1f5']);
  assert.equal(await stored(), 'light');
  assert.equal(await page.evaluate(() => (window as Window & { samePage?: boolean }).samePage), true, 'The toggle flips the theme without a navigation');
  assert.equal(await page.getByRole('checkbox', { name: 'Seleccionar Alpha notes', exact: true }).isChecked(), true, 'The page keeps its selection');
  await page.reload();
  assert.deepEqual(await theme(), ['light', '#eff1f5']);
  await page.goto(`${instance.panel}/projects`);
  assert.deepEqual(await theme(), ['light', '#eff1f5']);
  assert.match(await (await owned.request.get(`${instance.panel}/read`)).text(), /^<!DOCTYPE html><html lang="es" data-theme="light">/i, 'The server renders the stored theme in the first byte of markup, so the first paint has it');
  await page.getByRole('button', { name: 'Cambiar a tema oscuro', exact: true }).click();
  await page.getByRole('button', { name: 'Cambiar a tema claro', exact: true }).waitFor();
  assert.deepEqual(await theme(), ['dark', '#1e1e2e']);
  await page.reload();
  assert.deepEqual(await theme(), ['dark', '#1e1e2e']);
  checks.push('with JavaScript the toggle flips the theme in place, keeps the selection, writes the cookie, and survives reload and navigation');

  const plain = await context(undefined, { storageState: owner, javaScriptEnabled: false });
  const noScript = active = await plain.newPage();
  const start = `${instance.panel}/read?project=Alpha&artifact=${delivery}`;
  await noScript.goto(start);
  assert.equal(await noScript.locator('html').getAttribute('data-theme'), 'dark');
  await noScript.getByRole('button', { name: 'Cambiar a tema claro', exact: true }).click();
  await noScript.waitForURL(start);
  assert.equal(await noScript.locator('html').getAttribute('data-theme'), 'light');
  assert.equal(await stored(plain), 'light');
  await noScript.goto(`${instance.panel}/projects`);
  assert.equal(await noScript.locator('html').getAttribute('data-theme'), 'light');
  await noScript.getByRole('button', { name: 'Cambiar a tema oscuro', exact: true }).click();
  await noScript.waitForURL(`${instance.panel}/projects`);
  assert.equal(await noScript.locator('html').getAttribute('data-theme'), 'dark');
  checks.push('without JavaScript the form posts, sets the cookie, returns to the same page and query, and the next page keeps the theme');

  const post = (form: Record<string, string>, origin = instance.panel) => plain.request.post(`${instance.panel}/theme`, { form, headers: { origin }, maxRedirects: 0 });
  for (const target of ['https://attacker.example/', '//attacker.example/', '/\\attacker.example', 'projects']) {
    const response = await post({ theme: 'light', return: target });
    assert.equal(response.status(), 303);
    assert.equal(response.headers().location, '/', `${target} returns to the library`);
  }
  assert.equal((await post({ theme: 'sepia', return: '/' })).status(), 400);
  assert.equal((await post({ theme: 'light', return: '/', extra: '1' })).status(), 400);
  assert.equal((await post({ theme: 'light', return: '/' }, 'https://attacker.example')).status(), 403);
  assert.match((await (await plain.request.get(instance.panel, { headers: { cookie: 'panel_theme=sepia' } })).text()), /<html lang="es" data-theme="dark">/);
  checks.push('the theme endpoint returns only to same-origin paths, rejects other themes and fields, and refuses cross-origin posts; an unknown cookie renders dark');

  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ status: 'passed', browser: browser.version(), checks, nodes: measured.length, errors }, null, 2));
  console.log(JSON.stringify({ status: 'passed', evidence, nodes: measured.length, checks: checks.length }));
} catch (error) {
  if (active && !active.isClosed()) await active.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(evidence, 'failure.json'), JSON.stringify({ status: 'failed', error: String(error), checks, errors }, null, 2));
  throw error;
} finally {
  for (const item of contexts) await item.close().catch(() => {});
  await browser.close();
  await control(['cleanup', '--run', run]);
}
