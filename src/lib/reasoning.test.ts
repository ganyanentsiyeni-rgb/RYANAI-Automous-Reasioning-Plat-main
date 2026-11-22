import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { quickReason, streamReasoning } from './reasoning';
import { DEFAULT_MODEL } from './models';

const { authenticatedFetch } = vi.hoisted(() => ({
  authenticatedFetch: vi.fn(),
}));
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch }));
vi.mock('./apiBaseUrl', () => ({ API_BASE_URL: 'https://api.example.test' }));

beforeEach(() => {
  authenticatedFetch.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unauthenticated fetch');
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('authenticated reasoning requests', () => {
  it.each([
    { success: true, output: 'primary', response: 'legacy' },
    { success: true, response: 'legacy' },
  ])(
    'returns a JSON result using the current authenticated transport (%j)',
    async (body) => {
      authenticatedFetch.mockResolvedValue(Response.json(body));
      await expect(quickReason('Explain this', DEFAULT_MODEL)).resolves.toBe(
        body.output || body.response,
      );
      expect(authenticatedFetch).toHaveBeenCalledExactlyOnceWith(
        'https://api.example.test/api/reason',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: 'Explain this',
            model: DEFAULT_MODEL,
            language: 'en-ZA',
          }),
        },
        undefined,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('propagates missing-session failures for JSON requests without falling back to fetch', async () => {
    const error = new Error('Please sign in to continue.');
    authenticatedFetch.mockRejectedValue(error);
    await expect(quickReason('Explain this', DEFAULT_MODEL)).rejects.toBe(
      error,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('streams processing and completion events across chunk and UTF-8 boundaries through authenticated transport', async () => {
    const bytes = new TextEncoder().encode(
      'data: {"status":"processing","message":"Thinking"}\n\n' +
        'data: {"status":"complete","result":"café"}\n\n',
    );
    const unicodeIndex = bytes.indexOf(0xc3);
    authenticatedFetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, 7));
            controller.enqueue(bytes.slice(7, unicodeIndex + 1));
            controller.enqueue(bytes.slice(unicodeIndex + 1));
            controller.close();
          },
        }),
      ),
    );
    const callbacks = {
      onStep: vi.fn(),
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    };
    await streamReasoning('Explain this', DEFAULT_MODEL, callbacks);
    expect(authenticatedFetch).toHaveBeenCalledExactlyOnceWith(
      'https://api.example.test/api/reasoning/stream',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Explain this', model: DEFAULT_MODEL, language: 'en-ZA' }),
      },
      undefined,
    );
    expect(callbacks.onStep).toHaveBeenCalledExactlyOnceWith({
      type: 'reasoning',
      name: 'process',
      result: 'Thinking',
    });
    expect(callbacks.onToken).toHaveBeenCalledExactlyOnceWith('café');
    expect(callbacks.onDone).toHaveBeenCalledOnce();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses an explicitly supplied account language without reading device-global storage', async () => {
    const bytes = new TextEncoder().encode('data: {"status":"complete","result":"Tshivenda"}\n\n');
    authenticatedFetch.mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(bytes); controller.close(); },
    })));
    const callbacks = { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    await streamReasoning('Explain this', DEFAULT_MODEL, callbacks, 've-ZA');
    expect(authenticatedFetch).toHaveBeenCalledWith(
      'https://api.example.test/api/reasoning/stream',
      expect.objectContaining({ body: JSON.stringify({ prompt: 'Explain this', model: DEFAULT_MODEL, language: 've-ZA' }) }),
      undefined,
    );
    expect(callbacks.onToken).toHaveBeenCalledWith('Tshivenda');
  });

  it('forwards normalized non-authoritative preferences on the JSON reasoning path', async () => {
    authenticatedFetch.mockResolvedValue(Response.json({ success: true, output: 'Answer' }));
    await expect(quickReason('Explain this', DEFAULT_MODEL, undefined, undefined, {
      personality: 'warm',
      responseStyle: 'detailed',
      initiative: 'proactive',
      collaboration: 'independent',
      role: 'admin',
      approved: true,
    })).resolves.toBe('Answer');
    const request = authenticatedFetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      prompt: 'Explain this',
      model: DEFAULT_MODEL,
      language: 'en-ZA',
      responsePreferences: {
        personality: 'warm',
        responseStyle: 'detailed',
        initiative: 'proactive',
        collaboration: 'independent',
      },
    });
  });

  it('forwards normalized non-authoritative preferences on the streaming reasoning path', async () => {
    const bytes = new TextEncoder().encode('data: {"status":"complete","result":"Answer"}\\n\\n');
    authenticatedFetch.mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(bytes); controller.close(); },
    })));
    await streamReasoning('Explain this', DEFAULT_MODEL, { onToken: vi.fn() }, undefined, undefined, {
      initiative: 'proactive',
      responseStyle: 'concise',
      personality: 'professional',
      collaboration: 'collaborative',
      permissions: ['deploy'],
    });
    const request = authenticatedFetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body)).responsePreferences).toEqual({
      personality: 'professional',
      responseStyle: 'concise',
      initiative: 'proactive',
      collaboration: 'collaborative',
    });
  });

  it('reports authentication failure to the streaming error callback without completing', async () => {
    authenticatedFetch.mockRejectedValue(
      new Error('Please sign in to continue.'),
    );
    const callbacks = { onError: vi.fn(), onDone: vi.fn(), onToken: vi.fn() };
    await streamReasoning('Explain this', DEFAULT_MODEL, callbacks);
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith(
      'Please sign in to continue.',
    );
    expect(callbacks.onDone).not.toHaveBeenCalled();
    expect(callbacks.onToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
