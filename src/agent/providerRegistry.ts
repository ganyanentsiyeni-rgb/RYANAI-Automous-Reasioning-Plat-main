/**
 * API-owned provider registry.
 *
 * This module resolves server-side provider configuration only. It does not
 * dispatch requests or make policy decisions; callers must authorize through
 * the API/Gen-X boundary before invoking a provider adapter.
 */
export type ProviderId =
  | 'openai'
  | 'deepseek'
  | 'anthropic'
  | 'openrouter'
  | 'nvidia'
  | 'qwen'
  | 'xai'
  | 'ollama';

export type ProviderAdapter =
  | 'openai-compatible'
  | 'anthropic-messages'
  | 'ollama';

export type ProviderConfigurationStatus = 'configured' | 'unconfigured';

export interface ProviderRegistryEntry {
  providerId: ProviderId;
  adapter: ProviderAdapter;
  endpoint: string;
  credentialRef: string | null;
  configured: boolean;
  modelAllowlist: readonly string[];
}

export interface ProviderEnvironment {
  [key: string]: string | undefined;
}

interface ProviderDefinition {
  adapter: ProviderAdapter;
  endpointEnv: string;
  endpointFallbackEnv?: string;
  defaultEndpoint: string;
  credentialEnv: string | null;
  modelEnv: string;
  modelFallbackEnv?: string;
  defaultModels: readonly string[];
  allowLoopbackHttp?: boolean;
}

const DEFINITIONS: Record<ProviderId, ProviderDefinition> = {
  openai: {
    adapter: 'openai-compatible',
    endpointEnv: 'OPENAI_API_ENDPOINT',
    endpointFallbackEnv: 'OPENAI_BASE_URL',
    defaultEndpoint: 'https://api.openai.com/v1',
    credentialEnv: 'OPENAI_API_KEY',
    modelEnv: 'OPENAI_MODEL_ALLOWLIST',
    modelFallbackEnv: 'OPENAI_MODEL',
    defaultModels: ['gpt-4o-mini', 'gpt-4o'],
  },
  deepseek: {
    adapter: 'openai-compatible',
    endpointEnv: 'DEEPSEEK_API_ENDPOINT',
    defaultEndpoint: 'https://api.deepseek.com/v1',
    credentialEnv: 'DEEPSEEK_API_KEY',
    modelEnv: 'DEEPSEEK_MODEL_ALLOWLIST',
    modelFallbackEnv: 'DEEPSEEK_MODEL',
    defaultModels: ['DeepSeek-V4.1-Flash-1017'],
    allowLoopbackHttp: true,
  },
  anthropic: {
    adapter: 'anthropic-messages',
    endpointEnv: 'ANTHROPIC_API_ENDPOINT',
    defaultEndpoint: 'https://api.anthropic.com/v1',
    credentialEnv: 'ANTHROPIC_API_KEY',
    modelEnv: 'ANTHROPIC_MODEL_ALLOWLIST',
    defaultModels: [],
  },
  openrouter: {
    adapter: 'openai-compatible',
    endpointEnv: 'OPENROUTER_API_ENDPOINT',
    defaultEndpoint: 'https://openrouter.ai/api/v1',
    credentialEnv: 'OPENROUTER_API_KEY',
    modelEnv: 'OPENROUTER_MODEL_ALLOWLIST',
    modelFallbackEnv: 'OPENROUTER_MODEL',
    defaultModels: ['~openai/gpt-latest', '~anthropic/claude-sonnet-latest'],
  },
  nvidia: {
    adapter: 'openai-compatible',
    endpointEnv: 'NVIDIA_API_ENDPOINT',
    defaultEndpoint: 'https://integrate.api.nvidia.com/v1',
    credentialEnv: 'NVIDIA_API_KEY',
    modelEnv: 'NVIDIA_MODEL_ALLOWLIST',
    modelFallbackEnv: 'NVIDIA_MODEL',
    defaultModels: ['nvidia/nemotron-3-ultra-550b-a55b'],
  },
  qwen: {
    adapter: 'openai-compatible',
    endpointEnv: 'QWEN_API_ENDPOINT',
    defaultEndpoint: 'https://api.together.xyz/v1',
    credentialEnv: 'QWEN_API_KEY',
    modelEnv: 'QWEN_MODEL_ALLOWLIST',
    modelFallbackEnv: 'QWEN_MODEL',
    defaultModels: ['Qwen/Qwen3-235B-A22B-Instruct-2507-tput'],
  },
  xai: {
    adapter: 'openai-compatible',
    endpointEnv: 'GROK_API_ENDPOINT',
    defaultEndpoint: 'https://api.x.ai/v1',
    credentialEnv: 'GROK_API_KEY',
    modelEnv: 'GROK_MODEL_ALLOWLIST',
    modelFallbackEnv: 'GROK_MODEL',
    defaultModels: [],
  },
  ollama: {
    adapter: 'ollama',
    endpointEnv: 'OLLAMA_BASE_URL',
    endpointFallbackEnv: 'OLLAMA_URL',
    defaultEndpoint: 'http://127.0.0.1:11434/v1',
    credentialEnv: null,
    modelEnv: 'OLLAMA_MODEL_ALLOWLIST',
    modelFallbackEnv: 'OLLAMA_MODEL',
    defaultModels: [],
    allowLoopbackHttp: true,
  },
};

