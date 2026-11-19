// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommunitySurveyPage from './CommunitySurvey';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

async function setValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('Community survey', () => {
  it('submits anonymous answers and displays the owner notification state', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, notificationStatus: 'accepted' }),
    });

    await act(async () => root.render(<CommunitySurveyPage />));

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    expect(container.textContent).toContain('Anonymous by default');
    expect(container.textContent).toContain('A private notification may be sent to the RyanAI survey owner');
    expect(container.textContent).not.toContain('Submitting this survey does not send messages.');
    expect(container.querySelector('input[type="email"]')).toBeNull();

    for (const select of form!.querySelectorAll('select')) {
      await setValue(select, select.options[1]?.value ?? 'Other');
    }
    const consent = form!.querySelector('input[type="checkbox"][required]') as HTMLInputElement;
    await act(async () => { consent.click(); });
    const priority = form!.querySelector('textarea[required]');
    expect(priority).not.toBeNull();
    await setValue(priority!, 'Reliable and private AI workflows.');

    await act(async () => {
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/community-feedback');
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(requestInit).toBeDefined();
    const payload = JSON.parse(String(requestInit?.body));
    expect(payload).toHaveProperty('role');
    expect(payload).not.toHaveProperty('contactName');
    expect(payload).not.toHaveProperty('contactEmail');
    expect(payload).not.toHaveProperty('followUpConsent');
    expect(container.textContent).toContain('The email provider accepted the owner notification');
    expect(container.textContent).toContain('Interested in RyanAI Beta testing?');
  });

  it('does not claim that provider acceptance proves final mailbox delivery', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, notificationStatus: 'accepted' }),
    });
    await act(async () => root.render(<CommunitySurveyPage />));
    const form = container.querySelector('form')!;
    for (const select of form.querySelectorAll('select')) {
      await setValue(select, select.options[1]?.value ?? 'Other');
    }
    await setValue(form.querySelector('textarea[required]')!, 'A useful test response.');
    const consent = form.querySelector('input[type="checkbox"][required]') as HTMLInputElement;
    await act(async () => { consent.click(); });
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(container.textContent).toContain('final mailbox delivery is not confirmed');
  });
});
