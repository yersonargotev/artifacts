/** Returning false leaves the key to the browser, so a handler can decline a key it does not apply to right now. */
export type KeyHandler = (event: KeyboardEvent) => boolean | void;

const typing = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const overlay = 'dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], details[data-disclosure][open]';

/** A single-key shortcut acts only without a modifier, outside text entry, and while no dialog, menu, or panel is open. */
export function shortcutAllowed(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (event.target instanceof Element && event.target.closest(typing)) return false;
  return !document.querySelector(overlay);
}

/**
 * Listens in the capture phase on window, so an open menu or panel still counts as open when its own Escape handler runs later and closes it.
 * Each key maps to one handler; the event is prevented only when the handler acts.
 */
export function bindKeys(handlers: Readonly<Record<string, KeyHandler>>): void {
  addEventListener('keydown', (event) => {
    const handler = Object.hasOwn(handlers, event.key) ? handlers[event.key] : undefined;
    if (!handler || !shortcutAllowed(event)) return;
    if (handler(event) !== false) event.preventDefault();
  }, { capture: true });
}

/** Hints render hidden, so a page without JavaScript shows none; a script reveals the hints for the keys it binds. */
export function revealHint(name: string, shown = true): void {
  for (const hint of document.querySelectorAll<HTMLElement>(`[data-key-hint="${name}"]`)) hint.hidden = !shown;
}
