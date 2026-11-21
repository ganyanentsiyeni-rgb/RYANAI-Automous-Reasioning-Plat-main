import { describe, expect, it } from 'vitest';
import { listProviderRegistry, resolveProviderRuntime } from './providerRegistry.js';

describe('API-owned provider registry', () => {
  it('lists native OpenAI, DeepSeek and Anthropic providers separately from OpenRouter', () => {
    const registry = listProviderRegistry({
      OPENAI_API_KEY: 'openai-secret',
      DEEPSEEK_API_KEY: 'deepseek-secret',
      ANTHROPIC_API_KEY: 'anthropic-secret',
      OPENROUTER_API_KEY: 'openrouter-secret',
    });
    expect(registry.map((entry) => entry.providerId)).toEqual([
      'openai', 'deepseek', 'anthropic', 'openrouter', 'nvidia', 'qwen', 'xai', 'ollama',
    ]);
    expect(registry.find((entry) => entry.providerId === 'anthropic')?.adapter).toBe('anthropic-messages');
    expect(registry.find((entry) => entry.providerId === 'openai')?.endpoint).toBe('https://api.openai.com/v1');
    expect(registry.find((entry) => entry.providerId === 'openrouter')?.endpoint).toBe('https://openrouter.ai/api/v1');
  });

  it('never returns provider credential values in registry metadata', () => {
    const registry = listProviderRegistry({
      OPENAI_API_KEY: 'do-not-leak-openai',
      DEEPSEEK_API_KEY: 'do-not-leak-deepseek',
    });
    expect(JSON.stringify(registry)).not.toContain('do-not-leak');
    expect(registry.find((entry) => entry.providerId === 'openai')).toMatchObject({
      configured: true,
      credentialRef: 'OPENAI_API_KEY',
    });
  });

  it('resolves credentials only for the selected provider', () => {
    const runtime = resolveProviderRuntime('deepseek', 'DeepSeek-V4.1-Flash-1017', {
      DEEPSEEK_API_KEY: 'deepseek-only',
      OPENAI_API_KEY: 'openai-only',
    });
    expect(runtime.credential).toBe('deepseek-only');
    expect(runtime.endpoint).toBe('https://api.deepseek.com/v1');
  });

  it('fails closed when a provider credential is missing', () => {
    expect(() => resolveProviderRuntime('anthropic', 'claude-sonnet-4-5', {
      ANTHROPIC_MODEL_ALLOWLIST: 'claude-sonnet-4-5',
    })).toThrow(/unconfigured/);
  });

  it('fails closed for models outside the provider allowlist', () => {
    expect(() => resolveProviderRuntime('openai', 'gpt-unknown', {
      OPENAI_API_KEY: 'openai-only',
    })).toThrow(/not allowlisted/);
  });

  it('preserves unauthenticated local DeepSeek while requiring credentials remotely', () => {
    const local = resolveProviderRuntime('deepseek', 'DeepSeek-V4.1-Flash-1017', {
      DEEPSEEK_API_ENDPOINT: 'http://127.0.0.1:8888/v1',
      DEEPSEEK_MODEL: 'DeepSeek-V4.1-Flash-1017',
    });
    expect(local.credential).toBeNull();
    expect(() => resolveProviderRuntime('deepseek', 'DeepSeek-V4.1-Flash-1017', {
      DEEPSEEK_API_ENDPOINT: 'https://api.deepseek.com/v1',
      DEEPSEEK_MODEL: 'DeepSeek-V4.1-Flash-1017',
    })).toThrow(/unconfigured/);
  });

  it('preserves existing OpenAI base URL and model environment names', () => {
    const runtime = resolveProviderRuntime('openai', 'gpt-4o', {
      OPENAI_API_KEY: 'openai-only',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_MODEL: 'gpt-4o',
    });
    expect(runtime.model).toBe('gpt-4o');
  });

  it('requires an explicit allowlist for native Anthropic models', () => {
    expect(() => resolveProviderRuntime('anthropic', 'claude-sonnet-4-5', {
      ANTHROPIC_API_KEY: 'anthropic-only',
    })).toThrow(/not allowlisted/);
    expect(resolveProviderRuntime('anthropic', 'claude-sonnet-4-5', {
      ANTHROPIC_API_KEY: 'anthropic-only',
      ANTHROPIC_MODEL_ALLOWLIST: 'claude-sonnet-4-5',
    }).adapter).toBe('anthropic-messages');
  });

  it('allows HTTP only for supported loopback providers', () => {
    expect(resolveProviderRuntime('ollama', 'qwen-local', {
      OLLAMA_MODEL_ALLOWLIST: 'qwen-local',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434/v1',
    }).endpoint).toBe('http://127.0.0.1:11434/v1');
    expect(() => resolveProviderRuntime('openai', 'gpt-4o-mini', {
      OPENAI_API_KEY: 'openai-only',
      OPENAI_API_ENDPOINT: 'http://remote.example/v1',
    })).toThrow(/HTTPS/);
  });

  it('rejects embedded credentials, query strings and fragments', () => {
    expect(() => listProviderRegistry({
      OPENAI_API_ENDPOINT: 'https://user:pass@example.com/v1',
    })).toThrow(/HTTPS/);
    expect(() => listProviderRegistry({
      DEEPSEEK_API_ENDPOINT: 'https://api.deepseek.com/v1?token=bad',
    })).toThrow(/HTTPS/);
  });
});
