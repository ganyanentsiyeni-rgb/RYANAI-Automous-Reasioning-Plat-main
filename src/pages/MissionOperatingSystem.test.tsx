// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import MissionOperatingSystem from './MissionOperatingSystem';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('Mission Operating System accessibility', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('exposes a complete keyboard-navigable tablist with labelled panels', async () => {
    await act(async () => root.render(<MissionOperatingSystem />));

    const tabs = [...container.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
    expect(tabs).toHaveLength(4);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].getAttribute('aria-controls')).toBe('mission-panel-overview');
    expect(container.querySelector('#mission-panel-overview')?.getAttribute('aria-labelledby')).toBe('mission-tab-overview');

    await act(async () => {
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });

    expect(container.querySelector('#mission-tab-architecture')?.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('#mission-panel-architecture')).toBeTruthy();
    expect(container.querySelector('#mission-tab-overview')?.getAttribute('tabindex')).toBe('-1');
    const selectedPlane = container.querySelector('button[aria-label="Open Experience architecture plane"]');
    expect(selectedPlane?.getAttribute('aria-pressed')).toBe('true');
  });

  it('supports Home and End navigation without changing the selected panel incorrectly', async () => {
    await act(async () => root.render(<MissionOperatingSystem />));

    const firstTab = container.querySelector('#mission-tab-overview') as HTMLButtonElement;
    const lastTab = container.querySelector('#mission-tab-governance') as HTMLButtonElement;

    await act(async () => {
      lastTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    expect(firstTab.getAttribute('aria-selected')).toBe('true');

    await act(async () => {
      firstTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(lastTab.getAttribute('aria-selected')).toBe('true');
  });
});
