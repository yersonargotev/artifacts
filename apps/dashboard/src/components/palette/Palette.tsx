import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Autocomplete } from '@base-ui/react/autocomplete';
import { Dialog } from '@base-ui/react/dialog';
import Icon from '../Icon.tsx';
import { isTheme, type Theme } from '../../theme.ts';
import { matchRange, paletteGroups, searchLimit, type PaletteData, type PaletteGroup, type PaletteItem } from './entries.ts';

const otherOverlay = 'dialog[open], [role="dialog"]:not([data-palette]), [role="alertdialog"], [role="menu"]';

function Marked({ label, query }: Readonly<{ label: string; query: string }>) {
  const range = matchRange(label, query);
  if (!range) return label;
  return <>{label.slice(0, range[0])}<b>{label.slice(range[0], range[1])}</b>{label.slice(range[1])}</>;
}

export default function Palette({ data: encoded }: Readonly<{ data: string }>) {
  const [data] = useState<PaletteData>(() => JSON.parse(encoded));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState<Theme>('dark');
  const hintId = useId();
  const opened = useRef(false);
  const returnTo = useRef<HTMLElement | null>(null);
  const afterClose = useRef<(() => void) | null>(null);
  const groups = useMemo(() => paletteGroups(data, query, theme), [data, query, theme]);
  const onlySearch = Boolean(query.trim()) && groups.length === 1;

  const change = (next: boolean) => { opened.current = next; setOpen(next); };
  const show = () => {
    returnTo.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const current = document.documentElement.dataset.theme;
    setTheme(isTheme(current) ? current : 'dark');
    setQuery('');
    change(true);
  };

  useEffect(() => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    for (const trigger of document.querySelectorAll<HTMLElement>('[data-palette-open]')) {
      trigger.setAttribute('aria-keyshortcuts', mac ? 'Meta+K' : 'Control+K');
      const label = trigger.querySelector('kbd');
      if (label) label.textContent = mac ? '⌘K' : 'Ctrl K';
      trigger.hidden = false;
    }
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-palette-open]')) return;
      event.preventDefault();
      show();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(mac ? event.metaKey : event.ctrlKey) || event.altKey || event.shiftKey || document.querySelector(otherOverlay)) return;
      event.preventDefault();
      if (opened.current) change(false);
      else show();
    };
    document.addEventListener('click', click);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('click', click); document.removeEventListener('keydown', key); };
  }, []);

  const run = (item: PaletteItem) => {
    const action = item.run;
    if (action.kind === 'go') {
      change(false);
      location.assign(action.href);
      return;
    }
    if (action.kind === 'theme') afterClose.current = () => document.querySelector<HTMLFormElement>('form[data-theme-cookie]')?.requestSubmit();
    if (action.kind === 'tools') {
      const tools = document.querySelector<HTMLDetailsElement>('#connect-tools');
      returnTo.current = tools?.querySelector('summary') ?? returnTo.current;
      afterClose.current = () => { if (tools) tools.open = true; };
    }
    change(false);
  };

  return <Dialog.Root open={open} onOpenChange={change} onOpenChangeComplete={(next) => { if (next) return; const task = afterClose.current; afterClose.current = null; task?.(); }}>
    <Dialog.Portal>
      <Dialog.Backdrop className="palette-backdrop" />
      <Dialog.Viewport className="palette-viewport">
        <Dialog.Popup className="palette" aria-label="Paleta de comandos" data-palette finalFocus={() => returnTo.current?.isConnected ? returnTo.current : true}>
          <Autocomplete.Root open inline items={groups} filter={null} value={query} onValueChange={setQuery} autoHighlight="always" keepHighlight itemToStringValue={(item: PaletteItem) => item.label}>
            <Autocomplete.Input className="palette-input" aria-label="Buscar en la paleta" aria-describedby={hintId} placeholder="Buscar artefactos, proyectos o acciones…" maxLength={searchLimit} />
            <Dialog.Close className="sr-only">Cerrar la paleta</Dialog.Close>
            {onlySearch && <p className="palette-empty" role="status">Nada en esta página coincide con «{query.trim()}».</p>}
            <Autocomplete.List className="palette-list">
              {(group: PaletteGroup) => <Autocomplete.Group key={group.value} items={group.items as PaletteItem[]} className="palette-group">
                <Autocomplete.GroupLabel className="palette-eyebrow">{group.value}</Autocomplete.GroupLabel>
                <Autocomplete.Collection>
                  {(item: PaletteItem) => <Autocomplete.Item key={item.id} value={item} onClick={() => run(item)} className="palette-item">
                    <Icon name={item.icon} size={16} />
                    <span className="palette-label">{item.id === 'search' ? item.label : <Marked label={item.label} query={query} />}</span>
                    <span className="palette-meta">
                      {item.meta && <>{item.tone !== undefined && <span className="project-dot" data-tone={item.tone} aria-hidden="true"></span>}{item.meta}</>}
                      {item.key && <kbd className="kbd" aria-label={`Atajo ${item.key}`}>{item.key}</kbd>}
                      <kbd className="kbd palette-enter" aria-hidden="true">↵</kbd>
                    </span>
                  </Autocomplete.Item>}
                </Autocomplete.Collection>
              </Autocomplete.Group>}
            </Autocomplete.List>
            <footer className="palette-footer" aria-hidden="true"><span><kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> navegar</span><span><kbd className="kbd">↵</kbd> abrir</span><span><kbd className="kbd">Esc</kbd> cerrar</span></footer>
            <span id={hintId} className="sr-only">Las flechas recorren los resultados, Enter abre el resaltado y Escape cierra la paleta.</span>
          </Autocomplete.Root>
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  </Dialog.Root>;
}
