// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import MusicWorkspace from './MusicWorkspace';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
describe('RyanAI Music workspace', () => {
  it('provides a dedicated library, playlists and VLC handoff workspace', async () => {
    await act(async () => root.render(<MusicWorkspace />));
    expect(container.textContent).toContain('RyanAI Music');
    expect(container.textContent).toContain('Your personal music workspace');
    expect(container.textContent).toContain('Saved playlists');
    expect(container.textContent).toContain('VLC handoff');
    expect(container.querySelector('a[href="#/dashboard"]')).not.toBeNull();
    expect(container.querySelector('audio')).not.toBeNull();
  });
});
