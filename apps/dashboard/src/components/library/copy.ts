if (typeof navigator.clipboard?.writeText === 'function') {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy-command]')) {
    const feedback = document.getElementById(button.getAttribute('aria-describedby')!)!;
    button.hidden = false;
    button.addEventListener('click', async () => {
      feedback.textContent = '';
      button.disabled = true;
      let message: string;
      try {
        await navigator.clipboard.writeText(button.dataset.copyCommand!);
        message = 'Comando copiado.';
      } catch {
        message = 'No se pudo copiar. Selecciona el comando y cópialo manualmente.';
      }
      window.setTimeout(() => {
        feedback.textContent = message;
        button.disabled = false;
      }, 100);
    });
  }
}
