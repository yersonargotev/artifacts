import { parseCanvas, type Snapshot } from '@artifacts/artifacts/contracts';
import { escapeHtml, sourceBlock } from './markup.ts';

const icon = (...paths: string[]) => `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths.map((path) => `<path d="${path}"/>`).join('')}</svg>`;
const icons = {
  open: icon('M16 4l4 0l0 4', 'M14 10l6 -6', 'M8 20l-4 0l0 -4', 'M4 20l6 -6'),
  minus: icon('M5 12l14 0'),
  plus: icon('M12 5l0 14', 'M5 12l14 0'),
  fit: icon('M4 8v-2a2 2 0 0 1 2 -2h2', 'M4 16v2a2 2 0 0 0 2 2h2', 'M16 4h2a2 2 0 0 1 2 2v2', 'M16 20h2a2 2 0 0 0 2 -2v-2'),
  back: icon('M5 12l14 0', 'M5 12l6 6', 'M5 12l6 -6'),
};

// Items on other pages stay laid out but invisible, so their boards load at their declared size instead of 0 x 0.
const style = `
:root{--ground:#dce0e8;--panel:#eff1f5;--line:#ccd0da;--text:#4c4f69;--muted:#5c5f77;--accent:#1e66f5;--on-accent:#fff;--edge:rgb(76 79 105/.16);--shadow:0 6px 24px rgb(76 79 105/.18);--bar:60px;color-scheme:light dark}
@media(prefers-color-scheme:dark){:root{--ground:#11111b;--panel:#1e1e2e;--line:#313244;--text:#cdd6f4;--muted:#a6adc8;--accent:#89b4fa;--on-accent:#11111b;--edge:#45475a;--shadow:0 6px 24px rgb(0 0 0/.5)}}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;overflow:hidden;background:var(--ground);color:var(--text);font:14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}
button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:44px;min-height:44px;padding:0 10px;border:0;border-radius:10px;background:none;color:inherit;font:inherit;font-weight:500;cursor:pointer}
button:hover{background:var(--line)}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}button[aria-pressed=true]{background:var(--accent);color:var(--on-accent)}svg{flex:none}
.canvas{position:fixed;inset:0;overflow:clip;touch-action:none;user-select:none;cursor:grab;--tx:0px;--ty:0px;--s:1}.canvas:active{cursor:grabbing}
.world{position:absolute;left:0;top:0;transform-origin:0 0;transform:translate(var(--tx),var(--ty)) scale(var(--s))}
.board{position:absolute;left:calc(var(--x)*1px);top:calc(var(--y)*1px);width:calc(var(--w)*1px);height:calc(var(--h)*1px);background:#fff;box-shadow:0 0 0 1px var(--edge),0 10px 32px rgb(0 0 0/.16)}
.board>iframe{display:block;width:100%;height:100%;border:0}.world>[hidden]{display:block;visibility:hidden}
.board-name{position:absolute;left:0;bottom:100%;max-width:max(44px,calc(var(--w)*var(--s)*1px));justify-content:flex-start;align-items:flex-end;padding:0 4px 6px;border-radius:8px;color:var(--muted);font-size:13px;transform-origin:0 100%;scale:calc(1/var(--s))}
.board-name:hover{background:none;color:var(--text)}.board-name span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.board-name svg{width:14px;height:14px}
.note{position:absolute;left:calc(var(--x)*1px);top:calc(var(--y)*1px);width:calc(var(--w,320)*1px);margin:0;padding:16px 18px;border:1px solid color-mix(in srgb,#df8e1d 45%,#f9e2af);border-radius:6px;background:#f9e2af;color:#4c4f69;font-size:20px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;box-shadow:0 4px 14px rgb(0 0 0/.12)}
.controls{position:fixed;z-index:1;top:12px;left:12px;right:12px;display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px;pointer-events:none}
.pages,.zoom,.focus-bar{display:flex;align-items:center;gap:4px;padding:4px;border:1px solid var(--line);background:var(--panel);box-shadow:var(--shadow)}
.pages,.zoom{max-width:100%;border-radius:14px;pointer-events:auto}.pages{overflow-x:auto;scrollbar-width:none}.pages button{flex:none;padding:0 14px}
.zoom{margin-left:auto}.zoom-level{min-width:52px;text-align:center;color:var(--muted);font-variant-numeric:tabular-nums}
.focus-bar{position:fixed;z-index:1;top:0;left:0;right:0;height:var(--bar);gap:12px;padding:0 12px;border-width:0 0 1px;box-shadow:none}.focus-bar p{display:flex;gap:10px;min-width:0;margin:0}.focus-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.focus-size{flex:none;color:var(--muted);font-variant-numeric:tabular-nums}
body[data-focus] .canvas{top:var(--bar);overflow:auto;padding:24px;touch-action:auto;user-select:auto;cursor:auto}body[data-focus] .world{position:static;transform:none}body[data-focus] .board{position:relative;left:0;top:0;margin:0 auto}
body[data-focus] :is(.board:not([data-focused]),.note,.board-name,.controls),body:not([data-focus]) .focus-bar{display:none}
`;

