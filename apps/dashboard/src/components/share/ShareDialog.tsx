import { useLayoutEffect, useRef, useState } from 'react';
import { encodeShareCommand, type ShareCommand, type ShareSubmission, type ShareView } from '../../share.ts';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.tsx';
import { ShareForm } from './ShareForm.tsx';

type Pending = { command: ShareCommand; status: 'submitting' | 'uncertain' };
type Opening = { id: number; artifactId: string; href: string; trigger: HTMLElement; fallback: HTMLElement | null; read: number; view?: ShareView; submission?: ShareSubmission; error?: 'unavailable' | 'denied' };
type Display = Opening & { pending?: Pending };

export default function ShareDialog() {
  const [display, setDisplay] = useState<Display | null>(null);
  const [open, setOpen] = useState(false);
  const active = useRef<Opening | null>(null);
  const last = useRef<Opening | null>(null);
  const sequence = useRef(0);
  const commands = useRef(new Map<string, Pending>());
  const content = useRef<HTMLDivElement>(null);
  const show = (opening: Opening) => {
    if (active.current === opening) setDisplay({ ...opening, pending: commands.current.get(opening.artifactId) });
  };
  const load = async (opening: Opening) => {
    const generation = ++opening.read;
    try {
      const response = await fetch(opening.href, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error([401, 403, 404].includes(response.status) ? 'denied' : 'unavailable');
      const view: ShareView = await response.json();
      if (view.artifactId !== opening.artifactId || !['ready', 'unavailable'].includes(view.shares?.kind)) throw new Error('unavailable');
      if (active.current !== opening || generation !== opening.read) return;
      opening.view = view;
      opening.error = undefined;
    } catch (error) {
      if (active.current !== opening || generation !== opening.read) return;
      opening.error = error instanceof Error && error.message === 'denied' ? 'denied' : 'unavailable';
      if (opening.view) opening.view = { ...opening.view, shares: { kind: 'unavailable' } };
    }
    show(opening);
  };
  const submit = async (command: ShareCommand) => {
    const opening = active.current;
    if (!opening) return;
    const artifactId = opening.artifactId;
    const existing = commands.current.get(artifactId);
    if (existing?.status === 'submitting') return;
    const pending: Pending = { command: existing?.command ?? Object.freeze({ ...command }), status: 'submitting' };
    commands.current.set(artifactId, pending);
    ++opening.read;
    opening.submission = undefined;
    show(opening);
    let submission: ShareSubmission = { outcome: 'uncertain' };
    let denied = false;
    try {
      const response = await fetch(opening.href, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: encodeShareCommand(pending.command) });
      if ([401, 403, 404].includes(response.status)) denied = true;
      else {
        const result = await response.json();
        if ((response.status === 200 && result.outcome === 'confirmed') || (response.status === 400 && result.outcome === 'invalid') || (response.status === 409 && (result.outcome === 'conflict' || result.outcome === 'share_limit'))) submission = result;
      }
    } catch {}
    const outcome = submission.outcome;
    if (outcome === 'uncertain' && !denied) pending.status = 'uncertain';
    else commands.current.delete(artifactId);
    const current = active.current;
    if (!current || current.artifactId !== artifactId) return;
    current.submission = denied ? undefined : submission;
    if (denied) {
      ++current.read;
      current.error = 'denied';
      show(current);
      return;
    }
    if (current.view) current.view = { ...current.view, shares: { kind: 'unavailable' }, requestIds: outcome === 'uncertain' ? current.view.requestIds : { share: crypto.randomUUID(), unshare: {} } };
    show(current);
    await load(current);
  };
  useLayoutEffect(() => {
    const capture = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const trigger = event.target.closest<HTMLAnchorElement>('a[data-share-trigger]');
      if (!trigger || trigger.target && trigger.target !== '_self' || trigger.hasAttribute('download')) return;
      const url = new URL(trigger.href, location.href);
      const match = /^\/artifacts\/([^/]+)\/share$/.exec(url.pathname);
      if (url.origin !== location.origin || url.search || url.hash || !match) return;
      event.preventDefault();
      const opening: Opening = { id: ++sequence.current, artifactId: decodeURIComponent(match[1]), href: url.pathname, trigger, fallback: document.getElementById(trigger.dataset.shareReturn ?? ''), read: 0 };
      if (active.current) ++active.current.read;
      active.current = opening;
      last.current = opening;
      show(opening);
      setOpen(true);
      void load(opening);
    };
    document.addEventListener('click', capture, true);
    return () => { document.removeEventListener('click', capture, true); active.current = null; };
  }, []);
  useLayoutEffect(() => {
    if (open && display?.view && content.current && (document.activeElement === content.current || !content.current.contains(document.activeElement))) content.current.querySelector<HTMLInputElement>('input[type="email"]')?.focus();
  }, [open, display?.id, Boolean(display?.view)]);
  return <Dialog open={open} onOpenChange={(next) => {
    if (!next) { if (active.current) ++active.current.read; active.current = null; }
    setOpen(next);
  }}>
    <DialogContent ref={content} initialFocus={() => content.current?.querySelector('input[type="email"]') ?? content.current ?? false} finalFocus={() => {
      const opening = last.current;
      if (opening?.trigger.isConnected) return opening.trigger;
      if (opening?.fallback?.isConnected) return opening.fallback;
      const fallback = document.querySelector<HTMLElement>('#main-content h1') ?? document.getElementById('main-content');
      if (fallback) fallback.tabIndex = -1;
      return fallback ?? false;
    }}>
      <DialogTitle>Compartir</DialogTitle>
      <DialogDescription>{display?.view?.title ?? 'Administra quién puede abrir la publicación.'}</DialogDescription>
      {display?.error === 'denied' ? <p role="alert">No se puede abrir este artefacto.</p> : display?.view ? <ShareForm key={display.id} view={display.view} submission={display.pending?.status === 'uncertain' ? { outcome: 'uncertain' } : display.submission} command={display.pending?.command} busy={display.pending?.status === 'submitting'} onSubmit={(command) => { void submit(command); }} onRefresh={() => { if (active.current) void load(active.current); }} /> : display?.error ? <div role="alert"><p>No pudimos cargar el acceso actual.</p><button className="secondary" onClick={() => { if (active.current) void load(active.current); }}>Reintentar</button><a href={display.href}>Abrir página de compartir</a></div> : <p role="status">Cargando acceso…</p>}
      <DialogClose type="button" className="secondary share-close">Cerrar</DialogClose>
    </DialogContent>
  </Dialog>;
}
