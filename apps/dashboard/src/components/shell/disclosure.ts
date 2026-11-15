// An open disclosure closes on Escape or on a click outside it, and opening one closes the others.
const disclosures = [...document.querySelectorAll<HTMLDetailsElement>('details[data-disclosure]')];
const close = (disclosure: HTMLDetailsElement, focus: boolean) => { disclosure.open = false; if (focus) disclosure.querySelector('summary')?.focus(); };
for (const disclosure of disclosures) disclosure.addEventListener('toggle', () => { if (disclosure.open) for (const other of disclosures) if (other !== disclosure) other.open = false; });
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const open = disclosures.find((disclosure) => disclosure.open);
  if (open) close(open, open.contains(document.activeElement));
});
document.addEventListener('click', (event) => {
  for (const disclosure of disclosures) if (disclosure.open && !disclosure.contains(event.target as Node)) close(disclosure, false);
});
export {};
