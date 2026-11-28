const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keep keyboard Tab navigation inside an app-owned modal drawer. */
export function trapDialogTabKey(event: KeyboardEvent, dialog: HTMLElement): void {
  if (event.key !== 'Tab') return;

  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) =>
    element.getAttribute('aria-hidden') !== 'true' &&
    !element.hasAttribute('hidden') &&
    !element.matches(':disabled'),
  );

  if (focusable.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  const focusIsOutside = !(active instanceof Node) || !dialog.contains(active);

  if (event.shiftKey && (active === first || focusIsOutside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || focusIsOutside)) {
    event.preventDefault();
    first.focus();
  }
}
