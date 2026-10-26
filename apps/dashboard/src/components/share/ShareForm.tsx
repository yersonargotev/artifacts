import { useId, useLayoutEffect, useRef, type SubmitEvent } from 'react';
import { shareNotices, type ShareCommand, type ShareSubmission, type ShareView } from '../../share.ts';
import { Input } from '../ui/input.tsx';

type Props = { view: ShareView; submission?: ShareSubmission; command?: ShareCommand; busy?: boolean; onSubmit?: (command: ShareCommand) => void; onRefresh?: () => void };

export function ShareForm({ view, submission, command, busy = false, onSubmit, onRefresh }: Props) {
  const outcome = submission?.outcome;
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const uncertain = outcome === 'uncertain';
  const disabled = busy || uncertain;
  const action = `/artifacts/${encodeURIComponent(view.artifactId)}/share`;
  useLayoutEffect(() => { if (outcome === 'invalid') input.current?.focus(); }, [outcome]);
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    if (!onSubmit) return;
    event.preventDefault();
    input.current?.focus();
    const fields = new FormData(event.currentTarget);
    const requestId = String(fields.get('requestId'));
    onSubmit(fields.get('intent') === 'share' ? { intent: 'share', requestId, email: String(fields.get('email')), ...(fields.get('notify') === 'true' ? { notify: true } : {}), ...(fields.get('requireNew') === 'true' ? { requireNew: true } : {}) } : { intent: 'unshare', requestId, shareId: String(fields.get('shareId')) });
  };
  return <div className="share-form" data-share-state={busy ? 'submitting' : outcome ?? 'ready'}>
    {!view.published && <p className="share-notice">Las personas invitadas podrán verlo cuando lo publiques.</p>}
    <form method="post" action={action} noValidate onSubmit={submit}>
      <input type="hidden" name="requestId" value={view.requestIds.share} />
      <input type="hidden" name="intent" value="share" />
      <label htmlFor={id}>Correo electrónico</label>
      <div className="share-add">
        <Input ref={input} id={id} type="email" name="email" defaultValue={command?.intent === 'share' ? command.email : ''} autoComplete="email" readOnly={disabled} aria-invalid={outcome === 'invalid' || undefined} aria-describedby={`${id}-help`} autoFocus={outcome === 'invalid'} />
        <button type="submit" data-variant="primary" disabled={disabled}>Dar acceso</button>
      </div>
      <label><input type="checkbox" name="notify" value="true" defaultChecked={command?.intent === 'share' && command.notify === true} disabled={disabled} /> Avisar por correo</label>
      <p id={`${id}-help`} className={outcome === 'invalid' ? 'field-error' : 'field-help'} role={outcome === 'invalid' ? 'alert' : undefined}>{outcome === 'invalid' ? 'Escribe un correo electrónico válido.' : 'Podrá abrir la publicación después de iniciar sesión con este correo.'}</p>
    </form>
    {submission?.outcome === 'confirmed' && <p role="status">{submission.notice ? shareNotices[submission.notice] : 'Acceso actualizado.'}</p>}
    {submission?.outcome === 'share_limit' && <p role="alert">{submission.scope === 'artifact' ? 'Este artefacto alcanzó el límite de 100 personas con acceso.' : 'Alcanzaste el límite de 1000 accesos compartidos en tu cuenta.'} Quita un acceso antes de añadir otro.</p>}
    {outcome === 'conflict' && <p role="alert">Esta solicitud ya se usó para otro cambio. Revisa el acceso actual antes de intentarlo de nuevo.</p>}
    {uncertain && command && <div className="share-retry">
      <p role="alert">No pudimos confirmar el cambio. Reintenta la misma acción para comprobar el resultado.</p>
      <form method="post" action={action} onSubmit={submit}>
        {Object.entries(command).map(([name, value]) => <input key={name} type="hidden" name={name} value={String(value)} />)}
        <button type="submit" className="secondary" disabled={busy}>Reintentar cambio</button>
      </form>
    </div>}
    <h3>Personas con acceso</h3>
    {view.shares.kind === 'unavailable' ? <div role="status"><p>No pudimos cargar el acceso actual.</p>{onRefresh ? <button type="button" className="secondary" onClick={onRefresh} disabled={busy}>Actualizar acceso</button> : <a className="button secondary" href={action}>Actualizar acceso</a>}</div> : <>
      {view.shares.items.length === 0 && <p className="field-help">Todavía no has dado acceso a otras personas.</p>}
      <ul className="share-list">{view.shares.items.map((share) => <li key={share.shareId} data-share-id={share.shareId}>
        <span>{share.value}</span>
        <form method="post" action={action} onSubmit={submit}>
          <input type="hidden" name="intent" value="unshare" />
          <input type="hidden" name="requestId" value={view.requestIds.unshare[share.shareId]} />
          <input type="hidden" name="shareId" value={share.shareId} />
          <button type="submit" className="secondary" disabled={disabled} aria-label={`Quitar acceso a ${share.value}`}>Quitar</button>
        </form>
      </li>)}</ul>
    </>}
  </div>;
}

export default ShareForm;
