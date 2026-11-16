// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MusicPlayer from './MusicPlayer';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ryanai-test-track');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('Dashboard music player', () => {
  it('renders the local player and empty queue', async () => {
    await act(async () => root.render(<MusicPlayer />));
    expect(container.textContent).toContain('Music player');
    expect(container.textContent).toContain('Your music library is empty');
    expect(container.querySelector('input[aria-label="Playlist name"]')).not.toBeNull();
    expect(container.querySelector('select[aria-label="Select playlist"]')).not.toBeNull();
    expect(container.textContent).toContain('Save');
    expect(container.querySelector('audio')).not.toBeNull();
  });

  it('adds browser-supported local audio files to the queue', async () => {
    await act(async () => root.render(<MusicPlayer />));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['audio bytes'], 'track.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(container.textContent).toContain('track.mp3');
    expect(container.textContent).toContain('1 track loaded');
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
  });

  it('shows a clear fallback when browser file sharing is unavailable', async () => {
    await act(async () => root.render(<MusicPlayer />));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['audio bytes'], 'track.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    const share = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Open current track in VLC'));
    if (!share) throw new Error('VLC handoff control was not rendered.');
    await act(async () => share.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.textContent).toContain('cannot share local audio files');
  });
});
