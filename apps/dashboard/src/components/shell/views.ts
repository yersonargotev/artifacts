// `views.css` opts the library and read mode into cross-document view transitions; only a move between the two fades, so a filter, a sort, or the next page swaps at once.
const views = ['/', '/read'];
addEventListener('pageswap', (event) => {
  const target = event.activation?.entry.url;
  if (!event.viewTransition) return;
  const to = target ? new URL(target).pathname : undefined;
  if (!to || to === location.pathname || !views.includes(to) || !views.includes(location.pathname)) event.viewTransition.skipTransition();
});
export {};
