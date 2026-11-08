// The header checkbox selects every row of the page through the same `#selection` form that the cards use.
const all = document.querySelector<HTMLInputElement>('[data-select-all]');
const form = document.querySelector<HTMLFormElement>('#selection');
if (all && form) {
  const rows = () => Array.from(form.elements).filter((control): control is HTMLInputElement => control instanceof HTMLInputElement && control.name === 'artifactId');
  const synchronize = () => {
    const boxes = rows();
    const selected = boxes.filter((box) => box.checked).length;
    all.checked = selected > 0 && selected === boxes.length;
    all.indeterminate = selected > 0 && selected < boxes.length;
  };
  all.hidden = false;
  all.addEventListener('change', () => {
    // Each row's change event resynchronizes the header, so read the requested state once.
    const checked = all.checked;
    for (const box of rows()) {
      if (box.checked === checked) continue;
      box.checked = checked;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
    synchronize();
  });
  for (const box of rows()) box.addEventListener('change', synchronize);
  form.addEventListener('reset', () => window.setTimeout(synchronize, 0));
  window.addEventListener('pageshow', synchronize);
  synchronize();
}
export {};
