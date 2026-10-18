import { z } from 'zod';
import { moveSchema, projectNameSchema } from '@artifacts/artifacts/contracts';

const itemSchema = z.object({ artifactId: moveSchema.shape.artifactId, title: z.string(), project: projectNameSchema.nullable() });
export type MoveItem = z.infer<typeof itemSchema>;
export type MoveSelection = { artifactIds: string[]; items: MoveItem[] };

export function readMoveSelection(values: readonly unknown[], metadata: string): MoveSelection | null {
  const ids = z.array(moveSchema.shape.artifactId).min(1).max(25).safeParse(values);
  if (!ids.success) return null;
  try {
    const items = z.array(itemSchema).parse(JSON.parse(metadata));
    const artifactIds = [...new Set(ids.data)].sort();
    const selected: MoveItem[] = [];
    for (const id of artifactIds) {
      const item = items.find(({ artifactId }) => artifactId === id);
      if (!item) return null;
      selected.push(item);
    }
    return { artifactIds, items: selected };
  } catch { return null; }
}

export function readMoveTrigger(trigger: Element): MoveSelection | null {
  if (trigger instanceof HTMLAnchorElement) {
    const url = new URL(trigger.href);
    if (url.origin !== location.origin || url.pathname !== '/move' || trigger.hasAttribute('download') || (trigger.target && trigger.target !== '_self')) return null;
    return readMoveSelection(url.searchParams.getAll('artifactId'), trigger.dataset.moveItems ?? '');
  }
  if (!(trigger instanceof HTMLButtonElement) || trigger.type !== 'submit' || !trigger.form || trigger.disabled) return null;
  const form = trigger.form;
  const action = new URL(trigger.getAttribute('formaction') ?? form.action, location.href);
  if (action.origin !== location.origin || action.pathname !== '/move' || form.method !== 'get' || trigger.hasAttribute('formmethod')) return null;
  const metadata = Array.from(form.elements).flatMap((control) => control instanceof HTMLInputElement && control.name === 'artifactId' && control.checked && !control.disabled ? [control.dataset.moveItem] : []);
  return readMoveSelection(new FormData(form).getAll('artifactId'), `[${metadata.join(',')}]`);
}
