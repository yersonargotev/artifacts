import type { IconName } from '../icons.ts';
import { themeToggle, type Theme } from '../../theme.ts';

/** What the page already holds: its own artifacts, the workspace projects, and where Modo lectura opens from here. */
export type PaletteData = {
  readonly artifacts: readonly { readonly title: string; readonly project: string | null; readonly tone: string | undefined; readonly href: string }[];
  readonly projects: readonly { readonly name: string; readonly tone: string; readonly count: number; readonly href: string }[];
  readonly reader: string;
  /** Whether `r` opens read mode on this page, so the palette shows the key only where it works. */
  readonly readerKey: boolean;
};

export type PaletteRun = { readonly kind: 'go'; readonly href: string } | { readonly kind: 'theme' } | { readonly kind: 'tools' };
export type PaletteItem = { readonly id: string; readonly label: string; readonly icon: IconName; readonly meta?: string; readonly tone?: string | undefined; readonly key?: string; readonly run: PaletteRun };
export type PaletteGroup = { readonly value: string; readonly items: readonly PaletteItem[] };

/** Folds case and accents one character at a time, so a match in the folded text maps back to the same characters of the label. */
function fold(text: string) {
  let folded = '';
  const source: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const piece = text[index]!.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    folded += piece;
    for (let count = 0; count < piece.length; count++) source.push(index);
  }
  return { folded, source };
}

/** The characters of label that the query matches, ignoring case and accents. */
export function matchRange(label: string, query: string): readonly [number, number] | undefined {
  const needle = fold(query.trim()).folded;
  if (!needle) return undefined;
  const { folded, source } = fold(label);
  const start = folded.indexOf(needle);
  if (start < 0) return undefined;
  return [source[start]!, source[start + needle.length - 1]! + 1];
}

export const searchLimit = 256;

export function paletteGroups(data: PaletteData, query: string, theme: Theme): PaletteGroup[] {
  const q = query.trim().slice(0, searchLimit);
  const toggle = themeToggle[theme];
  const groups: PaletteGroup[] = [
    { value: 'Artefactos', items: data.artifacts.map((artifact, index) => ({ id: `artifact-${index}`, label: artifact.title, icon: 'book', meta: artifact.project ?? 'Sin proyecto', tone: artifact.tone, run: { kind: 'go', href: artifact.href } })) },
    { value: 'Proyectos', items: data.projects.map((project) => ({ id: `project-${project.name}`, label: project.name, icon: 'folder', meta: `${project.count} ${project.count === 1 ? 'artefacto' : 'artefactos'}`, tone: project.tone, run: { kind: 'go', href: project.href } })) },
    { value: 'Acciones', items: [
      { id: 'library', label: 'Ir a Biblioteca', icon: 'layout-grid', run: { kind: 'go', href: '/' } },
      { id: 'projects', label: 'Ir a Proyectos', icon: 'folder', run: { kind: 'go', href: '/projects' } },
      { id: 'reader', label: 'Abrir Modo lectura', icon: 'book', ...(data.readerKey ? { key: 'r' } : {}), run: { kind: 'go', href: data.reader } },
      { id: 'theme', label: toggle.label, icon: toggle.icon, key: 't', run: { kind: 'theme' } },
      { id: 'tools', label: 'Conectar herramientas', icon: 'plug-connected', run: { kind: 'tools' } },
    ] },
  ];
  const matching = groups.map((group) => ({ ...group, items: q ? group.items.filter((item) => matchRange(item.label, q)) : group.items })).filter((group) => group.items.length);
  // The page holds at most one page of artifacts, so the palette always offers the library's own search over everything.
  return q ? [...matching, { value: 'Buscar', items: [{ id: 'search', label: `Buscar «${q}» en toda la biblioteca`, icon: 'search', run: { kind: 'go', href: `/?${new URLSearchParams({ q })}` } }] }] : matching;
}
