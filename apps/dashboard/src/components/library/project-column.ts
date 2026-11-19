import { matchRange } from '../palette/entries.ts';
import { bindKeys, revealHint } from '../shell/keys.ts';

const column = document.querySelector<HTMLElement>('[data-project-column]');
if (column) {
  const details = column.querySelector<HTMLDetailsElement>('[data-project-column-details]')!;
  const list = column.querySelector<HTMLElement>('.project-column-list')!;
  const projects = [...list.querySelectorAll<HTMLAnchorElement>('a[data-project-name]')];
  const label = list.querySelector('.project-column-label');
  const empty = list.querySelector<HTMLElement>('[data-project-empty]')!;
  const searchLabel = column.querySelector<HTMLElement>('[data-project-search]')!;
  const search = searchLabel.querySelector('input')!;
  const narrow = matchMedia('(max-width: 760px)');

  // On a phone the column starts as a closed button; without JavaScript it stays open, so every project is still a link away.
  // The summary that closes it shows only on a phone, so a wider window must keep it open.
  details.open = !narrow.matches;
  narrow.addEventListener('change', () => { details.open = !narrow.matches; });
  // The filter earns its place only once the list no longer fits at a glance.
  searchLabel.hidden = projects.length <= 8;

  const writeCookie = (name: string, value: string) => {
    document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`;
  };
  const setSort = (sort: string) => {
    writeCookie(column.dataset.sortCookie!, sort);
    const key = (link: HTMLAnchorElement) => sort === 'name' ? Number(link.dataset.nameOrder) : -Number(link.dataset.updated);
    const sorted = [...projects].sort((left, right) => key(left) - key(right) || Number(left.dataset.nameOrder) - Number(right.dataset.nameOrder));
    (label ?? list.firstElementChild)!.after(...sorted);
    for (const button of column.querySelectorAll<HTMLButtonElement>('button[name="sort"]')) button.setAttribute('aria-pressed', String(button.value === sort));
  };
  const setCollapsed = (collapsed: boolean) => {
    writeCookie(column.dataset.columnCookie!, collapsed ? 'collapsed' : 'expanded');
    column.toggleAttribute('data-collapsed', collapsed);
    const button = column.querySelector<HTMLButtonElement>('button[name="column"]')!;
    button.value = collapsed ? 'expanded' : 'collapsed';
    button.setAttribute('aria-label', collapsed ? 'Mostrar la columna de proyectos' : 'Ocultar la columna de proyectos');
    button.title = collapsed ? 'Mostrar proyectos' : 'Ocultar proyectos';
  };
  // The forms post to /project-column without JavaScript; here the same choice applies in place and keeps the cookie.
  for (const form of column.querySelectorAll<HTMLFormElement>('[data-project-column-form]')) form.addEventListener('submit', (event) => {
    const submitter = event.submitter;
    if (!(submitter instanceof HTMLButtonElement)) return;
    event.preventDefault();
    if (submitter.name === 'sort') setSort(submitter.value);
    else setCollapsed(submitter.value === 'collapsed');
  });

  const filter = () => {
    const query = search.value.trim();
    let shown = 0;
    for (const link of projects) {
      const visible = !query || Boolean(matchRange(link.dataset.projectName!, query));
      link.hidden = !visible;
      if (visible) shown++;
    }
    empty.hidden = shown > 0;
  };
  search.addEventListener('input', filter);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const first = projects.find((link) => !link.hidden);
      if (first) { event.preventDefault(); first.click(); }
    } else if (event.key === 'Escape' && search.value) {
      event.preventDefault();
      event.stopPropagation();
      search.value = '';
      filter();
    }
  });

  list.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' });

  bindKeys({
    g: () => {
      if (narrow.matches) details.open = true;
      else if (column.hasAttribute('data-collapsed')) setCollapsed(false);
      if (!searchLabel.hidden) search.focus();
      else (list.querySelector<HTMLAnchorElement>('a[aria-current]') ?? list.querySelector('a'))?.focus();
    },
  });
  revealHint('project');
}
