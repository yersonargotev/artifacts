import { matchRange } from '../palette/entries.ts';

/** What read mode's project picker needs: every scope it can switch to, already linked to read mode. */
export type PickerData = {
  readonly current: string;
  readonly choices: readonly PickerChoice[];
};
export type PickerChoice = {
  /** `all`, `unfiled`, or `project:<name>`, so a choice and the current scope compare as strings. */
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly href: string;
  readonly tone?: string | undefined;
  /** Epoch milliseconds of the project's latest update; only projects carry it. */
  readonly updated?: number;
};
export type PickerItem = PickerChoice & { readonly key: string };
export type PickerGroup = { readonly value: string; readonly label?: string; readonly items: readonly PickerItem[] };

export const recentLimit = 5;
/** Below this many projects the recent group would repeat most of the list. */
const recentFrom = 7;

/** With no query: the two library scopes, the most recently updated projects, then every project in name order. A query searches each choice once. */
export function pickerGroups(data: PickerData, query: string): PickerGroup[] {
  const q = query.trim();
  const keyed = (group: string) => (choice: PickerChoice): PickerItem => ({ ...choice, key: `${group}:${choice.id}` });
  const scopes = data.choices.filter((choice) => choice.updated === undefined);
  const projects = data.choices.filter((choice) => choice.updated !== undefined);
  if (q) {
    const found = data.choices.flatMap((choice) => { const range = matchRange(choice.label, q); return range ? [{ choice, at: range[0] }] : []; })
      .sort((left, right) => left.at - right.at).map(({ choice }) => keyed('match')(choice));
    return found.length ? [{ value: 'match', items: found }] : [];
  }
  const recent = [...projects].sort((left, right) => right.updated! - left.updated!).slice(0, recentLimit);
  return [
    { value: 'scopes', items: scopes.map(keyed('scopes')) },
    ...(projects.length >= recentFrom ? [{ value: 'recent', label: 'Recientes', items: recent.map(keyed('recent')) }] : []),
    ...(projects.length ? [{ value: 'projects', label: projects.length >= recentFrom ? 'Todos · A–Z' : 'Proyectos', items: projects.map(keyed('projects')) }] : []),
  ];
}
