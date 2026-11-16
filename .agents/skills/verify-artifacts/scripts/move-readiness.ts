import type { BrowserContext, Page } from 'playwright';

export async function observeMoveReadiness(context: BrowserContext) {
  await context.addInitScript(() => {
    const add = document.addEventListener;
    const remove = document.removeEventListener;
    const active = new Set<EventListenerOrEventListenerObject>();
    document.addEventListener = function (this: Document, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
      const result = add.call(this, type, listener, options);
      if (this === document && type === 'click' && (options === true || (options !== null && typeof options === 'object' && options.capture)) && typeof listener === 'function' && Function.prototype.toString.call(listener).includes('data-move-trigger')) active.add(listener);
      (window as Window & { moveDialogListenerCount?: number }).moveDialogListenerCount = active.size;
      return result;
    };
    document.removeEventListener = function (this: Document, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
      const result = remove.call(this, type, listener, options);
      if (this === document && type === 'click' && (options === true || (options !== null && typeof options === 'object' && options.capture))) active.delete(listener);
      (window as Window & { moveDialogListenerCount?: number }).moveDialogListenerCount = active.size;
      return result;
    };
  });
}

export async function waitForMoveReadiness(page: Page) {
  await page.locator('astro-island[component-url*="MoveDialog"]:not([ssr])').waitFor({ state: 'attached' });
  await page.waitForFunction(() => (window as Window & { moveDialogListenerCount?: number }).moveDialogListenerCount === 1);
}
