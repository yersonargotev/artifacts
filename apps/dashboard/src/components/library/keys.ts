import { bindKeys, revealHint } from '../shell/keys.ts';
import { confirmPublish } from '../shell/publish.ts';

const items = [...document.querySelectorAll<HTMLElement>('[data-library-item]')];
const readerLink = document.querySelector<HTMLAnchorElement>('a.reader-link');
const publishable = (item: HTMLElement | undefined) => item?.querySelector<HTMLTemplateElement>('template[data-publish-confirm]');
let selected: HTMLElement | undefined;

// The selected row takes focus, so a screen reader announces it and Tab continues from it; the selection itself is the visible focus mark.
const select = (item: HTMLElement) => {
  selected?.removeAttribute('data-selected');
  selected = item;
  item.dataset.selected = '';
  item.tabIndex = -1;
  item.focus({ preventScroll: true });
  item.scrollIntoView({ block: 'nearest' });
};
const step = (direction: 1 | -1) => {
  const index = selected ? items.indexOf(selected) : -1;
  select(items[index < 0 ? 0 : Math.min(items.length - 1, Math.max(0, index + direction))]!);
};

for (const item of items) item.addEventListener('click', (event) => {
  if (event.target instanceof Element && !event.target.closest('a, button, input, label, summary, details')) select(item);
});
bindKeys({
  ...(items.length ? {
    j: () => step(1),
    k: () => step(-1),
    // Enter on a focused link or button keeps its own meaning; it opens read mode only from the selected row itself.
    Enter: (event: KeyboardEvent) => selected !== undefined && event.target === selected && location.assign(selected.dataset.reader!),
    p: () => confirmPublish(publishable(selected)),
  } : {}),
  ...(readerLink ? { r: () => location.assign(selected?.dataset.reader ?? readerLink.href) } : {}),
});
revealHint('move', items.length > 0);
revealHint('read', items.length > 0);
revealHint('publish', items.some((item) => publishable(item)));
revealHint('reader', Boolean(readerLink));
