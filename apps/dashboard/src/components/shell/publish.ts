const dialog = document.querySelector<HTMLDialogElement>('dialog[data-publish-dialog]');
dialog?.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

/**
 * Publishing changes what readers see, so the `p` key never posts on its own: it opens the server-rendered confirmation, whose form is the same publish form the page's button submits.
 * Focus starts on Publicar, so a second deliberate key confirms and Escape or Cancelar backs out.
 */
export function confirmPublish(template: HTMLTemplateElement | null | undefined): boolean {
  if (!dialog || !template) return false;
  dialog.replaceChildren(template.content.cloneNode(true));
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('.publish-form button')?.focus();
  return true;
}
