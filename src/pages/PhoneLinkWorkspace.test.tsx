// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { DEFAULT_PHONELINK_SETTINGS } from '@/lib/settingsPreferences';
import PhoneLinkWorkspace from './PhoneLinkWorkspace';

vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: vi.fn() }));
vi.mock('@/lib/phoneLinkQr', () => ({ createPhoneLinkQr: () => [] }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const apiFetch = vi.mocked(authenticatedFetch);
let container: HTMLDivElement;
let root: Root;

function response(payload: unknown, ok = true) {
  return { ok, json: async () => payload } as Response;
}

async function mount(userId = 'phone-owner-a') {
  await act(async () => root.render(<PhoneLinkWorkspace userId={userId} settings={DEFAULT_PHONELINK_SETTINGS} />));
}

async function click(element: Element | null) {
  if (!element) throw new Error('Expected control was not found.');
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = '#/phonelink';
  apiFetch.mockImplementation(async (input, init) => {
    const path = String(input);
    if (path === '/api/phonelink/devices') return response({ devices: [] });
    if (path === '/api/phonelink/capabilities') return response({ capabilities: [] });
    if (path === '/api/phonelink/events') return response({ events: [] });
    if (path === '/api/phonelink/pairings' && init?.method === 'POST') {
      return response({ pairingCode: 'PAIR-TEST-123', expiresAt: '2026-11-08T16:05:00.000Z' });
    }
    throw new Error('Unexpected PhoneLink request: ' + path);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('PhoneLink account-scoped requests', () => {
  it('loads device, capability and inbox data using the signed-in account identity', async () => {
    await mount('phone-owner-a');
    await vi.waitFor(() => expect(container.textContent).toContain('No phones connected yet.'));
    expect(apiFetch).toHaveBeenCalledWith('/api/phonelink/devices', undefined, 'phone-owner-a');
    expect(apiFetch).toHaveBeenCalledWith('/api/phonelink/capabilities', undefined, 'phone-owner-a');
    expect(apiFetch).toHaveBeenCalledWith('/api/phonelink/events', undefined, 'phone-owner-a');
  });

  it('offers only backend-verified capabilities during device pairing', async () => {
    apiFetch.mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === '/api/phonelink/devices') return response({ devices: [] });
      if (path === '/api/phonelink/events') return response({ events: [] });
      if (path === '/api/phonelink/capabilities') return response({ capabilities: [
        { id: 'files.receive', label: 'Send files to RyanAI', state: 'storage_adapter_required', approval: 'per upload' },
        { id: 'voice.live', label: 'Live RyanAI voice session', state: 'available', approval: 'explicit start/stop per session' },
      ] });
      if (path === '/api/phonelink/pairings/claim' && init?.method === 'POST') return response({ exchangeCode: 'EXCHANGE-123' });
      throw new Error('Unexpected PhoneLink request: ' + path);
    });

    window.location.hash = '#/phonelink/pair?code=PAIR-TEST-123';
    await mount('phone-owner-a');
    await vi.waitFor(() => expect(container.textContent).toContain('storage adapter required'));

    const unavailable = container.querySelector('[aria-label="Allow Send files to RyanAI"]') as HTMLInputElement;
    const available = container.querySelector('[aria-label="Allow Live RyanAI voice (foreground service)"]') as HTMLInputElement;
    expect(unavailable.disabled).toBe(true);
    expect(unavailable.checked).toBe(false);
    expect(available.disabled).toBe(false);
    expect(available.checked).toBe(false);

    await click(available);
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    await act(async () => form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/api/phonelink/pairings/claim',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('"capabilities":["voice.live"]') }),
      'phone-owner-a',
    ));
  });

  it('scopes pairing-code creation to the same signed-in account', async () => {
    await mount('phone-owner-a');
    await vi.waitFor(() => expect(container.textContent).toContain('No phones connected yet.'));
    await click([...container.querySelectorAll('button')].find(button => button.textContent?.includes('Generate pairing QR')) ?? null);
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/api/phonelink/pairings',
      expect.objectContaining({ method: 'POST' }),
      'phone-owner-a',
    ));
    expect(container.textContent).toContain('PAIR-TEST-123');
  });
});
