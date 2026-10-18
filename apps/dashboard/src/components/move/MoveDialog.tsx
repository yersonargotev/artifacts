import { useLayoutEffect, useRef, useState } from 'react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.tsx';
import { MoveForm } from './MoveForm.tsx';
import { readMoveTrigger, type MoveSelection } from './trigger.ts';

type Opening = MoveSelection & { requestId: string; trigger: HTMLElement; fallback: HTMLElement | null };

export default function MoveDialog({ projects: encodedProjects }: { projects: string }) {
  const [projects] = useState<string[]>(() => JSON.parse(encodedProjects));
  const [opening, setOpening] = useState<Opening | null>(null);
  const [open, setOpen] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const capture = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const trigger = event.target.closest<HTMLElement>('[data-move-trigger]');
      if (!trigger) return;
      const selection = readMoveTrigger(trigger);
      if (!selection) return;
      event.preventDefault();
      setOpening({ ...selection, requestId: crypto.randomUUID(), trigger, fallback: document.getElementById(trigger.dataset.moveReturn ?? '') });
      setOpen(true);
    };
    document.addEventListener('click', capture, true);
    return () => document.removeEventListener('click', capture, true);
  }, []);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent ref={content} initialFocus={() => content.current?.querySelector('input:not([type="hidden"])') ?? false} finalFocus={() => opening?.trigger.isConnected ? opening.trigger : opening?.fallback ?? false}>
      {opening && <>
        <DialogTitle>Mover {opening.artifactIds.length} {opening.artifactIds.length === 1 ? 'artefacto' : 'artefactos'}</DialogTitle>
        <DialogDescription>No crea revisiones ni cambia lo publicado.</DialogDescription>
        <ul className="move-subjects">{opening.items.map((item) => <li key={item.artifactId}>{item.title}<span>{item.project ?? 'Sin proyecto'}</span></li>)}</ul>
        <MoveForm key={opening.requestId} form={{ artifactIds: opening.artifactIds, requestId: opening.requestId, project: opening.items.length === 1 ? opening.items[0].project ?? '' : '', intent: 'move' }} projects={projects} canRemove={opening.items.some((item) => item.project !== null)} invalid={false} cancel={<DialogClose type="button" className="secondary">Cancelar</DialogClose>} />
      </>}
    </DialogContent>
  </Dialog>;
}
