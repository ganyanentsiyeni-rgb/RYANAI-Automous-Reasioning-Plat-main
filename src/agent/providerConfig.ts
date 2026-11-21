import type { BrainId } from './operationsCore.js';

export type CanonicalBrainRole = 'nvidia' | 'qwen' | 'logic';
export type InferenceAdapter = 'openai-compatible' | 'ollama';

export interface BrainProviderConfig {
  role: CanonicalBrainRole;
  adapter: InferenceAdapter;
  model: string;
  endpoint: string;
  credential: boolean;
}

type ProviderEnvironment = Record<string, string | undefined>;

const OLLAMA_DEFAULT_ENDPOINT = 'http://127.0.0.1:11434/v1';

function selectedProvider(brain: BrainId, env: ProviderEnvironment): string {
  return (brain === 'primary' ? env.PRIMARY_REASONING_PROVIDER || env.NVIDIA_PROVIDER
    : brain === 'secondary' ? env.SECONDARY_REASONING_PROVIDER || env.QWEN_PROVIDER
      : env.LOGIC_REASONING_PROVIDER || env.LOGIC_PROVIDER)?.trim().toLowerCase() || '';
}

function selectedAdapter(brain: BrainId, env: ProviderEnvironment): InferenceAdapter {
  const selector = selectedProvider(brain, env);
  const accepted = brain === 'primary' ? ['nvidia', 'ollama']
    : brain === 'secondary' ? ['qwen', 'ollama']
      : ['logic', 'openai', 'openai-compatible', 'ollama', 'grok', 'xai'];
  if (selector && !accepted.includes(selector)) {
    throw new Error('Unsupported provider selection for the ' + brain + ' brain.');
  }
  if (selector === 'ollama' || (!selector && brain === 'primary' && env.OLLAMA_PRIMARY_ENABLED === 'true')) return 'ollama';
  return 'openai-compatible';
}

function validateEndpoint(endpoint: string, role: CanonicalBrainRole): string {
  let parsed: URL;
  try { parsed = new URL(endpoint); } catch { throw new Error('Invalid endpoint for the ' + role + ' brain.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname.toLowerCase());
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.protocol !== 'https:' && !loopback)) {
    throw new Error('The ' + role + ' brain endpoint must use HTTPS unless it is loopback, without embedded credentials or query strings.');
  }
  return endpoint;
}

type QwenHostProvider = 'together' | 'openrouter' | 'dashscope' | 'siliconflow' | 'custom';

function isHostOrSubdomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith('.' + domain);
}

/** Provider identity is derived from the configured endpoint, never from the model name. */
function qwenHostProvider(endpoint: string): QwenHostProvider {
  const hostname = (() => {
    try { return new URL(endpoint).hostname.toLowerCase(); }
    catch { return ''; }
  })();
  if (!hostname) return 'custom';

  if (isHostOrSubdomain(hostname, 'together.xyz') || isHostOrSubdomain(hostname, 'together.ai')) return 'together';
  if (isHostOrSubdomain(hostname, 'openrouter.ai')) return 'openrouter';
  if (isHostOrSubdomain(hostname, 'siliconflow.com') || isHostOrSubdomain(hostname, 'siliconflow.cn')) return 'siliconflow';
  if (isHostOrSubdomain(hostname, 'aliyuncs.com') && (hostname.includes('dashscope') || hostname.includes('.maas.'))) return 'dashscope';
  return 'custom';
}

function qwenDefaultModel(endpoint: string): string {
  switch (qwenHostProvider(endpoint)) {
    case 'openrouter': return 'qwen/qwen3-235b-a22b-2507';
    case 'dashscope': return 'qwen3-235b-a22b-instruct-2507';
    case 'siliconflow': return 'Qwen/Qwen3-235B-A22B-Instruct-2507';
    case 'together':
    case 'custom':
      return 'Qwen/Qwen3-235B-A22B-Instruct-2507-tput';
  }
}

/**
 * Resolve the credential for the actual outbound endpoint.
 * QWEN_API_KEY remains the compatibility fallback for custom endpoints;
 * provider-specific keys take precedence when the endpoint identifies them.
 */
