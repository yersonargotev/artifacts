import { projectNameSchema } from '@artifacts/artifacts/contracts';
import { projectKey } from '@artifacts/artifacts/panel/model';

const searchable = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function matchProjects(projects: readonly string[], draft: string) {
  const query = searchable(draft.trim());
  const matches = projects.filter((name) => searchable(name).includes(query));
  const others = projects.filter((name) => !searchable(name).includes(query));
  const parsed = projectNameSchema.safeParse(draft);
  const create = parsed.success && !projects.some((name) => projectKey(name) === projectKey(parsed.data)) ? parsed.data : null;
  return { matches, others, create, items: [...matches, ...others, ...(create === null ? [] : [create])] };
}

export function matchSegments(name: string, draft: string): { text: string; match: boolean }[] {
  const query = searchable(draft.trim());
  const start = query ? searchable(name).indexOf(query) : -1;
  if (start < 0) return [{ text: name, match: false }];
  const characters = Array.from(name);
  let offset = 0;
  const segments: { text: string; match: boolean }[] = [];
  for (const character of characters) {
    const length = searchable(character).length;
    const match = length === 0 ? segments.at(-1)?.match ?? false : offset < start + query.length && offset + length > start;
    const last = segments.at(-1);
    if (last?.match === match) last.text += character;
    else segments.push({ text: character, match });
    offset += length;
  }
  return segments;
}
