import type { BrowserContext, Page } from 'playwright';

export async function observeMoveReadiness(context: BrowserContext) {
  await context.addInitScript(() => {
    const add = document.addEventListener;
    const remove = document.removeEventListener;
    const active = new Set<EventListenerOrEventListenerObject>();
    document.addEventListener = function (this: Document, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
      const result = Reflect.apply(add, this, arguments);
      if (this === document && type === 'click' && (options === true || (options !== null && typeof options === 'object' && options.capture)) && typeof listener === 'function' && Function.prototype.toString.call(listener).includes('data-move-trigger')) active.add(listener);
      Reflect.set(window, 'moveDialogListenerCount', active.size);
      return result;
    };
    document.removeEventListener = function (this: Document, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
      const result = Reflect.apply(remove, this, arguments);
      if (this === document && type === 'click' && (options === true || (options !== null && typeof options === 'object' && options.capture)) && listener) active.delete(listener);
      Reflect.set(window, 'moveDialogListenerCount', active.size);
      return result;
    };
  });
}

export async function waitForMoveReadiness(page: Page) {
  await page.locator('astro-island[component-url*="MoveDialog"]:not([ssr])').waitFor({ state: 'attached' });
  await page.waitForFunction(() => Reflect.get(window, 'moveDialogListenerCount') === 1);
}
