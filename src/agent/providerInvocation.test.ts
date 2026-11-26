import { afterEach, describe, expect, it, vi } from 'vitest';
import { invokeConfiguredProvider } from './providerInvocation.js';

describe('API-owned provider invocation adapter', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('invokes an allowlisted OpenRouter model using only the server-held credential', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'server-only-openrouter-secret');
    vi.stubEnv('OPENROUTER_MODEL_ALLOWLIST', '~openai/gpt-latest');
    let outbound: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | undefined;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      outbound = {
        url: String(url),
        headers: init.headers as Record<string, string>,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      };
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'governed OpenRouter response' } }],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    const result = await invokeConfiguredProvider({
      providerId: 'openrouter',
      model: '~openai/gpt-latest',
      prompt: 'safe test prompt',
    }, AbortSignal.timeout(5_000));

    expect(result).toEqual({
      response: 'governed OpenRouter response',
      usage: { inputTokens: 11, outputTokens: 7 },
    });
    expect(outbound?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(outbound?.headers.authorization).toBe('Bearer server-only-openrouter-secret');
    expect(outbound?.body.model).toBe('~openai/gpt-latest');
    expect(JSON.stringify(result)).not.toContain('server-only-openrouter-secret');
  });

  it('fails closed for missing credentials and unallowlisted models before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(invokeConfiguredProvider({
      providerId: 'openrouter', model: '~openai/gpt-latest', prompt: 'hello',
    }, AbortSignal.timeout(5_000))).rejects.toThrow(/unconfigured/);
    vi.stubEnv('OPENROUTER_API_KEY', 'server-only-openrouter-secret');
    vi.stubEnv('OPENROUTER_MODEL_ALLOWLIST', '~anthropic/claude-sonnet-latest');
    await expect(invokeConfiguredProvider({
      providerId: 'openrouter', model: '~openai/gpt-latest', prompt: 'hello',
    }, AbortSignal.timeout(5_000))).rejects.toThrow(/not allowlisted/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not execute provider tool calls or accept an empty text response', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'server-only-openrouter-secret');
    vi.stubEnv('OPENROUTER_MODEL_ALLOWLIST', '~openai/gpt-latest');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { tool_calls: [{ id: 'ignored-tool-call' }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(invokeConfiguredProvider({
      providerId: 'openrouter', model: '~openai/gpt-latest', prompt: 'hello',
    }, AbortSignal.timeout(5_000))).rejects.toThrow(/provider tool calls are not executed/);
  });
});
