import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { MoveForm as MoveFields } from '../../move.ts';
import { Input } from '../ui/input.tsx';
import { Combobox, ComboboxContent, ComboboxGroup, ComboboxInput, ComboboxItem, ComboboxLabel, ComboboxList } from '../ui/combobox.tsx';
import { matchProjects, matchSegments } from './match.ts';

type Props = { form: MoveFields; projects: readonly string[]; canRemove: boolean; invalid: boolean; cancel?: ReactNode };

export function MoveForm({ form, projects, canRemove, invalid, cancel }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const restoredSelection = useRef<{ start: number | null; end: number | null } | null>(null);
  const [draft, setDraft] = useState(form.project ?? '');
  const [enhanced, setEnhanced] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (input.current) {
      setDraft(input.current.value);
      if (document.activeElement === input.current) restoredSelection.current = { start: input.current.selectionStart, end: input.current.selectionEnd };
    }
    setEnhanced(true);
  }, []);
  useLayoutEffect(() => {
    if (enhanced && restoredSelection.current && input.current) {
      input.current.focus();
      input.current.setSelectionRange(restoredSelection.current.start, restoredSelection.current.end);
      restoredSelection.current = null;
    }
  }, [enhanced]);
  const groups = matchProjects(projects, draft);
  const choices = (names: readonly string[]) => names.map((name) => <ComboboxItem key={name} value={name}>{matchSegments(name, draft).map((part, index) => part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</ComboboxItem>);
  return <form className="move-form" method="post" action="/move">
    {form.artifactIds.map((artifactId) => <input key={artifactId} type="hidden" name="artifactId" value={artifactId} />)}
    <input type="hidden" name="requestId" value={form.requestId} />
    <label htmlFor={id}>Proyecto</label>
    {enhanced ? <>
      <input type="hidden" name="project" value={draft} />
      <Combobox items={groups.items} filter={null} value={selected} inputValue={draft} onInputValueChange={(value, details) => { if (details.reason === 'input-change') setDraft(value); }} onValueChange={(value, details) => { if (details.reason === 'escape-key') details.allowPropagation(); setSelected(value); if (value !== null) setDraft(value); }}>
        <ComboboxInput id={id} ref={input} autoComplete="off" aria-invalid={invalid || undefined} aria-describedby={`${id}-help`} />
        <ComboboxContent><ComboboxList>
          {groups.matches.length > 0 && <ComboboxGroup>{choices(groups.matches)}</ComboboxGroup>}
          {groups.others.length > 0 && <ComboboxGroup><ComboboxLabel>Otros proyectos</ComboboxLabel>{choices(groups.others)}</ComboboxGroup>}
          {groups.create !== null && <ComboboxItem value={groups.create}>Crear proyecto «{groups.create}»</ComboboxItem>}
        </ComboboxList></ComboboxContent>
      </Combobox>
    </> : <>
      <Input id={id} ref={input} name="project" defaultValue={form.project ?? ''} list={`${id}-options`} autoComplete="off" aria-invalid={invalid || undefined} aria-describedby={`${id}-help`} />
      <datalist id={`${id}-options`}>{projects.map((name) => <option key={name} value={name} />)}</datalist>
    </>}
    {invalid ? <p id={`${id}-help`} className="field-error" role="alert">Escribe un nombre de proyecto de 1 a 80 caracteres, sin caracteres de control.</p> : <p id={`${id}-help`} className="field-help">Elige un proyecto existente o escribe uno nuevo.</p>}
    <div className="move-actions">
      <button data-variant="primary" type="submit" name="intent" value="move">{cancel ? 'Mover' : 'Mover al proyecto'}</button>
      {cancel ?? <a className="button secondary" href="/">Cancelar</a>}
      {canRemove && <button className="move-remove" type="submit" name="intent" value="remove">Quitar del proyecto</button>}
    </div>
  </form>;
}

export default function MovePageForm({ data }: { data: string }) {
  const [props] = useState<Props>(() => JSON.parse(data));
  return <MoveForm {...props} />;
}
