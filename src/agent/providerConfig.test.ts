import { describe, expect, it } from 'vitest';
import { resolveBrainApiKey, resolveBrainProviderConfig } from './providerConfig.js';
import { resolveProviderProbeConfig } from './providerProbeConfig.js';

describe('independent brain provider credentials', () => {
  it('does not report cloud providers as configured without their own credentials', () => {
    const env = {
      NVIDIA_API_KEY: undefined,
      QWEN_API_KEY: undefined,
      LOGIC_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
    };

    expect(resolveBrainProviderConfig('primary', env).credential).toBe(false);
    expect(resolveBrainProviderConfig('secondary', env).credential).toBe(false);
    expect(resolveBrainProviderConfig('logic', env).credential).toBe(false);
  });

  it('does not reuse a local runtime credential for explicitly configured cloud endpoints', () => {
    const env = {
      LM_STUDIO_URL: 'http://localhost:1234/v1',
      LM_STUDIO_API_KEY: 'local-test-token',
      NVIDIA_API_ENDPOINT: 'https://integrate.api.nvidia.com/v1',
      QWEN_API_ENDPOINT: 'https://api.together.xyz/v1',
      LOGIC_API_ENDPOINT: 'https://api.openai.com/v1',
    };

    expect(resolveBrainProviderConfig('primary', env)).toMatchObject({
      endpoint: 'https://integrate.api.nvidia.com/v1',
      credential: false,
    });
    expect(resolveBrainProviderConfig('secondary', env)).toMatchObject({
      endpoint: 'https://api.together.xyz/v1',
      credential: false,
    });
    expect(resolveBrainProviderConfig('logic', env)).toMatchObject({
      endpoint: 'https://api.openai.com/v1',
      credential: false,
    });
  });

  it('uses TOGETHER_API_ENDPOINT when the canonical Qwen endpoint is not set', () => {
    const env = {
      TOGETHER_API_ENDPOINT: 'https://api.together.xyz/v1',
      TOGETHER_API_KEY: 'together-endpoint-key',
    };
    const config = resolveBrainProviderConfig('secondary', env);
    expect(config.endpoint).toBe('https://api.together.xyz/v1');
    expect(config.credential).toBe(true);
    expect(resolveBrainApiKey('secondary', config, env)).toBe('together-endpoint-key');
  });

  it('uses endpoint-matched default model identifiers for supported Qwen hosts', () => {
    expect(resolveBrainProviderConfig('secondary', {}).model).toBe('Qwen/Qwen3-235B-A22B-Instruct-2507-tput');
    expect(resolveBrainProviderConfig('secondary', {
      QWEN_API_ENDPOINT: 'https://openrouter.ai/api/v1',
    }).model).toBe('qwen/qwen3-235b-a22b-2507');
    expect(resolveBrainProviderConfig('secondary', {
      QWEN_API_ENDPOINT: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    }).model).toBe('qwen3-235b-a22b-instruct-2507');
    expect(resolveBrainProviderConfig('secondary', {
      QWEN_API_ENDPOINT: 'https://api.siliconflow.com/v1',
    }).model).toBe('Qwen/Qwen3-235B-A22B-Instruct-2507');
  });

  it('uses the provider-specific key for the configured Qwen endpoint', () => {
    const cases = [
      ['https://api.together.xyz/v1', 'TOGETHER_API_KEY', 'together-test'],
      ['https://openrouter.ai/api/v1', 'OPENROUTER_API_KEY', 'openrouter-test'],
      ['https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'DASHSCOPE_API_KEY', 'dashscope-test'],
      ['https://api.siliconflow.com/v1', 'SILICONFLOW_API_KEY', 'siliconflow-test'],
    ] as const;

    for (const [endpoint, keyName, keyValue] of cases) {
      const env = {
        QWEN_API_ENDPOINT: endpoint,
        QWEN_API_KEY: 'generic-qwen-fallback',
        [keyName]: keyValue,
      };
      const config = resolveBrainProviderConfig('secondary', env);
      expect(resolveBrainApiKey('secondary', config, env)).toBe(keyValue);
      expect(config.credential).toBe(true);
    }
  });

  it('uses QWEN_API_KEY as a compatibility fallback for a custom endpoint', () => {
    const env = {
      QWEN_API_ENDPOINT: 'https://inference.example.test/v1',
      QWEN_API_KEY: 'custom-qwen-key',
    };
    const config = resolveBrainProviderConfig('secondary', env);
    expect(resolveBrainApiKey('secondary', config, env)).toBe('custom-qwen-key');
  });

  it('never uses the OpenAI key for Qwen', () => {
    const env = {
      QWEN_API_ENDPOINT: 'https://api.together.xyz/v1',
      OPENAI_API_KEY: 'openai-only',
    };
    const config = resolveBrainProviderConfig('secondary', env);
    expect(config.credential).toBe(false);
    expect(resolveBrainApiKey('secondary', config, env)).toBe('');
  });

  it('honours QWEN_MODEL and SECONDARY_REASONING_MODEL overrides', () => {
    expect(resolveBrainProviderConfig('secondary', {
      QWEN_API_ENDPOINT: 'https://openrouter.ai/api/v1',
      QWEN_MODEL: 'custom/qwen-model',
    }).model).toBe('custom/qwen-model');
    expect(resolveBrainProviderConfig('secondary', {
      QWEN_API_ENDPOINT: 'https://openrouter.ai/api/v1',
      QWEN_MODEL: 'qwen-model',
      SECONDARY_REASONING_MODEL: 'secondary-override',
    }).model).toBe('secondary-override');
  });

  it('accepts each cloud provider credential independently', () => {
    expect(resolveBrainProviderConfig('primary', { NVIDIA_API_KEY: 'nvidia-test' }).credential).toBe(true);
    expect(resolveBrainProviderConfig('secondary', { QWEN_API_KEY: 'qwen-test' }).credential).toBe(true);
    expect(resolveBrainProviderConfig('logic', { LOGIC_API_KEY: 'logic-test' }).credential).toBe(true);
  });

  it('keeps Logic key precedence explicit: LOGIC_API_KEY wins over OPENAI_API_KEY', () => {
    const env = {
      LOGIC_API_ENDPOINT: 'https://api.openai.com/v1',
      LOGIC_API_KEY: 'logic-key-selected',
      OPENAI_API_KEY: 'openai-fallback',
    };
    const config = resolveBrainProviderConfig('logic', env);
    expect(resolveBrainApiKey('logic', config, env)).toBe('logic-key-selected');
  });

  it('supports the documented OpenAI compatibility key fallback for Logic', () => {
    const env = { OPENAI_API_KEY: 'openai-test' };
    const config = resolveBrainProviderConfig('logic', env);
    expect(config.credential).toBe(true);
    expect(resolveBrainApiKey('logic', config, env)).toBe('openai-test');
  });

  it('allows a shared local credential only when the brain actually targets the local runtime', () => {
    const env = {
      LM_STUDIO_URL: 'http://localhost:1234/v1',
      LM_STUDIO_API_KEY: 'local-test-token',
    };

    for (const brain of ['primary', 'secondary', 'logic'] as const) {
      expect(resolveBrainProviderConfig(brain, env)).toMatchObject({
        endpoint: 'http://localhost:1234/v1',
        credential: true,
      });
    }
  });
});

describe('isolated provider probe credential resolution', () => {
  it.each([
    ['primary', 'nvidia-test-key', { NVIDIA_API_KEY: 'nvidia-test-key' }],
    ['secondary', 'together-test-key', {
      QWEN_API_ENDPOINT: 'https://api.together.xyz/v1',
      TOGETHER_API_KEY: 'together-test-key',
    }],
    ['secondary', 'openrouter-test-key', {
      QWEN_API_ENDPOINT: 'https://openrouter.ai/api/v1',
      OPENROUTER_API_KEY: 'openrouter-test-key',
    }],
    ['secondary', 'dashscope-test-key', {
      QWEN_API_ENDPOINT: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      DASHSCOPE_API_KEY: 'dashscope-test-key',
    }],
    ['secondary', 'siliconflow-test-key', {
      QWEN_API_ENDPOINT: 'https://api.siliconflow.com/v1',
      SILICONFLOW_API_KEY: 'siliconflow-test-key',
    }],
    ['logic', 'logic-test-key', { LOGIC_API_KEY: 'logic-test-key' }],
  ] as const)('maps the runtime credential for %s probes', (brain, expectedKey, env) => {
    const config = resolveProviderProbeConfig(brain, env);
    expect(config.apiKey).toBe(expectedKey);
    expect(config.endpoint).toMatch(/^https:\/\//);
    expect(config.model).toBeTruthy();
  });

  it('uses the exact endpoint-selected Qwen credential used by runtime, ignoring probe-only overrides', () => {
    const env = {
      PROVIDER_API_KEY: 'probe-only-key',
      QWEN_API_ENDPOINT: 'https://api.together.xyz/v1',
      TOGETHER_API_KEY: 'runtime-together-key',
      QWEN_API_KEY: 'legacy-qwen-key',
    };
    const runtime = resolveBrainProviderConfig('secondary', env);
    const probe = resolveProviderProbeConfig('secondary', env);

    expect(probe).toEqual({
      apiKey: resolveBrainApiKey('secondary', runtime, env),
      endpoint: runtime.endpoint,
      model: runtime.model,
    });
    expect(probe.apiKey).toBe('runtime-together-key');
  });

  it('uses the same Logic credential precedence for live execution and verification', () => {
    const env = {
      PROVIDER_API_KEY: 'probe-only-key',
      LOGIC_API_KEY: 'runtime-logic-key',
      OPENAI_API_KEY: 'openai-fallback-key',
    };
    const runtime = resolveBrainProviderConfig('logic', env);
    const probe = resolveProviderProbeConfig('logic', env);

    expect(probe).toEqual({
      apiKey: resolveBrainApiKey('logic', runtime, env),
      endpoint: runtime.endpoint,
      model: runtime.model,
    });
    expect(probe.apiKey).toBe('runtime-logic-key');
  });

  it('does not reuse a different cloud provider credential', () => {
    expect(resolveProviderProbeConfig('primary', { QWEN_API_KEY: 'qwen-only' }).apiKey).toBe('');
    expect(resolveProviderProbeConfig('secondary', { NVIDIA_API_KEY: 'nvidia-only' }).apiKey).toBe('');
  });

  it('maps the selected Grok provider credential and endpoint for Logic probes', () => {
    const config = resolveProviderProbeConfig('logic', {
      LOGIC_REASONING_PROVIDER: 'grok',
      GROK_API_KEY: 'grok-test-key',
      GROK_API_ENDPOINT: 'https://api.x.ai/v1',
      GROK_MODEL: 'grok-test-model',
    });
    expect(config).toEqual({ apiKey: 'grok-test-key', endpoint: 'https://api.x.ai/v1', model: 'grok-test-model' });
  });

  it('does not fall back to OpenAI when Grok is explicitly selected but unconfigured', () => {
    const config = resolveProviderProbeConfig('logic', {
      LOGIC_REASONING_PROVIDER: 'grok', OPENAI_API_KEY: 'openai-only',
    });
    expect(config.apiKey).toBe('');
    expect(config.endpoint).toBe('https://api.x.ai/v1');
    expect(config.model).toBe('');
  });

  it('supports the documented OpenAI key fallback for the Logic brain', () => {
    expect(resolveProviderProbeConfig('logic', { OPENAI_API_KEY: 'openai-test' }).apiKey).toBe('openai-test');
  });
});

describe('canonical API brain roles and explicit Ollama adapter', () => {
  it('maps primary, secondary and logic to canonical reasoning roles', () => {
    expect(resolveBrainProviderConfig('primary', {}).role).toBe('nvidia');
    expect(resolveBrainProviderConfig('secondary', {}).role).toBe('qwen');
    expect(resolveBrainProviderConfig('logic', {}).role).toBe('logic');
  });

  it('selects Ollama only when explicitly requested and never silently falls back to cloud', () => {
    expect(resolveBrainProviderConfig('primary', {
      PRIMARY_REASONING_PROVIDER: 'ollama',
      OLLAMA_MODEL: 'qwen2.5:7b',
    })).toMatchObject({
      role: 'nvidia', adapter: 'ollama', model: 'qwen2.5:7b',
      endpoint: 'http://127.0.0.1:11434/v1', credential: false,
    });
  });

  it('requires a model identifier when Ollama is selected', () => {
    expect(resolveBrainProviderConfig('primary', { NVIDIA_PROVIDER: 'ollama' }).model).toBe('');
  });

  it('rejects unknown provider selectors instead of silently routing elsewhere', () => {
    expect(() => resolveBrainProviderConfig('primary', { PRIMARY_REASONING_PROVIDER: 'deepseek' })).toThrow(/Unsupported provider selection/);
  });

  it('rejects insecure remote endpoints and embedded credentials', () => {
    expect(() => resolveBrainProviderConfig('primary', { NVIDIA_API_ENDPOINT: 'http://models.example.test/v1' })).toThrow(/must use HTTPS/);
    expect(() => resolveBrainProviderConfig('secondary', { QWEN_API_ENDPOINT: 'https://user:pass@models.example.test/v1' })).toThrow(/must use HTTPS/);
  });

  it('keeps Ollama as an adapter, not a replacement reasoning role', () => {
    expect(resolveBrainProviderConfig('secondary', {
      QWEN_PROVIDER: 'ollama', OLLAMA_URL: 'http://127.0.0.1:11434/v1', OLLAMA_MODEL: 'qwen3:8b',
    })).toMatchObject({ role: 'qwen', adapter: 'ollama', model: 'qwen3:8b' });
  });
});
