const reader = document.querySelector<HTMLElement>('[data-reader]');
if (reader?.querySelector('[data-reader-pane]')) {
  const items = [...reader.querySelectorAll<HTMLAnchorElement>('[data-reader-item]')];
  const pane = () => reader.querySelector<HTMLElement>('[data-reader-pane]')!;
  const current = () => items.findIndex((item) => item.hasAttribute('aria-current'));
  const byHref = (href: string) => items.find((item) => item.getAttribute('href') === href);
  const enhance = (root: HTMLElement) => {
    const fullscreen = root.querySelector<HTMLButtonElement>('[data-reader-fullscreen]');
    if (fullscreen) fullscreen.hidden = !document.fullscreenEnabled;
  };
  enhance(pane());

  // The server renders each row's pane into a template, so the pane after a client-side move matches the page a link would load.
  const show = (item: HTMLAnchorElement) => {
    for (const other of items) other.removeAttribute('aria-current');
    item.setAttribute('aria-current', 'page');
    const template = reader.querySelector<HTMLTemplateElement>(`template[data-reader-template="${CSS.escape(item.dataset.artifactId!)}"]`)!;
    // A new frame loads without adding a history entry, so Back keeps walking the reader URLs instead of the frame.
    const next = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    enhance(next);
    pane().replaceWith(next);
    item.scrollIntoView({ block: 'nearest' });
  };

  const select = (item: HTMLAnchorElement) => {
    if (item.hasAttribute('aria-current')) return;
    show(item);
    history.pushState(null, '', item.href);
  };

  /** Follows the pane's Anterior or Siguiente link, in the same document when it names a row of this page. */
  const step = (direction: 1 | -1, focus: boolean) => {
    const href = pane().querySelector(`[data-reader-step="${direction}"]`)?.getAttribute('href');
    if (!href) return;
    const item = byHref(href);
    if (!item) return location.assign(href);
    select(item);
    if (focus) item.focus();
  };

  const plainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  for (const item of items) item.addEventListener('click', (event) => {
    if (!plainClick(event)) return;
    event.preventDefault();
    select(item);
  });

  reader.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('[data-reader-fullscreen]')) {
      void pane().querySelector<HTMLIFrameElement>('[data-reader-frame]')!.requestFullscreen().catch(() => {});
      return;
    }
    const link = event.target.closest<HTMLAnchorElement>('a[data-reader-step][href]');
    const item = link && byHref(link.getAttribute('href')!);
    if (!item || !plainClick(event)) return;
    event.preventDefault();
    select(item);
  });

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || !items.length) return;
    const target = event.target as HTMLElement;
    if (target.isContentEditable || target.closest('input, textarea, select')) return;
    const inList = items.includes(target as HTMLAnchorElement);
    const key = event.key === 'j' ? 1 : event.key === 'k' ? -1 : 0;
    const arrow = inList && event.key === 'ArrowDown' ? 1 : inList && event.key === 'ArrowUp' ? -1 : 0;
    if (!key && !arrow) return;
    event.preventDefault();
    const index = current();
    // Arrows stay inside the list they move focus through; j and k go where the pane's links go, onto the next or previous page at an edge.
    if (key && index >= 0) return step(key, inList);
    const item = items[index < 0 ? 0 : Math.min(items.length - 1, Math.max(0, index + arrow))]!;
    select(item);
    if (inList) item.focus();
  });

  addEventListener('popstate', () => {
    const params = new URL(location.href).searchParams;
    const artifactId = params.get('artifact');
    const item = artifactId ? items.find((candidate) => candidate.dataset.artifactId === artifactId) : params.get('at') === 'last' ? items.at(-1) : items[0];
    // The first entry can name an artifact from another page, which only the server can render.
    if (item) show(item);
    else location.reload();
  });
}
