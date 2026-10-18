const preview = document.querySelector<HTMLElement>('.preview-card');
const frame = preview?.querySelector<HTMLIFrameElement>('iframe.preview');
if (preview && frame) {
  preview.querySelector<HTMLElement>('.preview-controls')!.hidden = false;
  const sizes = preview.querySelectorAll<HTMLButtonElement>('button[data-preview-size]');
  for (const button of sizes) button.addEventListener('click', () => {
    preview.dataset.previewSize = button.dataset.previewSize;
    for (const size of sizes) size.setAttribute('aria-pressed', String(size === button));
  });
  preview.querySelector('[data-preview-fullscreen]')!.addEventListener('click', () => {
    void frame.requestFullscreen().catch(() => { preview.querySelector<HTMLElement>('.preview-feedback')!.textContent = 'No se pudo abrir la pantalla completa.'; });
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy-id]')) {
  button.hidden = false;
  button.addEventListener('click', async () => {
    const feedback = button.closest('.facts-card')!.querySelector<HTMLElement>('.copy-feedback')!;
    try {
      await navigator.clipboard.writeText(button.dataset.copyId!);
      feedback.textContent = 'Identificador copiado.';
    } catch { feedback.textContent = 'No se pudo copiar el identificador.'; }
  });
}
