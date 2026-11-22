// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileSettings from './ProfileSettings';

const auth = vi.hoisted(() => ({
  updateUser: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
}));
const supabaseMock = vi.hoisted(() => ({
  auth,
  from: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

async function mount(options: { isOwner?: boolean; isAdmin?: boolean; userId?: string; initialVoiceEnabled?: boolean; useStoredVoicePreference?: boolean } = {}) {
  await act(async () => root.render(
    <ProfileSettings
      key={options.userId ?? 'user-a'}
      userId={options.userId ?? 'user-a'}
      email="person@example.test"
      initialDisplayName="Alex Morgan"
      initialLanguage="ve-ZA"
      initialVoiceEnabled={options.useStoredVoicePreference ? undefined : options.initialVoiceEnabled ?? false}
      initialDashboardUiPreferences={{}}
      isOwner={options.isOwner}
      isAdmin={options.isAdmin}
    />,
  ));
}

async function changeValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function click(element: Element | null) {
  if (!element) throw new Error('Expected control was not found.');
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function buttonContaining(label: string) {
  return [...container.querySelectorAll('button')].find(button => button.textContent?.includes(label)) ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue({ data: { user: { id: 'user-a', user_metadata: {} } }, error: null });
  auth.updateUser.mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null });
  auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null });
  auth.signOut.mockResolvedValue({ error: null });
  supabaseMock.from.mockReturnValue({
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }),
  });
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('RyanAI Settings', () => {
  it('renders profile, dashboard, module and account security controls', async () => {
    await mount();
    expect(container.textContent).toContain('Profile management & access control');
    expect(container.textContent).toContain('Account security');
    expect(container.textContent).toContain('Provider and integration security');
    expect(container.querySelector('[data-testid="programming-enabled-toggle"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="voice-enabled-toggle"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="audiobook-default-voice"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="inference-default-model"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="ui-toggle-music"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="ui-toggle-phonelink"]')).not.toBeNull();
    expect(container.querySelector('#phonelink-settings-title')).not.toBeNull();
    expect(container.querySelector('#copilot-settings-title')).not.toBeNull();
    expect(container.querySelector('[data-testid="copilot-show-alex-status"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="copilot-show-delegation-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="copilot-refresh-interval"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="music-default-provider"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="vlc-playback-mode"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="music-volume"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="music-auto-save-library"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="music-auto-save-playlists"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="music-restore-playlist"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="copilot-personality"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="copilot-response-style"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="copilot-initiative"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="copilot-collaboration"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="copilot-account-memory"]')).not.toBeNull();
  });

  it('keeps voice-enabled fallback preferences scoped to the signed-in account', async () => {
    window.localStorage.setItem('ryanai:voice-enabled', 'false');
    window.localStorage.setItem('ryanai:voice-enabled:user-a', 'false');
    await mount({ userId: 'user-b', useStoredVoicePreference: true });
    expect((container.querySelector('[data-testid="voice-enabled-toggle"]') as HTMLInputElement).checked).toBe(true);
    await mount({ userId: 'user-a', useStoredVoicePreference: true });
    expect((container.querySelector('[data-testid="voice-enabled-toggle"]') as HTMLInputElement).checked).toBe(false);
  });

  it('does not expose privileged workspace toggles to standard users', async () => {
    await mount();
    expect((container.querySelector('[data-testid="ui-toggle-admin"]') as HTMLInputElement).disabled).toBe(true);
    expect((container.querySelector('[data-testid="ui-toggle-studio"]') as HTMLInputElement).disabled).toBe(false);
    expect((container.querySelector('[data-testid="ui-toggle-comms"]') as HTMLInputElement).disabled).toBe(true);
  });

  it('exposes only the privileged workspaces allowed by the trusted role', async () => {
    await mount({ isAdmin: true });
    expect(container.querySelector('[data-testid="ui-toggle-admin"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="ui-toggle-studio"]')).not.toBeNull();
    expect((container.querySelector('[data-testid="ui-toggle-comms"]') as HTMLInputElement).disabled).toBe(true);
  });

  it('allows the verified owner to access administrator workspace preferences', async () => {
    await mount({ isOwner: true });
    expect((container.querySelector('[data-testid="ui-toggle-admin"]') as HTMLInputElement).disabled).toBe(false);
    expect((container.querySelector('[data-testid="ui-toggle-comms"]') as HTMLInputElement).disabled).toBe(false);
  });

  it('persists profile and module preferences only after verifying the account', async () => {
    await mount();
    await changeValue(container.querySelector('input[autocomplete="name"]') as HTMLInputElement, 'Ntsiyeni Ganyane');
    await act(async () => {
      (container.querySelector('[data-testid="voice-enabled-toggle"]') as HTMLInputElement).click();
      (container.querySelector('[data-testid="programming-enabled-toggle"]') as HTMLInputElement).click();
      (container.querySelector('[data-testid="copilot-show-alex-status"]') as HTMLInputElement).click();
    });
    await changeValue(container.querySelector('[data-testid="copilot-refresh-interval"]') as HTMLSelectElement, '60');
    await click(buttonContaining('Save all Settings'));
    await vi.waitFor(() => expect(auth.updateUser).toHaveBeenCalled());
    expect(auth.getUser).toHaveBeenCalled();
    const payload = auth.updateUser.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(payload.data).toMatchObject({
      full_name: 'Ntsiyeni Ganyane',
      ryanai_language: 've-ZA',
      ryanai_copilot_settings: { personality: 'balanced', responseStyle: 'balanced', initiative: 'ask-first', collaboration: 'collaborative', useAccountMemory: true, showAlexStatus: false, showDelegationPanel: true, refreshIntervalSeconds: 60 },
      ryanai_voice_enabled: true,
      ryanai_dashboard_ui_preferences: { programming: false, music: true },
      ryanai_audiobook_settings: { defaultVoice: 'coral', narrationSpeed: 1 },
      
      ryanai_phonelink_settings: { autoReconnect: true, wifiOnlyTransfers: true, notifyComms: true, notifyTasks: true, allowShareIntake: true, requireConfirmation: true, quietHoursEnabled: false, quietHoursStart: '22:00', quietHoursEnd: '07:00' },
    });
    expect(window.localStorage.getItem('ryanai:language:user-a')).toBe('ve-ZA');
    expect(container.textContent).toContain('RyanAI Settings were saved');
  });

  it('persists normalized Copilot preferences only after account verification', async () => {
    await mount();
    await changeValue(container.querySelector('[data-testid="copilot-personality"]') as HTMLSelectElement, 'warm');
    await changeValue(container.querySelector('[data-testid="copilot-response-style"]') as HTMLSelectElement, 'detailed');
    await changeValue(container.querySelector('[data-testid="copilot-initiative"]') as HTMLSelectElement, 'suggest');
    await changeValue(container.querySelector('[data-testid="copilot-collaboration"]') as HTMLSelectElement, 'independent');
    await act(async () => (container.querySelector('[data-testid="copilot-account-memory"]') as HTMLInputElement).click());
    await click(buttonContaining('Save all Settings'));
    await vi.waitFor(() => expect(auth.updateUser).toHaveBeenCalled());
    const payload = auth.updateUser.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(payload.data.ryanai_copilot_settings).toEqual({
      showAlexStatus: true,
      showDelegationPanel: true,
      refreshIntervalSeconds: 30,
      personality: 'warm',
      responseStyle: 'detailed',
      initiative: 'suggest',
      collaboration: 'independent',
      useAccountMemory: false,
    });
  });

  it('persists music provider and VLC preferences in the authenticated account metadata', async () => {
    await mount();
    await changeValue(container.querySelector('[data-testid="music-default-provider"]') as HTMLSelectElement, 'spotify');
    await changeValue(container.querySelector('[data-testid="vlc-playback-mode"]') as HTMLSelectElement, 'both');
    await click(buttonContaining('Save all Settings'));
    await vi.waitFor(() => expect(auth.updateUser).toHaveBeenCalled());
    const payload = auth.updateUser.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(payload.data.ryanai_music_settings).toMatchObject({ defaultProvider: 'spotify', vlcMode: 'both', volume: 70, rememberPreferredProvider: true, resumePlayback: true, autoSaveLibrary: true, autoSavePlaylists: true, restoreLastPlaylist: true });
  });

  it('requests email changes through Supabase Auth', async () => {
    await mount();
    await changeValue(container.querySelector('input[type="email"]') as HTMLInputElement, 'new@example.test');
    await click(buttonContaining('Request email change'));
    await vi.waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ email: 'new@example.test' }));
    expect(container.textContent).toContain('Complete the verification steps');
  });

  it('reauthenticates before updating a password', async () => {
    await mount();
    const passwords = [...container.querySelectorAll('input[type="password"]')] as HTMLInputElement[];
    await changeValue(passwords[0], 'current-password-value');
    await changeValue(passwords[1], 'new-password-value-123');
    await changeValue(passwords[2], 'new-password-value-123');
    await click(buttonContaining('Update password'));
    await vi.waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'person@example.test',
      password: 'current-password-value',
    }));
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-password-value-123' });
    expect(container.textContent).toContain('Password update confirmed');
  });

  it('invalidates other refresh-token sessions without signing out this device', async () => {
    await mount();
    await click(buttonContaining('Sign out other devices'));
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
    await vi.waitFor(() => expect(container.textContent).toContain('This device remains signed in'));
  });
});