function parseModels(value: string | undefined, fallback: string | undefined, defaults: readonly string[]): string[] {
  const configured = value?.trim() || fallback?.trim();
  const models = configured?.split(',').map((model) => model.trim()).filter(Boolean);
  return [...new Set(models?.length ? models : defaults)];
}

function providerEndpoint(providerId: ProviderId, env: ProviderEnvironment): string {
  const definition = DEFINITIONS[providerId];
  return validateEndpoint(providerId,
    env[definition.endpointEnv]?.trim() ||
    (definition.endpointFallbackEnv ? env[definition.endpointFallbackEnv]?.trim() : '') ||
    definition.defaultEndpoint);
}

function providerModels(providerId: ProviderId, env: ProviderEnvironment): string[] {
  const definition = DEFINITIONS[providerId];
  return parseModels(env[definition.modelEnv],
    definition.modelFallbackEnv ? env[definition.modelFallbackEnv] : undefined,
    definition.defaultModels);
}

function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const hostname = new URL(endpoint).hostname.toLowerCase();
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
  } catch { return false; }
}

function validateEndpoint(providerId: ProviderId, endpoint: string): string {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('Invalid endpoint configured for provider ' + providerId + '.');
  }

  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname.toLowerCase());
  const allowLoopback = DEFINITIONS[providerId].allowLoopbackHttp === true;
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.protocol !== 'https:' && !(allowLoopback && loopback))
  ) {
    throw new Error('Provider ' + providerId + ' endpoint must use HTTPS, except for explicitly supported loopback adapters, and cannot contain credentials, query strings, or fragments.');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function listProviderRegistry(
  env: ProviderEnvironment = process.env,
): ProviderRegistryEntry[] {
  return (Object.keys(DEFINITIONS) as ProviderId[]).map((providerId) => {
    const definition = DEFINITIONS[providerId];
    const endpoint = providerEndpoint(providerId, env);
    const modelAllowlist = providerModels(providerId, env);
    const configured = providerId === 'ollama' || (definition.allowLoopbackHttp && isLoopbackEndpoint(endpoint))
      ? modelAllowlist.length > 0
      : Boolean(definition.credentialEnv && env[definition.credentialEnv]?.trim());

    return {
      providerId,
      adapter: definition.adapter,
      endpoint,
      credentialRef: definition.credentialEnv,
      configured,
      modelAllowlist,
    };
  });
}

export interface ResolvedProviderRuntime {
  providerId: ProviderId;
  adapter: ProviderAdapter;
  endpoint: string;
  model: string;
  /** Server-side only. Never serialize or return this value to clients or MCP. */
  credential: string | null;
}

/**
 * Resolve a server-side provider runtime after the caller has completed
 * authentication and Gen-X authorization. The returned credential is secret.
 */
export function resolveProviderRuntime(
  providerId: ProviderId,
  model: string,
  env: ProviderEnvironment = process.env,
): ResolvedProviderRuntime {
  const definition = DEFINITIONS[providerId];
  if (!definition) throw new Error('Unsupported provider.');
  const modelAllowlist = providerModels(providerId, env);
  if (!model || !modelAllowlist.includes(model)) {
    throw new Error('The requested model is not allowlisted for provider ' + providerId + '.');
  }

  const endpoint = providerEndpoint(providerId, env);
  const credential = definition.credentialEnv
    ? env[definition.credentialEnv]?.trim() || null
    : null;
  const localUnauthenticated = definition.allowLoopbackHttp === true && isLoopbackEndpoint(endpoint);
  if (providerId !== 'ollama' && !localUnauthenticated && !credential) {
    throw new Error('Provider ' + providerId + ' is unconfigured; no provider request was made.');
  }

  return { providerId, adapter: definition.adapter, endpoint, model, credential };
}
