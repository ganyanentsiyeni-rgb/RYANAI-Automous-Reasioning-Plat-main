export const SUPPORTED_REASONING_PROVIDERS = Object.freeze([
  'openai',
  'deepseek',
  'anthropic',
  'openrouter',
  'nvidia',
  'qwen',
  'xai',
  'ollama',
]);

/**
 * MCP is a protocol client only. Provider credentials, endpoint selection,
 * model allowlists, Gen-X authorization and provider invocation remain in API.
 */
export async function routeReasoning(prompt, providerId = 'openai', model, options = {}) {
  const env = options.env || process.env;
  const delegatedToken = options.delegatedToken || '';
  const serviceToken = env.RYANAI_MCP_SERVICE_TOKEN || '';
  if (typeof delegatedToken !== 'string' || !delegatedToken) {
    throw new Error('An API-issued delegated identity is required for provider reasoning.');
  }
  if (typeof serviceToken !== 'string' || serviceToken.length < 32) {
    throw new Error('RyanAI MCP service authentication is not configured.');
  }
  if (!SUPPORTED_REASONING_PROVIDERS.includes(providerId)) {
    throw new Error('Unsupported provider selection.');
  }
  if (typeof model !== 'string' || !model.trim() || model.length > 200) {
    throw new Error('An explicit allowlisted provider model is required.');
  }
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!normalizedPrompt || normalizedPrompt.length > 20000) {
    throw new Error('Prompt must contain 1–20,000 characters.');
  }
  const responseFormat = options.responseFormat || 'text';
  if (!['text', 'json_object'].includes(responseFormat)) {
    throw new Error('responseFormat must be text or json_object.');
  }

  let base;
  try {
    base = new URL(env.RYANAI_API_BASE_URL || 'http://127.0.0.1:3000');
  } catch {
    throw new Error('RyanAI API base URL is invalid.');
  }
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]', 'api'].includes(base.hostname.toLowerCase());
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash
    || (base.protocol !== 'https:' && !loopback)) {
    throw new Error('Remote RyanAI API endpoints must use HTTPS and a clean origin.');
  }

  const endpoint = new URL('/api/internal/mcp/reasoning', base);
  const response = await (options.fetch || fetch)(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + delegatedToken,
      'x-ryanai-service-token': serviceToken,
    },
    body: JSON.stringify({
      providerId,
      model: model.trim(),
      prompt: normalizedPrompt,
      responseFormat,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const status = response.status;
    if (status === 401) throw new Error('RyanAI API rejected the delegated identity.');
    if (status === 403) throw new Error('Gen-X denied this provider request.');
    if (status === 429 || status === 503) throw new Error('RyanAI provider gateway is unavailable or rate limited.');
    throw new Error('RyanAI provider gateway returned HTTP ' + status + '.');
  }
  const payload = await response.json();
  if (payload?.success !== true || typeof payload.response !== 'string' || !payload.response.trim()
    || payload.providerId !== providerId || payload.model !== model.trim()) {
    throw new Error('RyanAI provider gateway returned an invalid response.');
  }
  return {
    mode: 'gateway',
    provider: payload.providerId,
    model: payload.model,
    response: payload.response,
    usage: payload.usage ?? null,
    responseFormat,
  };
}