export function resolveBrainApiKey(
  brain: BrainId,
  config: Pick<BrainProviderConfig, 'adapter' | 'endpoint'>,
  env: ProviderEnvironment = process.env,
): string {
  if (config.adapter === 'ollama') return 'ollama';

  if (brain === 'primary') {
    return (env.NVIDIA_API_KEY || (config.endpoint === env.LM_STUDIO_URL ? env.LM_STUDIO_API_KEY : '') || '').trim();
  }

  if (brain === 'secondary') {
    const hostProvider = qwenHostProvider(config.endpoint);
    const providerKey = hostProvider === 'together' ? env.TOGETHER_API_KEY
      : hostProvider === 'openrouter' ? env.OPENROUTER_API_KEY
        : hostProvider === 'dashscope' ? env.DASHSCOPE_API_KEY
          : hostProvider === 'siliconflow' ? env.SILICONFLOW_API_KEY
            : undefined;
    const localKey = !env.QWEN_API_ENDPOINT && config.endpoint === env.LM_STUDIO_URL
      ? env.LM_STUDIO_API_KEY
      : undefined;
    return (providerKey || env.QWEN_API_KEY || localKey || '').trim();
  }

  const selector = selectedProvider('logic', env);
  if (selector === 'grok' || selector === 'xai') return (env.GROK_API_KEY || '').trim();
  return (env.LOGIC_API_KEY || env.OPENAI_API_KEY ||
    (config.endpoint === env.LM_STUDIO_URL ? env.LM_STUDIO_API_KEY : '') || '').trim();
}

/**
 * The API owns this canonical mapping. NVIDIA, Qwen and Logic are reasoning
 * roles; Ollama is an optional local inference adapter that can serve a role.
 * Selecting Ollama is explicit and never falls back to a cloud provider.
 */
export function resolveBrainProviderConfig(
  brain: BrainId,
  env: ProviderEnvironment = process.env,
): BrainProviderConfig {
  const role: CanonicalBrainRole = brain === 'primary' ? 'nvidia' : brain === 'secondary' ? 'qwen' : 'logic';
  const selector = selectedProvider(brain, env);
  if (brain === 'logic' && (selector === 'grok' || selector === 'xai')) {
    const config = {
      role,
      adapter: 'openai-compatible' as const,
      model: env.GROK_MODEL?.trim() || '',
      endpoint: validateEndpoint(env.GROK_API_ENDPOINT || 'https://api.x.ai/v1', role),
    };
    return { ...config, credential: Boolean(resolveBrainApiKey(brain, config, env)) };
  }
  if (selectedAdapter(brain, env) === 'ollama') {
    const roleModel = brain === 'primary' ? env.PRIMARY_REASONING_MODEL
      : brain === 'secondary' ? env.SECONDARY_REASONING_MODEL : env.LOGIC_REASONING_MODEL;
    return {
      role,
      adapter: 'ollama',
      model: env.OLLAMA_MODEL || roleModel || '',
      endpoint: validateEndpoint(env.OLLAMA_BASE_URL || env.OLLAMA_URL || OLLAMA_DEFAULT_ENDPOINT, role),
      credential: false,
    };
  }

  if (brain === 'primary') {
    const config = {
      role,
      adapter: 'openai-compatible' as const,
      model: env.PRIMARY_REASONING_MODEL || env.NVIDIA_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b',
      endpoint: validateEndpoint(env.NVIDIA_API_ENDPOINT || env.LM_STUDIO_URL || 'https://integrate.api.nvidia.com/v1', role),
    };
    return { ...config, credential: Boolean(resolveBrainApiKey(brain, config, env)) };
  }

  if (brain === 'secondary') {
    const endpoint = validateEndpoint(env.QWEN_API_ENDPOINT || env.LM_STUDIO_URL || 'https://api.together.xyz/v1', role);
    const config = {
      role,
      adapter: 'openai-compatible' as const,
      model: env.SECONDARY_REASONING_MODEL || env.QWEN_MODEL || qwenDefaultModel(endpoint),
      endpoint,
    };
    return { ...config, credential: Boolean(resolveBrainApiKey(brain, config, env)) };
  }

  const config = {
    role,
    adapter: 'openai-compatible' as const,
    model: env.LOGIC_REASONING_MODEL || env.LM_STUDIO_MODEL || env.OPENAI_MODEL || 'gpt-4o-mini',
    endpoint: validateEndpoint(env.LOGIC_API_ENDPOINT || env.OPENAI_BASE_URL || env.LM_STUDIO_URL || 'https://api.openai.com/v1', role),
  };
  return { ...config, credential: Boolean(resolveBrainApiKey(brain, config, env)) };
}
