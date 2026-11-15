import type { ArtifactCard, LibraryPage } from '@artifacts/artifacts/panel/model';

/** One artifact as read mode shows it: its own reader URL, its place in the whole filtered list, and the links to the artifacts before and after it. */
export type ReaderRow = { readonly card: ArtifactCard; readonly href: string; readonly position: string | undefined; readonly previous: string | undefined; readonly next: string | undefined };

/**
 * Numbers the page's rows in the order they are shown and links each to its neighbors.
 * At an edge of the page the link goes to the adjacent page only when a URL can name it, so `before` and `after` are undefined when it cannot.
 */
export function readerRows(cards: readonly ArtifactCard[], page: LibraryPage, offset: number | undefined, links: { row: (card: ArtifactCard) => string; before: string | undefined; after: string | undefined }): ReaderRow[] {
  const hrefs = cards.map(links.row);
  const total = page.counts[page.status];
  return cards.map((card, index) => ({
    card,
    href: hrefs[index]!,
    position: offset === undefined ? undefined : `${offset + index + 1} de ${total}`,
    previous: index > 0 ? hrefs[index - 1] : links.before,
    next: index < cards.length - 1 ? hrefs[index + 1] : links.after,
  }));
}

/** A selection from another page keeps its own URL but has no place on this page, so it shows no position and no neighbors. */
export const detachedRow = (card: ArtifactCard, href: string): ReaderRow => ({ card, href, position: undefined, previous: undefined, next: undefined });
