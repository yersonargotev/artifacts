// Loaded as a blocking script in the head so the listeners exist before the first frame. A deferred module can run after pagereveal and leave the incoming transition's rejection uncaught.
// Every panel page opts into cross-document view transitions. Only a move between the library and read mode fades; any other navigation swaps at once.
(() => {
  const views = ['/', '/read'];
  const quiet = (transition) => { for (const promise of [transition.ready, transition.finished, transition.updateCallbackDone]) promise.catch(() => {}); };
  addEventListener('pagereveal', (event) => { if (event.viewTransition) quiet(event.viewTransition); });
  addEventListener('pageswap', (event) => {
    if (!event.viewTransition) return;
    quiet(event.viewTransition);
    const target = event.activation?.entry.url;
    const to = target ? new URL(target).pathname : undefined;
    if (!to || to === location.pathname || !views.includes(to) || !views.includes(location.pathname)) event.viewTransition.skipTransition();
  });
})();
