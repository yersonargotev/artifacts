import { projectKey, type ArtifactCard, type Workspace } from '@artifacts/artifacts/panel/model';

export type CardGroup = { readonly project: string | null; readonly cards: readonly ArtifactCard[] };

/** Groups one page of cards in the workspace's project order, then any project the workspace does not list, then Sin proyecto. Cards keep their page order inside a group. */
export function groupCards(cards: readonly ArtifactCard[], projects: Workspace['projects']): CardGroup[] {
  const named = new Map<string, { project: string; cards: ArtifactCard[] }>(projects.map(({ name }) => [projectKey(name), { project: name, cards: [] }]));
  const unfiled: ArtifactCard[] = [];
  for (const card of cards) {
    if (card.project === null) { unfiled.push(card); continue; }
    const key = projectKey(card.project);
    if (!named.has(key)) named.set(key, { project: card.project, cards: [] });
    named.get(key)!.cards.push(card);
  }
  return [...named.values(), { project: null, cards: unfiled }].filter((group) => group.cards.length > 0);
}
