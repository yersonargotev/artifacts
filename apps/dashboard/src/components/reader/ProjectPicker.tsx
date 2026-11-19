import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Autocomplete } from '@base-ui/react/autocomplete';
import { Popover } from '@base-ui/react/popover';
import Icon from '../Icon.tsx';
import { matchRange } from '../palette/entries.ts';
import { revealHint, shortcutAllowed } from '../shell/keys.ts';
import { pickerGroups, type PickerChoice, type PickerData, type PickerGroup, type PickerItem } from './picker.ts';

function Marked({ label, query }: Readonly<{ label: string; query: string }>) {
  const range = matchRange(label, query);
  if (!range) return label;
  return <>{label.slice(0, range[0])}<b>{label.slice(range[0], range[1])}</b>{label.slice(range[1])}</>;
}

function Dot({ choice }: Readonly<{ choice: PickerChoice }>) {
  return <span className="project-dot" data-tone={choice.tone} data-kind={choice.updated === undefined ? choice.id : undefined} aria-hidden="true"></span>;
}

function TriggerBody({ choice }: Readonly<{ choice: PickerChoice }>) {
  return <>
    <span className="project-picker-label">Proyecto</span>
    {choice.id !== 'all' && <Dot choice={choice} />}
    <span className="project-picker-current">{choice.id === 'all' ? 'Todos' : choice.label}</span>
    <span className="project-picker-count">{choice.count}</span>
    <Icon name="selector" size={14} />
  </>;
}

/** Without JavaScript, and until the island hydrates, the picker is a native disclosure of plain links. */
function Fallback({ data, current }: Readonly<{ data: PickerData; current: PickerChoice }>) {
  return <details className="project-picker" data-disclosure>
    <summary className="project-picker-trigger"><TriggerBody choice={current} /></summary>
    <nav className="project-filter project-picker-links" aria-label="Filtrar por proyecto">
      {data.choices.map((choice) => <a key={choice.id} href={choice.href} aria-current={choice.id === data.current ? 'page' : undefined} aria-label={`${choice.label} (${choice.count})`} title={choice.label}>
        <Dot choice={choice} /><span className="project-name">{choice.label}</span><span className="project-count">{choice.count}</span>
      </a>)}
    </nav>
  </details>;
}

const prefetched = new Set<string>();
/** Fetches the highlighted scope's page ahead of Enter, once per URL. Same-origin, so the CSP's default-src 'self' allows it. */
function prefetch(href: string) {
  if (prefetched.has(href)) return;
  prefetched.add(href);
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = href;
  document.head.append(link);
}

export default function ProjectPicker({ data: encoded }: Readonly<{ data: string }>) {
  const [data] = useState<PickerData>(() => JSON.parse(encoded));
  const current = data.choices.find((choice) => choice.id === data.current) ?? data.choices[0]!;
  const [enhanced, setEnhanced] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const hintId = useId();
  const list = useRef<HTMLDivElement>(null);
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  const groups = useMemo(() => pickerGroups(data, query), [data, query]);

  useEffect(() => {
    setEnhanced(true);
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'g' || !shortcutAllowed(event)) return;
      event.preventDefault();
      setQuery('');
      setOpen(true);
    };
    addEventListener('keydown', key, { capture: true });
    revealHint('project');
    return () => removeEventListener('keydown', key, { capture: true });
  }, []);

  // The list opens scrolled to the current scope, which can sit far down a long project list.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => list.current?.querySelector('[data-current]')?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  if (!enhanced) return <Fallback data={data} current={current} />;

  const highlight = (item: PickerItem | undefined) => {
    clearTimeout(pending.current);
    if (item && item.id !== data.current) pending.current = setTimeout(() => prefetch(item.href), 150);
  };
  const go = (item: PickerItem) => {
    setOpen(false);
    if (item.id !== data.current) location.assign(item.href);
  };

  return <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) setQuery(''); }}>
    <Popover.Trigger className="project-picker-trigger" aria-keyshortcuts="G" aria-label={`Proyecto: ${current.label}. Cambiar de proyecto`}><TriggerBody choice={current} /></Popover.Trigger>
    <Popover.Portal>
      <Popover.Backdrop className="project-picker-backdrop" />
      <Popover.Positioner className="project-picker-positioner" side="bottom" align="start" sideOffset={6}>
        <Popover.Popup className="project-picker-popup" aria-label="Elegir proyecto">
          <Autocomplete.Root open inline items={groups} filter={null} value={query} onValueChange={setQuery} autoHighlight="always" keepHighlight itemToStringValue={(item: PickerItem) => item.label} onItemHighlighted={highlight}>
            <div className="project-picker-search">
              <Icon name="search" size={14} />
              <Autocomplete.Input className="project-picker-input" aria-label="Buscar proyecto" aria-describedby={hintId} placeholder="Buscar proyecto…" maxLength={120} />
            </div>
            {query.trim() && !groups.length && <p className="project-picker-empty" role="status">Ningún proyecto contiene «{query.trim()}».</p>}
            <Autocomplete.List className="project-picker-list" ref={list}>
              {(group: PickerGroup) => <Autocomplete.Group key={group.value} items={group.items as PickerItem[]} className="project-picker-group">
                {group.label && <Autocomplete.GroupLabel className="project-picker-eyebrow">{group.label}</Autocomplete.GroupLabel>}
                <Autocomplete.Collection>
                  {(item: PickerItem) => <Autocomplete.Item key={item.key} value={item} onClick={() => go(item)} className="project-picker-item" data-current={item.id === data.current ? '' : undefined}>
                    <Dot choice={item} />
                    <span className="project-picker-name"><Marked label={item.label} query={query} /></span>
                    <span className="project-picker-count">{item.count}</span>
                    {item.id === data.current && <Icon name="circle-check" size={14} />}
                  </Autocomplete.Item>}
                </Autocomplete.Collection>
              </Autocomplete.Group>}
            </Autocomplete.List>
            <footer className="project-picker-footer" aria-hidden="true"><span><kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> navegar</span><span><kbd className="kbd">↵</kbd> abrir</span><span><kbd className="kbd">Esc</kbd> cerrar</span></footer>
            <span id={hintId} className="sr-only">Las flechas recorren los proyectos, Enter abre el resaltado y Escape cierra la lista.</span>
          </Autocomplete.Root>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
