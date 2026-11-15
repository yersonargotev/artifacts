import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { artifactReadSchema } from '../packages/contracts/src/index.ts';
import { grant } from './helpers.ts';
import { restCliFixture } from './rest-cli-fixture.ts';

const evidence = resolve(process.env.PANEL_PALETTE_EVIDENCE ?? `.test-artifacts/panel-palette-${Date.now()}`);
await mkdir(evidence, { recursive: true, mode: 0o700 });
const app = await restCliFixture({ directory: evidence });
const browser = await chromium.launch({ channel: 'chrome' });
const tokens = await grant(app, 'openid profile offline_access artifacts:read artifacts:write artifacts:publish');
const checks: string[] = [];
const errors: string[] = [];
const record = (action: string, result: unknown) => appendFile(join(evidence, 'actions.jsonl'), `${JSON.stringify({ time: new Date().toISOString(), action, result })}\n`, { mode: 0o600 });
const json = (name: string, result: unknown) => writeFile(join(evidence, name), JSON.stringify(result, null, 2), { mode: 0o600 });
async function mcp(name: string, input: unknown = {}) {
  const response = await fetch(app.config.resource, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${tokens.access_token}`, 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } }) });
  assert.equal(response.status, 200);
  const text = await response.text();
  const payload = JSON.parse(text.startsWith('event:') ? text.split('\n').find((line) => line.startsWith('data:'))!.slice(5) : text);
  assert(!payload.error && !payload.result.isError, text);
  await record(`MCP ${name}`, { input });
  return payload.result.structuredContent;
}
const snapshot = (title: string, text: string) => ({ metadata: { title, description: `Descripción de ${title}` }, content: { kind: 'text' as const, text }, files: [] });
const create = async (title: string, project: string) => artifactReadSchema.parse(await mcp('artifacts_create', { requestId: randomUUID(), snapshot: snapshot(title, `Cuerpo de ${title}`), project }));
const publicationOf = async (artifactId: string) => artifactReadSchema.parse(await mcp('artifacts_read', { artifactId })).publication;

/** The CSP of the parent branch with its script hashes masked; this PR may change only the hashes. */
const parentCsp = "default-src 'self';frame-src 'self';connect-src 'self';object-src 'none';base-uri 'none';form-action 'self';frame-ancestors 'none'; script-src 'self' '<hash>…'; script-src-attr 'none'; style-src 'self' 'unsafe-inline' ;";
const maskCsp = (header: string) => header.replace(/'sha(?:256|384|512)-[^']+'/g, "'<hash>'").replace(/( '<hash>')+/g, " '<hash>…'");

const palette = (page: Page) => page.getByRole('dialog', { name: 'Paleta de comandos', exact: true });
const paletteInput = (page: Page) => palette(page).getByRole('combobox', { name: 'Buscar en la paleta', exact: true });
const options = (page: Page) => palette(page).getByRole('option');
const optionTexts = (page: Page) => palette(page).locator('[role=option] .palette-label').allTextContents();
const highlighted = (page: Page) => palette(page).locator('[role=option][data-highlighted] .palette-label').textContent();
const selectedRow = (page: Page) => page.locator('[data-library-item][data-selected] .artifact-table-name > a').textContent();
const visibleHints = (page: Page) => page.locator('.status-keys > [data-key-hint]').evaluateAll((hints) => hints.filter((hint) => (hint as HTMLElement).checkVisibility()).map((hint) => hint.textContent!.replace(/\s+/g, ' ').trim()));
const focused = (page: Page) => page.evaluate(async () => { await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); const element = document.activeElement; return element ? `${element.tagName.toLowerCase()}${element.hasAttribute('data-floating-ui-focus-guard') ? '[guard]' : ''}${element.getAttribute('aria-label') ? `[${element.getAttribute('aria-label')}]` : ''}${element.closest('[data-palette]') ? ' in palette' : ''}` : null; });
const openPalette = async (page: Page) => {
  await page.keyboard.press('ControlOrMeta+k');
  await paletteInput(page).waitFor();
  await page.waitForFunction(() => document.activeElement?.matches('[data-palette] [role=combobox]'), undefined, { timeout: 2_000 }).catch(() => assert.fail('focus moves into the palette input'));
};
/** The palette reveals its trigger once it listens for ⌘K, so a visible trigger means the page is ready for keys. */
const hydrated = (page: Page) => page.waitForFunction(() => document.querySelectorAll('astro-island[ssr]').length === 0 && document.querySelector('[data-palette-open]:not([hidden])'));
let active: Page | undefined;
const contexts: BrowserContext[] = [];
try {
  const setup = await browser.newContext();
  const login = await setup.newPage();
  await login.goto(app.dashboard);
  await login.getByRole('link', { name: 'Iniciar sesión', exact: true }).press('Enter');
  await login.getByLabel('Correo electrónico').fill('owner@example.test');
  await login.getByLabel('Contraseña').fill(app.password);
  await login.getByRole('button', { name: 'Iniciar sesión', exact: true }).press('Enter');
  await login.getByRole('heading', { level: 1, name: 'Biblioteca', exact: true }).waitFor();
  const state = await setup.storageState();
  await setup.close();

  const published = await create('Guía publicada', 'Lectura');
  const pendingFirst = await create('Borrador con cambios', 'Lectura');
  const draft = await create('Notas sin publicar', 'Lectura');
  await create('Otra nota', 'Otro');
  for (const read of [published, pendingFirst]) await mcp('artifacts_publish', { requestId: randomUUID(), artifactId: read.artifactId, revisionId: read.headRevisionId, expectedPublicationVersion: 0 });
  const pending = artifactReadSchema.parse(await mcp('artifacts_update', { requestId: randomUUID(), artifactId: pendingFirst.artifactId, expectedRevisionId: pendingFirst.headRevisionId, snapshot: snapshot('Borrador con cambios', 'Contenido nuevo') }));

  const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 } });
  contexts.push(context);
  const page = active = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  const csp: Record<string, string> = {};
  for (const [label, path] of [['library', '/?project=Lectura'], ['read', '/read?project=Lectura'], ['projects', '/projects'], ['detail', `/artifacts/${draft.artifactId}`]] as const) {
    const header = (await page.goto(`${app.dashboard}${path}`))!.headers()['content-security-policy']!;
    csp[label] = header;
    assert.equal(maskCsp(header), parentCsp, `${label}: the CSP keeps the parent's directives and sources; only script hashes differ`);
  }
  await json('csp.json', csp);
  checks.push('the CSP of the library, read mode, projects, and detail keeps the parent branch directives and sources, with script-src-attr none; only the script hashes differ');

  await page.goto(`${app.dashboard}/?project=Lectura`);
  await hydrated(page);
  assert.deepEqual(await visibleHints(page), ['j k mover', '↵ leer', 'p publicar', 't tema'], 'the library lists the prototype hints for the keys that work on it');
  const trigger = page.getByRole('button', { name: 'Abrir la paleta de comandos', exact: true });
  const mac = process.platform === 'darwin';
  assert.equal(await trigger.textContent(), mac ? '⌘K' : 'Ctrl K');
  assert.equal(await trigger.getAttribute('aria-keyshortcuts'), mac ? 'Meta+K' : 'Control+K');
  assert.equal(await page.locator('a.reader-link .kbd').textContent(), 'r');
  assert.equal(await page.locator('a.reader-link .kbd').isVisible(), true, 'Modo lectura shows its r key');
  checks.push('with JavaScript the library shows j k mover, ↵ leer, p publicar, t tema, the ⌘K trigger in the search field, and r on Modo lectura');

  const opener = page.getByRole('link', { name: 'Guía publicada', exact: true });
  await opener.focus();
  await openPalette(page);
  const input = paletteInput(page);
  assert.equal(await input.getAttribute('placeholder'), 'Buscar artefactos, proyectos o acciones…');
  assert.deepEqual(await palette(page).locator('.palette-eyebrow').allTextContents(), ['Artefactos', 'Proyectos', 'Acciones']);
  assert.equal(await options(page).count(), 3 + 2 + 5, 'the palette lists the page artifacts, the workspace projects, and five actions');
  assert.equal(await highlighted(page), await options(page).first().locator('.palette-label').textContent(), 'the first option starts highlighted');
  const activeId = await input.getAttribute('aria-activedescendant');
  assert(activeId, 'the input names the highlighted option through aria-activedescendant');
  assert.equal(await page.locator(`[id="${activeId}"]`).getAttribute('data-highlighted'), '');
  await input.press('ArrowDown');
  const nextId = await input.getAttribute('aria-activedescendant');
  assert.notEqual(nextId, activeId, 'ArrowDown moves the highlight');
  assert.equal(await page.locator(`[id="${nextId}"]`).getAttribute('data-highlighted'), '', 'the named option is the highlighted one');
  await input.press('ArrowUp');
  assert.equal(await input.getAttribute('aria-activedescendant'), activeId, 'ArrowUp moves it back');
  for (let step = 0; step < 6; step++) {
    await page.keyboard.press('Tab');
    assert.match((await focused(page))!, / in palette$/, `Tab ${step + 1} keeps focus inside the palette`);
  }
  await page.keyboard.press('Shift+Tab');
  assert.match((await focused(page))!, / in palette$/, 'Shift+Tab keeps focus inside the palette');
  await page.keyboard.press('Escape');
  await palette(page).waitFor({ state: 'detached' });
  assert.equal(await opener.evaluate((element) => element === document.activeElement), true, 'Escape closes the palette and returns focus to the opener');
  await openPalette(page);
  await page.keyboard.press('ControlOrMeta+k');
  await palette(page).waitFor({ state: 'detached' });
  assert.equal(await opener.evaluate((element) => element === document.activeElement), true, 'the same chord closes it and returns focus');
  checks.push('⌘K opens the palette as a modal dialog named Paleta de comandos with focus in its combobox, aria-activedescendant follows ArrowDown and ArrowUp, Tab and Shift+Tab stay inside, and Escape or ⌘K close it and return focus to the opener');

  await openPalette(page);
  await input.fill('nota');
  assert.deepEqual(await optionTexts(page), ['Notas sin publicar', 'Buscar «nota» en toda la biblioteca'], 'the filter matches only what the page holds and always offers the full search');
  assert.deepEqual(await palette(page).locator('.palette-eyebrow').allTextContents(), ['Artefactos', 'Buscar']);
  await input.fill('lect');
  assert.deepEqual(await optionTexts(page), ['Lectura', 'Abrir Modo lectura', 'Buscar «lect» en toda la biblioteca'], 'projects and actions filter too');
  assert.deepEqual(await palette(page).locator('.palette-eyebrow').allTextContents(), ['Proyectos', 'Acciones', 'Buscar']);
  await input.fill('nota');
  assert.equal(await palette(page).locator('[role=option] .palette-label b').first().textContent(), 'Nota', 'the match is marked');
  await input.fill('GUIA');
  assert.deepEqual(await optionTexts(page), ['Guía publicada', 'Buscar «GUIA» en toda la biblioteca'], 'matching ignores case and accents');
  await input.fill('zzz inexistente');
  assert.deepEqual(await optionTexts(page), ['Buscar «zzz inexistente» en toda la biblioteca']);
  assert.equal(await palette(page).getByRole('status').textContent(), 'Nada en esta página coincide con «zzz inexistente».', 'an empty filter says so and keeps the full search');
  await Promise.all([page.waitForURL(`${app.dashboard}/?q=zzz+inexistente`), input.press('Enter')]);
  assert.equal(await page.getByRole('searchbox', { name: 'Buscar artefactos', exact: true }).inputValue(), 'zzz inexistente', 'the full search lands on the library GET search');
  checks.push('typing filters the page artifacts, projects, and actions ignoring case and accents, marks the match, says when nothing on the page matches, and always offers Buscar «q» en toda la biblioteca, which opens the GET search');

  const go = async (from: string, query: string, label: string, url: string) => {
    await record('Palette result', { from, query, label, url });
    await page.goto(`${app.dashboard}${from}`);
    await hydrated(page);
    await openPalette(page);
    await paletteInput(page).fill(query);
    await options(page).filter({ hasText: label }).first().hover();
    assert.equal(await highlighted(page), label, `hover highlights ${label}`);
    await Promise.all([page.waitForURL(`${app.dashboard}${url}`), options(page).filter({ hasText: label }).first().click()]);
  };
  await go('/?project=Lectura', 'borrador', 'Borrador con cambios', `/read?project=Lectura&artifact=${pending.artifactId}`);
  assert.equal(await page.locator('.reader-item[aria-current] .reader-item-title').textContent(), 'Borrador con cambios', 'an artifact opens in read mode');
  await go('/read?project=Lectura', 'notas', 'Notas sin publicar', `/read?project=Lectura&artifact=${draft.artifactId}`);
  await go('/projects', 'otro', 'Otro', '/?project=Otro');
  await go('/projects', 'biblio', 'Ir a Biblioteca', '/');
  await go('/', 'proyectos', 'Ir a Proyectos', '/projects');
  await go('/?project=Otro', 'lectura', 'Abrir Modo lectura', '/read?project=Otro');
  await page.goto(`${app.dashboard}/?project=Lectura`);
  await hydrated(page);
  await openPalette(page);
  await paletteInput(page).fill('tema');
  assert.deepEqual(await optionTexts(page), ['Cambiar a tema claro', 'Buscar «tema» en toda la biblioteca']);
  await paletteInput(page).press('Enter');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await openPalette(page);
  await paletteInput(page).fill('tema');
  assert.deepEqual(await optionTexts(page), ['Cambiar a tema oscuro', 'Buscar «tema» en toda la biblioteca'], 'the theme action names the theme it switches to');
  await paletteInput(page).press('Enter');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await openPalette(page);
  await paletteInput(page).fill('herramientas');
  await paletteInput(page).press('Enter');
  await page.locator('#connect-tools[open] .rail-panel').waitFor();
  assert.equal(await page.locator('#connect-tools > summary').evaluate((element) => element === document.activeElement), true, 'Conectar herramientas opens the tools panel and focuses its rail button');
  await page.keyboard.press('Escape');
  await page.locator('#connect-tools .rail-panel').waitFor({ state: 'hidden' });
  checks.push('each result kind goes where it says: an artifact to read mode on that artifact, a project to its library, Biblioteca, Proyectos, and Modo lectura to their pages, the theme action flips the theme in place, and Conectar herramientas opens the tools panel');

  await page.goto(`${app.dashboard}/?project=Lectura`);
  await hydrated(page);
  const rows = await page.locator('[data-library-item] .artifact-table-name > a').allTextContents();
  assert.equal(await page.locator('[data-library-item][data-selected]').count(), 0, 'no row starts selected');
  await page.keyboard.press('j');
  assert.equal(await selectedRow(page), rows[0], 'j selects the first row');
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-selected')), true, 'the selected row takes focus');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-library-item][data-selected] .artifact-actions')!).opacity === '1', undefined, { timeout: 2_000 }).catch(() => assert.fail('the selected row shows its actions'));
  await page.keyboard.press('j');
  assert.equal(await selectedRow(page), rows[1], 'j moves down');
  await page.keyboard.press('k');
  assert.equal(await selectedRow(page), rows[0], 'k moves up');
  await page.keyboard.press('k');
  assert.equal(await selectedRow(page), rows[0], 'k stops at the first row');
  for (const chord of ['Alt+j', 'Control+j', 'Meta+j', 'Shift+j']) {
    await page.keyboard.press(chord);
    assert.equal(await selectedRow(page), rows[0], `${chord} does not move the selection`);
  }
  const search = page.getByRole('searchbox', { name: 'Buscar artefactos', exact: true });
  await search.focus();
  await page.keyboard.type('jkptr');
  assert.equal(await search.inputValue(), 'jkptr', 'keys typed in the search field stay text');
  assert.equal(await selectedRow(page), rows[0], 'typing does not move the selection');
  assert.equal(await page.locator('dialog[open]').count(), 0, 'typing p does not open the publish confirmation');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark', 'typing t does not change the theme');
  await search.fill('');
  await openPalette(page);
  await page.keyboard.type('j');
  assert.equal(await paletteInput(page).inputValue(), 'j', 'j goes to the palette input while the palette is open');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: `Menú de ${rows[0]}`, exact: true }).click();
  await page.getByRole('menu').waitFor();
  await page.keyboard.press('j');
  assert.equal(await selectedRow(page), rows[0], 'j does nothing while a menu is open');
  await page.keyboard.press('Escape');
  await page.getByRole('menu').waitFor({ state: 'detached' });
  checks.push('j and k move the library row selection, which takes focus and shows the row actions, and stop at the edges; nothing fires with Alt, Control, Meta, or Shift, while typing in the search field, while the palette is open, or while a menu is open');

  while (await selectedRow(page) !== 'Guía publicada') await page.keyboard.press('j');
  await page.keyboard.press('p');
  assert.equal(await page.locator('dialog[open]').count(), 0, 'p does nothing on an artifact without pending changes');
  while (await selectedRow(page) !== 'Borrador con cambios') await page.keyboard.press(rows.indexOf('Borrador con cambios') > rows.indexOf('Guía publicada') ? 'j' : 'k');
  await page.keyboard.press('p');
  const confirm = page.getByRole('dialog', { name: 'Publicar rev. 2', exact: true });
  await confirm.waitFor();
  assert.match((await confirm.textContent())!, /Borrador con cambios\. Quien abra su publicación verá la revisión 2\. Hoy ve la revisión 1\./);
  assert.equal(await confirm.getByRole('button', { name: 'Publicar rev. 2', exact: true }).evaluate((button) => button === document.activeElement), true, 'focus starts on Publicar');
  await page.keyboard.press('j');
  assert.equal(await selectedRow(page), 'Borrador con cambios', 'shortcuts do not fire while the confirmation is open');
  await page.keyboard.press('Escape');
  await confirm.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-selected')), true, 'Escape returns focus to the selected row');
  assert.equal((await publicationOf(pending.artifactId))!.revisionId, pendingFirst.headRevisionId, 'cancelling publishes nothing');
  await page.keyboard.press('p');
  await confirm.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await confirm.waitFor({ state: 'hidden' });
  assert.equal((await publicationOf(pending.artifactId))!.revisionId, pendingFirst.headRevisionId, 'Cancelar publishes nothing');
  checks.push('p does nothing on an artifact without pending changes; on a pending one it opens a confirmation that names the revision, starts on Publicar, blocks other shortcuts, and Escape or Cancelar close it without publishing');

  await page.keyboard.press('Enter');
  await page.waitForURL(`${app.dashboard}/read?project=Lectura&artifact=${pending.artifactId}`);
  checks.push('Enter on the selected library row opens read mode on it');
  assert.deepEqual(await visibleHints(page), ['j k siguiente y anterior', 'f pantalla completa', 'p publicar', 'Esc volver'], 'read mode lists the prototype hints, with p for a pending selection');
  assert.deepEqual(await page.locator('.reader-item[aria-current] .reader-item-title').allTextContents(), ['Borrador con cambios']);
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.fullscreenElement?.matches('iframe.reader-preview'));
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.keyboard.press('j');
  await page.waitForFunction(() => document.querySelector('.reader-item[aria-current] .reader-item-title')?.textContent !== 'Borrador con cambios');
  assert.deepEqual(await visibleHints(page), ['j k siguiente y anterior', 'f pantalla completa', 'Esc volver'], 'the p hint leaves with a selection that has nothing to publish');
  await page.keyboard.press('p');
  assert.equal(await page.locator('dialog[open]').count(), 0, 'p does nothing in read mode on an artifact without pending changes');
  await page.keyboard.press('k');
  await page.waitForFunction(() => document.querySelector('.reader-item[aria-current] .reader-item-title')?.textContent === 'Borrador con cambios');
  await page.keyboard.press('p');
  await confirm.waitFor();
  await page.keyboard.press('Escape');
  await confirm.waitFor({ state: 'hidden' });
  assert.equal(new URL(page.url()).pathname, '/read', 'Escape closes the confirmation before it leaves read mode');
  await page.keyboard.press('p');
  await confirm.waitFor();
  await Promise.all([page.waitForURL(`${app.dashboard}/read?project=Lectura&artifact=${pending.artifactId}`), page.keyboard.press('Enter')]);
  await page.locator('.reader-head-meta .artifact-status').filter({ hasText: 'Publicado' }).waitFor();
  assert.equal((await publicationOf(pending.artifactId))!.revisionId, pending.headRevisionId, 'confirming publishes the head revision through the publish form');
  await page.locator('#connect-tools > summary').click();
  await page.keyboard.press('Escape');
  assert.equal(new URL(page.url()).pathname, '/read', 'Escape closes an open panel before it leaves read mode');
  await Promise.all([page.waitForURL(`${app.dashboard}/?project=Lectura`), page.keyboard.press('Escape')]);
  checks.push('in read mode f opens the existing fullscreen, j and k keep moving the selection, p confirms and publishes only a pending selection and then returns to it, and Escape first closes a dialog or panel and then leaves read mode for the library');

  await page.keyboard.press('t');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.equal((await context.cookies()).find(({ name }) => name === 'panel_theme')?.value, 'light', 't writes the theme cookie through the toggle');
  await page.keyboard.press('t');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.keyboard.press('r');
  await page.waitForURL(`${app.dashboard}/read?project=Lectura`);
  checks.push('t toggles the theme through the existing toggle, and r opens Modo lectura');

  await page.goto(`${app.dashboard}/?project=Lectura`);
  await hydrated(page);
  await page.getByRole('checkbox', { name: 'Seleccionar Notas sin publicar', exact: true }).check();
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 700, y: 10 } });
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  assert.equal(await page.getByRole('checkbox', { name: 'Seleccionar Notas sin publicar', exact: true }).isChecked(), true, 'j and k leave the checkbox selection alone');
  assert.equal(await page.locator('[data-selection-count]').textContent(), '1 seleccionados');
  checks.push('the checkbox selection survives j and k');

  await mcp('artifacts_update', { requestId: randomUUID(), artifactId: published.artifactId, expectedRevisionId: published.headRevisionId, snapshot: snapshot('Guía publicada', 'Guía revisada') });
  const reduced = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const moving = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  contexts.push(reduced, moving);
  const motion: Record<string, unknown> = {};
  for (const [label, target] of [['reduce', reduced], ['no-preference', moving]] as const) {
    await target.addInitScript(() => { if (window === top && location.protocol.startsWith('http')) addEventListener('pagereveal', (event) => sessionStorage.setItem('reveal', String(Boolean((event as PageRevealEvent).viewTransition)))); });
    const probe = await target.newPage();
    probe.on('pageerror', (error) => errors.push(error.message));
    await probe.goto(`${app.dashboard}/?project=Lectura`);
    await hydrated(probe);
    const banner = await probe.locator('.pending-banner').evaluate((element) => getComputedStyle(element).animationName);
    await openPalette(probe);
    const paletteAnimations = await probe.evaluate(() => [...document.querySelectorAll('.palette, .palette-backdrop')].flatMap((element) => element.getAnimations().map((animation) => (animation as CSSAnimation).animationName)).sort());
    await probe.keyboard.press('Escape');
    await palette(probe).waitFor({ state: 'detached' });
    await probe.keyboard.press('j');
    const rowActions = await probe.locator('[data-library-item]').nth(1).locator('.artifact-actions').evaluate((element) => getComputedStyle(element).transitionDuration);
    await Promise.all([probe.waitForURL(/\/read\?/), probe.keyboard.press('Enter')]);
    await probe.waitForLoadState('load');
    const toRead = await probe.evaluate(() => sessionStorage.getItem('reveal'));
    const document_ = await probe.locator('.reader-document').evaluate((element) => getComputedStyle(element).animationName);
    await Promise.all([probe.waitForURL(`${app.dashboard}/?project=Lectura`), probe.keyboard.press('Escape')]);
    const toLibrary = await probe.evaluate(() => sessionStorage.getItem('reveal'));
    await Promise.all([probe.waitForURL(/status=published/), probe.getByRole('navigation', { name: 'Filtrar por publicación', exact: true }).getByRole('link', { name: /^Publicados/ }).click()]);
    const filter = await probe.evaluate(() => sessionStorage.getItem('reveal'));
    motion[label] = { banner, palette: paletteAnimations, rowActions, readerDocument: document_, viewTransition: { libraryToRead: toRead, readToLibrary: toLibrary, libraryFilter: filter } };
  }
  const late = await moving.newPage();
  late.on('pageerror', (error) => errors.push(error.message));
  await late.goto(`${app.dashboard}/?project=Lectura`);
  await hydrated(late);
  let held = 0;
  await late.route('**/*.css', async (route) => { held += 1; await new Promise((done) => setTimeout(done, 300)); await route.continue(); });
  await Promise.all([late.waitForURL(/\/read\?/), late.keyboard.press('r')]);
  await late.waitForLoadState('load');
  await late.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  assert(held > 0, 'the stylesheet of read mode arrived after its body');
  assert.deepEqual(errors, [], 'a transition that Chrome drops before pagereveal reaches the page as no error');
  motion.lateStylesheet = { held, viewTransition: await late.evaluate(() => sessionStorage.getItem('reveal')) };
  await late.close();
  await json('motion.json', motion);
  assert.deepEqual(motion.reduce, { banner: 'none', palette: [], rowActions: '0s', readerDocument: 'none', viewTransition: { libraryToRead: 'false', readToLibrary: 'false', libraryFilter: 'false' } }, 'with reduced motion nothing animates or transitions, view transitions included');
  assert.deepEqual(motion['no-preference'], { banner: 'drop', palette: ['fade', 'pop'], rowActions: '0.16s, 0.16s', readerDocument: 'rise', viewTransition: { libraryToRead: 'true', readToLibrary: 'true', libraryFilter: 'false' } }, 'without a preference the banner drops, the palette pops, row actions ease in, the document rises, and library and read mode cross-fade');
  checks.push(`with reduced motion the banner, palette, row actions, reader document, and view transitions do not move; without a preference they do, and only library and read mode cross-fade into each other: ${JSON.stringify(motion)}`);

  const phone = await browser.newContext({ storageState: state, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  contexts.push(phone);
  const touch = active = await phone.newPage();
  touch.on('pageerror', (error) => errors.push(error.message));
  await touch.goto(`${app.dashboard}/?project=Lectura`);
  await hydrated(touch);
  assert.equal(await touch.locator('.status-keys').evaluate((element) => getComputedStyle(element).display), 'none', 'the phone status bar carries no shortcut hints');
  const phoneTrigger = touch.getByRole('button', { name: 'Abrir la paleta de comandos', exact: true });
  const box = (await phoneTrigger.boundingBox())!;
  assert(box.width >= 24 && box.height >= 24, `the trigger is a usable touch target: ${JSON.stringify(box)}`);
  await phoneTrigger.tap();
  await paletteInput(touch).waitFor();
  const paletteBox = (await palette(touch).boundingBox())!;
  assert(paletteBox.x >= 0 && paletteBox.x + paletteBox.width <= 390, `the palette fits the phone: ${JSON.stringify(paletteBox)}`);
  assert.equal(await touch.locator('.palette-footer').isVisible(), false, 'the phone palette drops the keyboard footer');
  await paletteInput(touch).fill('notas');
  await Promise.all([touch.waitForURL(/artifact=/), options(touch).filter({ hasText: 'Notas sin publicar' }).tap()]);
  assert.equal(new URL(touch.url()).searchParams.get('artifact'), draft.artifactId);
  await touch.screenshot({ path: join(evidence, 'phone-after-palette.png') });
  checks.push('at 390 with touch the palette opens from a tappable trigger in the search field, fits the screen without the keyboard footer, and a tapped result navigates; the status bar carries no hints');

  const plain = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
  contexts.push(plain);
  const noScript = active = await plain.newPage();
  for (const path of ['/?project=Lectura', '/read?project=Lectura']) {
    await noScript.goto(`${app.dashboard}${path}`);
    assert.deepEqual(await visibleHints(noScript), [], `${path}: without JavaScript no shortcut hint shows`);
    assert.equal(await noScript.locator('.palette-trigger').isVisible(), false, `${path}: without JavaScript the palette trigger stays hidden`);
    assert.equal(await noScript.locator('a.reader-link .kbd').isVisible().catch(() => false), false, `${path}: without JavaScript Modo lectura shows no key`);
  }
  await noScript.goto(`${app.dashboard}/?project=Lectura`);
  await noScript.getByRole('searchbox', { name: 'Buscar artefactos', exact: true }).fill('Notas');
  await Promise.all([noScript.waitForURL(`${app.dashboard}/?q=Notas&project=Lectura`), noScript.getByRole('searchbox', { name: 'Buscar artefactos', exact: true }).press('Enter')]);
  assert.deepEqual(await noScript.locator('[data-library-item] .artifact-table-name > a').allTextContents(), ['Notas sin publicar'], 'without JavaScript the search field is a working GET form');
  checks.push('without JavaScript no hint, key, or palette trigger shows, and the search field still submits its GET search');

  assert.deepEqual(errors, []);
  await json('result.json', { status: 'passed', browser: browser.version(), checks, errors });
  console.log(JSON.stringify({ status: 'passed', evidence, checks: checks.length }));
} catch (error) {
  if (active && !active.isClosed()) await active.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
  await json('failure.json', { status: 'failed', error: String(error), checks, errors });
  throw error;
} finally {
  for (const item of contexts) await item.close().catch(() => {});
  await browser.close();
  await app.close();
}
