const reader = document.querySelector<HTMLElement>('[data-reader]');
const pane = reader?.querySelector<HTMLElement>('[data-reader-pane]');
if (reader && pane) {
  const items = [...reader.querySelectorAll<HTMLAnchorElement>('[data-reader-item]')];
  const title = pane.querySelector<HTMLElement>('[data-reader-title]')!;
  const state = pane.querySelector<HTMLElement>('[data-reader-state]')!;
  const detail = pane.querySelector<HTMLAnchorElement>('[data-reader-detail]')!;
  const publication = pane.querySelector<HTMLAnchorElement>('[data-reader-publication]')!;

  const show = (item: HTMLAnchorElement) => {
    for (const other of items) other.removeAttribute('aria-current');
    item.setAttribute('aria-current', 'page');
    const name = item.querySelector('.reader-item-title')!.textContent!;
    const status = item.querySelector<HTMLElement>('.artifact-status')!;
    title.textContent = name;
    state.textContent = status.textContent;
    state.dataset.state = status.dataset.state;
    detail.href = item.dataset.detail!;
    publication.hidden = !item.dataset.publication;
    if (item.dataset.publication) publication.href = item.dataset.publication;
    // A new frame loads without adding a history entry, so Back keeps walking the reader URLs instead of the frame.
    const frame = pane.querySelector<HTMLIFrameElement>('[data-reader-frame]')!;
    const next = frame.cloneNode() as HTMLIFrameElement;
    next.title = `Vista previa de ${name}`;
    next.setAttribute('sandbox', item.dataset.sandbox!);
    next.src = item.dataset.preview!;
    frame.replaceWith(next);
    item.scrollIntoView({ block: 'nearest' });
  };

  const select = (item: HTMLAnchorElement) => {
    if (item.hasAttribute('aria-current')) return;
    show(item);
    history.pushState(null, '', item.href);
  };

  for (const item of items) item.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    select(item);
  });

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || !items.length) return;
    const target = event.target as HTMLElement;
    if (target.isContentEditable || target.closest('input, textarea, select')) return;
    const inList = items.includes(target as HTMLAnchorElement);
    const step = event.key === 'j' || (inList && event.key === 'ArrowDown') ? 1 : event.key === 'k' || (inList && event.key === 'ArrowUp') ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const current = items.findIndex((item) => item.hasAttribute('aria-current'));
    const item = items[current < 0 ? 0 : Math.min(items.length - 1, Math.max(0, current + step))]!;
    select(item);
    if (inList) item.focus();
  });

  addEventListener('popstate', () => {
    const artifactId = new URL(location.href).searchParams.get('artifact');
    const item = artifactId ? items.find((candidate) => candidate.dataset.artifactId === artifactId) : items[0];
    // The first entry can name an artifact from another page, which only the server can render.
    if (item) show(item);
    else location.reload();
  });
}