// A string literal keeps the served bytes identical across tsx, Vite, and the Worker bundle; the retained verifier compares them.
const script = `
const canvas = document.querySelector('.canvas');
const boards = [...canvas.querySelectorAll('.board')];
const items = [...canvas.querySelector('.world').children];
const pages = [...document.querySelectorAll('[data-action=page]')];
const controls = document.querySelector('.controls');
const zoomLevel = document.querySelector('.zoom-level');
const state = { view: null, page: pages[0]?.dataset.page ?? null, focus: null };
let mouse = null;

function fitted() {
  const visible = items.filter((item) => !item.hidden);
  if (!visible.length) return { x: 0, y: 0, s: 1 };
  const left = Math.min(...visible.map((item) => item.offsetLeft));
  const top = Math.min(...visible.map((item) => item.offsetTop));
  const width = Math.max(...visible.map((item) => item.offsetLeft + item.offsetWidth)) - left;
  const height = Math.max(...visible.map((item) => item.offsetTop + item.offsetHeight)) - top;
  const inset = { side: 24, top: controls.offsetTop + controls.offsetHeight + 52, bottom: 24 };
  const room = { width: canvas.clientWidth - 2 * inset.side, height: canvas.clientHeight - inset.top - inset.bottom };
  const s = Math.max(1e-4, Math.min(1, room.width / width, room.height / height));
  return { s, x: inset.side + (room.width - width * s) / 2 - left * s, y: inset.top + (room.height - height * s) / 2 - top * s };
}

function place() {
  const { x, y, s } = state.view ?? fitted();
  canvas.style.setProperty('--tx', x + 'px');
  canvas.style.setProperty('--ty', y + 'px');
  canvas.style.setProperty('--s', String(s));
  zoomLevel.textContent = Math.round(s * 100) + ' %';
}

function render() {
  const focused = state.focus === null ? undefined : boards[state.focus];
  document.body.toggleAttribute('data-focus', focused !== undefined);
  for (const item of items) item.hidden = state.page !== null && item.dataset.page !== state.page;
  for (const board of boards) {
    board.toggleAttribute('data-focused', board === focused);
    board.querySelector('iframe').inert = board !== focused;
  }
  for (const button of pages) button.setAttribute('aria-pressed', String(button.dataset.page === state.page));
  if (focused) {
    const frame = focused.querySelector('iframe');
    document.querySelector('.focus-name').textContent = frame.title;
    document.querySelector('.focus-size').textContent = frame.offsetWidth + ' × ' + frame.offsetHeight;
  }
  place();
}

function move(change) {
  state.view = change(state.view ?? fitted());
  place();
}
const pan = (dx, dy) => move(({ x, y, s }) => ({ x: x + dx, y: y + dy, s }));
const zoom = (factor, cx, cy) => move(({ x, y, s }) => {
  const next = Math.min(4, Math.max(Math.min(0.02, s), s * factor));
  return { x: cx - (cx - x) * next / s, y: cy - (cy - y) * next / s, s: next };
});
function refocus(element) {
  const view = state.view;
  element.focus({ preventScroll: true });
  state.view = view;
  place();
}

const actions = {
  'zoom-in': () => zoom(1.25, canvas.clientWidth / 2, canvas.clientHeight / 2),
  'zoom-out': () => zoom(0.8, canvas.clientWidth / 2, canvas.clientHeight / 2),
  fit: () => { state.view = null; place(); },
  page: (button) => { state.page = button.dataset.page; state.view = null; render(); },
  open: (button) => {
    state.focus = boards.indexOf(button.closest('.board'));
    render();
    canvas.scrollTo(0, 0);
    document.querySelector('[data-action=close]').focus();
  },
  close: () => {
    const board = boards[state.focus];
    state.focus = null;
    render();
    refocus(board.querySelector('.board-name'));
  },
};
document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (button) actions[button.dataset.action](button);
});
addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.focus !== null) actions.close();
});
addEventListener('resize', () => {
  mouse = null;
  if (state.view === null) place();
});

let hostFocus = null;
document.addEventListener('focusin', (event) => { hostFocus = event.target; });
// Inert does not stop a board's own script from taking focus, so the host returns focus that lands in an inert board.
function recoverFocus() {
  if (!document.hasFocus()) return;
  const frame = document.activeElement;
  if (frame instanceof HTMLIFrameElement && frame.inert) refocus(hostFocus ?? controls.querySelector('button'));
}
requestAnimationFrame(function initialFocus() {
  recoverFocus();
  if (hostFocus === null) requestAnimationFrame(initialFocus);
});
addEventListener('blur', () => {
  mouse = null;
  setTimeout(recoverFocus);
});

canvas.addEventListener('focusin', (event) => {
  if (state.focus !== null || !event.target.matches(':focus-visible')) return;
  const box = event.target.getBoundingClientRect();
  const dx = box.left < 16 ? 16 - box.left : box.right > canvas.clientWidth - 16 ? canvas.clientWidth - 16 - box.right : 0;
  const top = controls.offsetTop + controls.offsetHeight + 8;
  const dy = box.top < top ? top - box.top : box.bottom > canvas.clientHeight - 16 ? canvas.clientHeight - 16 - box.bottom : 0;
  if (dx || dy) pan(dx, dy);
});
addEventListener('wheel', (event) => {
  if (state.focus !== null) return;
  event.preventDefault();
  const unit = [1, 16, canvas.clientHeight][event.deltaMode];
  const pivot = mouse && Math.trunc(mouse.x) === event.clientX && Math.trunc(mouse.y) === event.clientY ? mouse : { x: event.clientX, y: event.clientY };
  if (event.ctrlKey) zoom(Math.exp(-Math.max(-50, Math.min(50, event.deltaY * unit)) / 200), pivot.x, pivot.y);
  else pan(-event.deltaX * unit, -event.deltaY * unit);
}, { passive: false });

const pointers = new Map();
canvas.addEventListener('pointerdown', (event) => {
  if (state.focus !== null || event.button !== 0 || event.target.closest('button')) return;
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
});
addEventListener('pointerout', (event) => {
  if (event.pointerType === 'mouse' && event.relatedTarget === null) mouse = null;
});
addEventListener('pointermove', (event) => {
  if (event.pointerType === 'mouse') mouse = { x: event.clientX, y: event.clientY };
  const last = pointers.get(event.pointerId);
  if (!last) return;
  const other = [...pointers].find(([id]) => id !== event.pointerId)?.[1];
  if (other) {
    const before = Math.hypot(last.x - other.x, last.y - other.y);
    zoom(before ? Math.hypot(event.clientX - other.x, event.clientY - other.y) / before : 1, (last.x + other.x) / 2, (last.y + other.y) / 2);
    pan((event.clientX - last.x) / 2, (event.clientY - last.y) / 2);
  } else pan(event.clientX - last.x, event.clientY - last.y);
  last.x = event.clientX;
  last.y = event.clientY;
});
canvas.addEventListener('lostpointercapture', (event) => pointers.delete(event.pointerId));

render();
`;

