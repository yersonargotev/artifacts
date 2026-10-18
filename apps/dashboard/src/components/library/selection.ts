const form = document.querySelector<HTMLFormElement>('#selection');
if (form) {
  const count = form.querySelector<HTMLElement>('[data-selection-count]')!;
  const requestId = form.querySelector<HTMLInputElement>('input[name="requestId"]')!;
  const selectedCount = () => new FormData(form).getAll('artifactId').length;
  const synchronize = () => {
    const selected = selectedCount();
    count.textContent = `${selected} seleccionados`;
    form.hidden = selected === 0;
  };
  for (const control of form.elements) {
    if (control instanceof HTMLInputElement && control.name === 'artifactId') control.addEventListener('change', synchronize);
  }
  form.addEventListener('reset', () => window.setTimeout(synchronize, 0));
  form.addEventListener('submit', (event) => {
    if (selectedCount() === 0) {
      event.preventDefault();
      return;
    }
    requestId.value = crypto.randomUUID();
  });
  window.addEventListener('pageshow', synchronize);
  synchronize();
}
