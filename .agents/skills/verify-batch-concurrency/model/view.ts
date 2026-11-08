// pstack:statechart view for BatchConcurrency.tla: what the batch call is doing, in the caller's words.
type Vars = {
  pc: Record<string, string>;
  seen: Record<string, { receipt: unknown; projects: unknown; pages: unknown }>;
  attempt: Record<string, number>;
  outcome: Record<string, unknown>;
  truthful: boolean;
};

const reading = (seen: Vars['seen'][string]) => [seen.receipt, seen.projects, seen.pages].filter((read) => read !== 'NULL' && read !== null).length;

function call(v: Vars, p: string): string {
  if (v.pc[p] === 'done') {
    // A TLA+ sequence arrives as an object keyed from 1.
    const outcome = v.outcome[p];
    const head = typeof outcome === 'object' && outcome !== null ? (outcome as Record<string, unknown>)['1'] : outcome;
    if (head === 'ok') return 'Committed';
    if (head === 'replayed') return 'Returned the stored receipt';
    return `Failed with ${String(head)}`;
  }
  const done = reading(v.seen[p]!);
  const retry = v.attempt[p]! > 1 ? ', after a rejected write' : '';
  return done === 3 ? `Planned, write request pending${retry}` : `Reading (${done} of 3 reads)${retry}`;
}

export const title = 'store.batch against concurrent writers';
export const state = (v: Vars) => Object.fromEntries(Object.keys(v.pc).map((p) => [p === 'b1' ? 'Batch call' : 'Retried call', call(v, p)]));
export const group = (v: Vars) => (v.truthful ? 'consistent' : 'broken');
export const colors = { consistent: 'teal', broken: 'orange' };

export function step(action: string, from: Vars, to: Vars): string | null {
  switch (action) {
    case 'ReadReceipt': return 'the batch reads its receipt';
    case 'ReadProjects': return 'the batch reads the project spellings';
    case 'ReadPages': return 'the batch reads the pages it names';
    case 'Write': {
      const p = Object.keys(to.pc).find((key) => to.attempt[key] !== from.attempt[key] || to.pc[key] !== from.pc[key]);
      if (p && to.attempt[p] !== from.attempt[p]) return 'the write request hits a constraint and the batch reads again';
      return 'the batch sends its write request';
    }
    case 'Create': return 'another client creates a page';
    case 'Update': return 'another client updates a page';
    case 'Move': return 'another client moves a page';
    case 'Delete': return 'another client deletes a page';
    case 'Done': return null;
    default: return action;
  }
}
