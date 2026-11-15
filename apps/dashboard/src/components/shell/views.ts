// Every panel page opts into cross-document view transitions, since a page that did not would receive the aborted transition of the page before it as an uncaught error.
// Only a move between the library and read mode fades; a filter, a sort, the next page, or any other page swaps at once.
const views = ['/', '/read'];
// A skipped or aborted transition rejects its promises, which would surface as uncaught errors.
const quiet = (transition: ViewTransition) => { for (const promise of [transition.ready, transition.finished, transition.updateCallbackDone]) promise.catch(() => {}); };
addEventListener('pagereveal', (event) => { if (event.viewTransition) quiet(event.viewTransition); });
addEventListener('pageswap', (event) => {
  if (!event.viewTransition) return;
  quiet(event.viewTransition);
  const target = event.activation?.entry.url;
  const to = target ? new URL(target).pathname : undefined;
  if (!to || to === location.pathname || !views.includes(to) || !views.includes(location.pathname)) event.viewTransition.skipTransition();
});
export {};
