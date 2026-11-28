// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { trapDialogTabKey } from './dialogFocus';

describe('trapDialogTabKey', () => {
  let dialog: HTMLDivElement;

  afterEach(() => {
    dialog?.remove();
  });

  function setup() {
    dialog = document.createElement('div');
    dialog.tabIndex = -1;
    dialog.innerHTML = '<button id="first">First</button><button id="last">Last</button>';
    document.body.append(dialog);
    return {
      first: dialog.querySelector<HTMLButtonElement>('#first')!,
      last: dialog.querySelector<HTMLButtonElement>('#last')!,
    };
  }

  it('wraps forward from the last control to the first', () => {
    const { first, last } = setup();
    last.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    trapDialogTabKey(event, dialog);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it('wraps backward from the first control to the last', () => {
    const { first, last } = setup();
    first.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    trapDialogTabKey(event, dialog);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('returns escaped focus to the dialog in the matching tab direction', () => {
    const { first, last } = setup();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();

    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    trapDialogTabKey(forward, dialog);
    expect(document.activeElement).toBe(first);

    outside.focus();
    const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    trapDialogTabKey(backward, dialog);
    expect(document.activeElement).toBe(last);
    outside.remove();
  });
});
