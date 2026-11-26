// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import AdminSettingsHub from './AdminSettingsHub';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

describe('AdminSettingsHub directory', () => {
  it('lists all twelve workspace and control destinations', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<AdminSettingsHub />));
    expect(container.querySelectorAll('[data-testid="workspace-area-link"]')).toHaveLength(12);
    expect(container.textContent).toContain('12 product areas');
    expect(container.textContent).toContain('Settings & workspace control');
  });
});