export function canvasDocument(snapshot: Pick<Snapshot, 'content' | 'files'>, interactive: boolean) {
  const { index, boards } = parseCanvas(snapshot);
  const name = (board: { title?: string; path: string }) => escapeHtml(board.title ?? board.path);
  const notes = Object.values(index.notes ?? {});
  const heading = (text: string) => `<h2 style="font:600 20px/1.4 system-ui">${text}</h2>`;
  if (!interactive) return `<p>Vista de código. Abre este diseño en Chrome 152 o posterior para usar su lienzo interactivo.</p>${boards.map((board) => `${heading(name(board))}${sourceBlock(board.html)}`).join('')}${notes.length ? `${heading('Notas')}${notes.map((note) => sourceBlock(note.text)).join('')}` : ''}`;
  const pages = index.pages ?? [];
  const page = (id: string | undefined) => pages.length ? ` data-page="${escapeHtml(id ?? pages[0]!.id)}"` : '';
  const pageBar = pages.length ? `<nav class="pages" aria-label="Páginas">${pages.map((item, position) => `<button type="button" data-action="page" data-page="${escapeHtml(item.id)}" aria-label="Página ${escapeHtml(item.name)}" aria-pressed="${position === 0}">${escapeHtml(item.name)}</button>`).join('')}</nav>` : '';
  const focusBar = `<header class="focus-bar"><button type="button" data-action="close" aria-label="Volver al lienzo">${icons.back}<span>Volver al lienzo</span></button><p><span class="focus-name"></span><span class="focus-size"></span></p></header>`;
  // Boards stay inert on the canvas so pointer input and Tab reach the host; the focus view makes one board interactive.
  const boardMarkup = boards.map((board) => `<section class="board"${page(board.page)} style="--x:${board.x};--y:${board.y};--w:${board.w};--h:${board.h}"><button class="board-name" type="button" data-action="open" aria-label="Abrir ${name(board)} a tamaño real"><span>${name(board)}</span>${icons.open}</button><iframe title="${name(board)}" sandbox="allow-scripts" inert srcdoc="${escapeHtml(board.html)}"></iframe></section>`).join('');
  const noteMarkup = notes.map((note) => `<p class="note"${page(note.page)} style="--x:${note.x};--y:${note.y}${note.w === undefined ? '' : `;--w:${note.w}`}">${escapeHtml(note.text)}</p>`).join('');
  const zoomBar = `<div class="zoom" role="group" aria-label="Zoom del lienzo"><button type="button" data-action="zoom-out" aria-label="Alejar">${icons.minus}</button><span class="zoom-level">100 %</span><button type="button" data-action="zoom-in" aria-label="Acercar">${icons.plus}</button><button type="button" data-action="fit" aria-label="Ajustar a la vista">${icons.fit}<span>Ajustar</span></button></div>`;
  return `<style>${style}</style><div class="controls">${pageBar}${zoomBar}</div>${focusBar}<main class="canvas" aria-label="Lienzo"><div class="world">${boardMarkup}${noteMarkup}</div></main><script>${script}</script>`;
}
