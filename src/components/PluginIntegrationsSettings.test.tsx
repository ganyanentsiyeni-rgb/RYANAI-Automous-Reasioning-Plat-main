// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PluginIntegrationsSettings from './PluginIntegrationsSettings';

const auth = vi.hoisted(() => ({ getUser: vi.fn(), updateUser: vi.fn() }));
const api = vi.hoisted(() => ({ authenticatedFetch: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: api.authenticatedFetch }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement; let root: Root;
async function mount(options: { userId?: string; isOwner?: boolean; isAdmin?: boolean; initialPreferences?: unknown } = {}) {
  await act(async () => root.render(<PluginIntegrationsSettings userId={options.userId ?? 'user-a'} {...options} />));
}
async function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function click(element: Element | null) { if (!element) throw new Error('Control not found'); await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }
beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue({ data: { user: { id: 'user-a', user_metadata: {} } }, error: null });
  auth.updateUser.mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null });
  api.authenticatedFetch.mockImplementation(async (url: string) => ({ ok: true, json: async () => url === '/api/plugins/registry' ? { providers: [] } : url === '/api/github/status' ? { status: 'not_connected', connected: false } : { connections: [] } }));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
describe('Plugin integrations centre', () => {
  it('lists integrations across workforce, PA, Comms, knowledge and research categories', async () => {
    await mount();
    expect(container.textContent).toContain('Plugin & integrations centre');
    expect(container.textContent).toContain('GitHub');
    expect(container.textContent).toContain('WhatsApp Business');
    expect(container.textContent).toContain('Google Calendar');
    expect(container.textContent).toContain('Adapter required');
  });
  it('loads GitHub connection state from the verified backend status endpoint', async () => {
    api.authenticatedFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => url === '/api/plugins/registry' ? { providers: [] }
        : url === '/api/github/status' ? { status: 'connected', connected: true, account: { login: 'ryanai-owner' }, repository: { fullName: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main' } }
          : { connections: [] },
    }));
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Connected · repository access verified'));
    expect(container.textContent).toContain('@ryanai-owner');
    expect(container.textContent).toContain('Verified repository: ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main');
    expect(api.authenticatedFetch).toHaveBeenCalledWith('/api/github/status', { headers: { Accept: 'application/json' } }, 'user-a');
  });

  it('starts GitHub OAuth only through the trusted GitHub authorization host', async () => {
    api.authenticatedFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => url === '/api/plugins/registry' ? { providers: [] }
        : url === '/api/github/connect' ? { authorizationUrl: 'https://github.com/login/oauth/authorize?client_id=test' }
          : url === '/api/github/status' ? { status: 'not_connected', connected: false }
            : { connections: [] },
    }));
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    await mount();
    await click([...container.querySelectorAll('button')].find(button => button.textContent === 'Connect GitHub') ?? null);
    expect(api.authenticatedFetch).toHaveBeenCalledWith('/api/github/connect', { method: 'POST', headers: { Accept: 'application/json' } }, 'user-a');
    expect(assign).toHaveBeenCalledWith(expect.stringContaining('https://github.com/login/oauth/authorize'));
  });

  it('renders adapter readiness from the authenticated backend registry', async () => {
    api.authenticatedFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => url === '/api/plugins/registry'
        ? { providers: [
          { id: 'google-calendar', adapterStatus: 'adapter_registered' },
          { id: 'phonelink', adapterStatus: 'adapter_required' },
        ] }
        : { connections: [] },
    }));
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Adapter registered'));
    expect(container.querySelector('[data-plugin-id="google-calendar"]')?.textContent).toContain('OAuth supported');
    expect(container.querySelector('[data-plugin-id="phonelink"]')?.textContent).toContain('Adapter required');
    expect(container.querySelector('[data-plugin-id="browser-automation"]')?.textContent).toContain('Not in backend registry');
    expect(api.authenticatedFetch).toHaveBeenCalledWith('/api/plugins/registry', expect.objectContaining({ headers: { Accept: 'application/json' }, signal: expect.any(AbortSignal) }), 'user-a');
  });

  it('filters providers by search and category', async () => {
    await mount();
    await change(container.querySelector('[aria-label="Search integrations"]') as HTMLInputElement, 'calendar');
    expect(container.textContent).toContain('Google Calendar');
    expect(container.textContent).not.toContain('WhatsApp Business');
  });
  it('clears the previous account preferences and provider status when the signed-in user changes', async () => {
    api.authenticatedFetch.mockImplementation(async (url: string, _options: unknown, requestedUserId: string) => ({
      ok: true,
      json: async () => url === '/api/plugins/registry'
        ? { providers: [] }
        : { connections: requestedUserId === 'user-a' ? [{
          providerId: 'google-calendar', status: 'connected', connectionState: 'connected',
          credentialState: 'access_token_valid_or_expiry_unknown', healthState: 'not_probed', lastHealthCheckAt: null,
        }] : [] },
    }));
    await mount({ initialPreferences: { github: { enabled: true, scopes: ['PA Agent'] } } });
    await vi.waitFor(() => expect(container.textContent).toContain('Connected · provider health not checked'));
    expect((container.querySelector('[aria-label="Request GitHub for eligible workers"]') as HTMLInputElement).checked).toBe(true);
    await mount({ userId: 'user-b', initialPreferences: {} });
    await vi.waitFor(() => expect(container.textContent).toContain('Not connected'));
    expect((container.querySelector('[aria-label="Request GitHub for eligible workers"]') as HTMLInputElement).checked).toBe(false);
    expect(api.authenticatedFetch).toHaveBeenCalledWith('/api/plugins/connections', expect.objectContaining({ headers: { Accept: 'application/json' }, signal: expect.any(AbortSignal) }), 'user-b');
  });

  it('shows stored OAuth authorization separately from provider health', async () => {
    api.authenticatedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ connections: [{
        providerId: 'google-calendar',
        status: 'connected',
        connectionState: 'connected',
        credentialState: 'access_token_valid_or_expiry_unknown',
        healthState: 'not_probed',
        lastHealthCheckAt: null,
      }] }),
    });
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Connected · provider health not checked'));
    expect(container.textContent).toContain('OAuth authorization is stored encrypted server-side');
    expect(api.authenticatedFetch).toHaveBeenCalledWith('/api/plugins/connections', expect.objectContaining({ headers: { Accept: 'application/json' }, signal: expect.any(AbortSignal) }), 'user-a');
    expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Disconnect')).toBe(true);
  });

  it('offers token refresh only when the provider reports an expired access token with refresh available', async () => {
    let connectionReads = 0;
    api.authenticatedFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => url === '/api/plugins/registry' ? { providers: [] }
        : url.endsWith('/refresh') ? { refreshed: true, provider: 'google-calendar' }
          : { connections: [{
            providerId: 'google-calendar', status: 'connected', connectionState: 'connected',
            credentialState: connectionReads++ === 0 ? 'access_expired_refresh_available' : 'access_token_valid_or_expiry_unknown',
            healthState: 'not_probed', lastHealthCheckAt: null,
          }] },
    }));
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Access expired · refresh available'));
    await click([...container.querySelectorAll('button')].find(button => button.textContent === 'Refresh access') ?? null);
    await vi.waitFor(() => expect(container.textContent).toContain('Provider access token refreshed'));
    expect(api.authenticatedFetch).toHaveBeenCalledWith('/api/plugins/google-calendar/refresh', { method: 'POST', headers: { Accept: 'application/json' } }, 'user-a');
  });

  it('offers reauthorization when stored provider credentials require a fresh OAuth grant', async () => {
    api.authenticatedFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => url === '/api/plugins/registry' ? { providers: [] }
        : url.endsWith('/connect') ? { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test' }
          : { connections: [{
            providerId: 'google-calendar', status: 'connected', connectionState: 'connected',
            credentialState: 'reauthorization_required', healthState: 'not_probed', lastHealthCheckAt: null,
          }] },
    }));
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Reauthorization required'));
    await click([...container.querySelectorAll('button')].find(button => button.textContent === 'Reconnect account') ?? null);
    expect(api.authenticatedFetch).toHaveBeenCalledWith('/api/plugins/google-calendar/connect', { method: 'POST', headers: { Accept: 'application/json' } }, 'user-a');
    expect(assign).toHaveBeenCalledWith(expect.stringContaining('https://accounts.google.com/'));
  });

  it('disconnects only the signed-in account provider and refreshes connection state', async () => {
    let connectionReads = 0;
    api.authenticatedFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => url === '/api/plugins/registry' ? { providers: [] }
        : url.endsWith('/disconnect') ? { disconnected: true, remoteRevocation: 'pending' }
          : { connections: connectionReads++ === 0 ? [{
            providerId: 'google-calendar', status: 'connected', connectionState: 'connected',
            credentialState: 'access_token_valid_or_expiry_unknown', healthState: 'not_probed', lastHealthCheckAt: null,
          }] : [] },
    }));
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Connected · provider health not checked'));
    await click([...container.querySelectorAll('button')].find(button => button.textContent === 'Disconnect') ?? null);
    await vi.waitFor(() => expect(container.textContent).toContain('Local credentials removed. Remote provider revocation remains unconfirmed.'));
    expect(api.authenticatedFetch).toHaveBeenCalledWith('/api/plugins/google-calendar/disconnect', { method: 'POST', headers: { Accept: 'application/json' } }, 'user-a');
  });

  it('does not expose owner-only communications integrations to standard users', async () => {
    await mount();
    const toggle = container.querySelector('[aria-label="Request WhatsApp Business for eligible workers"]') as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
  });
  it('hydrates saved provider preferences without claiming a live connection', async () => {
    await mount({ initialPreferences: {
      github: { enabled: true, scopes: ['PA Agent', 'Engineering workers'] },
      'whatsapp-business': { enabled: true, scopes: ['Comms workers'] },
    } });
    const github = container.querySelector('[aria-label="Request GitHub for eligible workers"]') as HTMLInputElement;
    const whatsapp = container.querySelector('[aria-label="Request WhatsApp Business for eligible workers"]') as HTMLInputElement;
    expect(github.checked).toBe(true);
    expect(whatsapp.checked).toBe(false);
    expect(container.textContent).toContain('Adapter required');
    expect(container.textContent).toContain('Saving records user preferences only');
    expect(auth.getUser).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('persists preferences only after verifying the authenticated account', async () => {
    await mount({ isOwner: true });
    const toggle = container.querySelector('[aria-label="Request WhatsApp Business for eligible workers"]') as HTMLInputElement;
    await act(async () => { toggle.click(); });
    await click([...container.querySelectorAll('button')].find(button => button.textContent?.includes('Save plugin preferences')) ?? null);
    expect(auth.getUser).toHaveBeenCalled();
    expect(auth.updateUser).toHaveBeenCalledWith({ data: { ryanai_plugin_preferences: expect.objectContaining({ 'whatsapp-business': expect.objectContaining({ enabled: true }) }) } });
    expect(container.textContent).toContain('No provider has been connected');
  });
  it('rejects a mismatched authenticated account', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'other-user' } }, error: null });
    await mount();
    await click([...container.querySelectorAll('button')].find(button => button.textContent?.includes('Save plugin preferences')) ?? null);
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(container.textContent).toContain('session could not be verified');
  });

  it('shows registry unavailable and clears readiness when the backend request fails', async () => {
    api.authenticatedFetch.mockImplementation(async (url: string) => url === '/api/plugins/registry'
      ? { ok: false, json: async () => ({ error: 'Registry request failed.' }) }
      : { ok: true, json: async () => ({ connections: [] }) });
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Backend registry could not be verified: Registry request failed.'));
    expect(container.querySelector('[data-plugin-id="google-calendar"]')?.textContent).toContain('Registry unavailable');
    expect(container.querySelector('[data-plugin-id="google-calendar"]')?.textContent).not.toContain('Adapter registered');
  });

  it('times out registry requests and reports an unverified state', async () => {
    vi.useFakeTimers();
    api.authenticatedFetch.mockImplementation((url: string, options: { signal?: AbortSignal }) => {
      if (url !== '/api/plugins/registry') return Promise.resolve({ ok: true, json: async () => ({ connections: [] }) });
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });
    await mount();
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(container.textContent).toContain('Backend plugin registry request timed out.');
    expect(container.querySelector('[data-plugin-id="google-calendar"]')?.textContent).toContain('Registry unavailable');
    vi.useRealTimers();
  });

  it('ignores an older account registry response that arrives after the newer account response', async () => {
    let resolveOldRegistry: ((value: { ok: boolean; json: () => Promise<{ providers: { id: string; adapterStatus: 'adapter_registered' }[] }> }) => void) | undefined;
    api.authenticatedFetch.mockImplementation((url: string, _options: unknown, requestedUserId: string) => {
      if (url !== '/api/plugins/registry') return Promise.resolve({ ok: true, json: async () => ({ connections: [] }) });
      if (requestedUserId === 'user-a') {
        return new Promise(resolve => { resolveOldRegistry = resolve; });
      }
      return Promise.resolve({ ok: true, json: async () => ({ providers: [] }) });
    });
    await mount({ userId: 'user-a' });
    await vi.waitFor(() => expect(resolveOldRegistry).toBeTypeOf('function'));
    await mount({ userId: 'user-b' });
    await vi.waitFor(() => expect(container.querySelector('[data-plugin-id="google-calendar"]')?.textContent).toContain('Not in backend registry'));
    await act(async () => {
      resolveOldRegistry?.({ ok: true, json: async () => ({ providers: [{ id: 'google-calendar', adapterStatus: 'adapter_registered' }] }) });
    });
    expect(container.querySelector('[data-plugin-id="google-calendar"]')?.textContent).toContain('Not in backend registry');
    expect(container.querySelector('[data-plugin-id="google-calendar"]')?.textContent).not.toContain('Adapter registered');
  });

  it('loads read-only calendar events on explicit owner action and renders the returned schedule', async () => {
    api.authenticatedFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => url === '/api/plugins/registry' ? { providers: [] }
        : url === '/api/github/status' ? { status: 'not_connected', connected: false }
          : url.includes('/events?') ? { events: [{ id: 'event-1', title: 'RyanAI planning', start: '2026-11-18T10:00:00Z', end: '2026-11-18T10:30:00Z', location: 'Johannesburg', organizer: null }] }
            : { connections: [{ providerId: 'google-calendar', status: 'connected', connectionState: 'connected', credentialState: 'access_token_valid_or_expiry_unknown', healthState: 'not_probed', lastHealthCheckAt: null }] },
    }));
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Connected · provider health not checked'));
    await click([...container.querySelectorAll('button')].find(button => button.textContent === 'Load next 7 days') ?? null);
    await vi.waitFor(() => expect(container.textContent).toContain('RyanAI planning'));
    expect(container.textContent).toContain('Johannesburg');
    expect(container.textContent).toContain('Read-only calendar access');
    const call = api.authenticatedFetch.mock.calls.find((args: unknown[]) => typeof args[0] === 'string' && args[0].includes('/api/plugins/google-calendar/events?'));
    expect(call).toBeTruthy();
    expect(call?.[2]).toBe('user-a');
  });


  it('connects Gmail through Google OAuth and searches read-only mailbox metadata', async () => {
    api.authenticatedFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => url === '/api/plugins/registry' ? { providers: [] }
        : url === '/api/plugins/gmail/connect' ? { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test&scope=gmail.readonly' }
          : url === '/api/plugins/gmail/messages?limit=20' ? { messages: [{
            id: 'message-1', threadId: 'thread-1', subject: 'RyanAI update',
            from: 'owner@example.test', snippet: 'Short preview only', receivedAt: '2026-11-17T10:00:00Z',
          }] }
            : url === '/api/github/status' ? { status: 'not_connected', connected: false }
              : { connections: [{ providerId: 'gmail', status: 'connected', connectionState: 'connected', credentialState: 'access_token_valid_or_expiry_unknown', healthState: 'not_probed', lastHealthCheckAt: null }] },
    }));
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    await mount();
    const gmailCard = container.querySelector('[data-plugin-id="gmail"]') as HTMLElement;
    await vi.waitFor(() => expect(gmailCard.textContent).toContain('Connected · provider health not checked'));
    expect(gmailCard.textContent).toContain('Read-only mailbox API');
    expect(gmailCard.textContent).toContain('Drafting and sending are not enabled');
    await click([...gmailCard.querySelectorAll('button')].find(button => button.textContent === 'Search mailbox') ?? null);
    await vi.waitFor(() => expect(gmailCard.textContent).toContain('RyanAI update'));
    expect(gmailCard.textContent).toContain('Short preview only');
    expect(gmailCard.textContent).toContain('cannot read full message bodies, create drafts or send email');
    expect(api.authenticatedFetch).toHaveBeenCalledWith('/api/plugins/gmail/messages?limit=20', { headers: { Accept: 'application/json' } }, 'user-a');
    expect(assign).not.toHaveBeenCalled();
  });

  it('starts Gmail authorization only through the trusted Google OAuth host', async () => {
    api.authenticatedFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => url === '/api/plugins/registry' ? { providers: [] }
        : url === '/api/plugins/gmail/connect' ? { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test' }
          : url === '/api/github/status' ? { status: 'not_connected', connected: false }
            : { connections: [] },
    }));
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    await mount();
    const gmailCard = container.querySelector('[data-plugin-id="gmail"]') as HTMLElement;
    await vi.waitFor(() => expect(gmailCard.textContent).toContain('Not connected'));
    await click([...gmailCard.querySelectorAll('button')].find(button => button.textContent === 'Connect account') ?? null);
    expect(api.authenticatedFetch).toHaveBeenCalledWith('/api/plugins/gmail/connect', { method: 'POST', headers: { Accept: 'application/json' } }, 'user-a');
    expect(assign).toHaveBeenCalledWith(expect.stringContaining('https://accounts.google.com/'));
  });
});
