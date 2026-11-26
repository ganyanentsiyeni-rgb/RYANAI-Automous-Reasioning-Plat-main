import { resolveProviderRuntime, type ProviderId } from './providerRegistry.js';

export interface ProviderInvocationRequest {
  providerId: ProviderId;
  model: string;
  prompt: string;
  responseFormat?: 'text' | 'json_object';
}

export interface ProviderInvocationResult {
  response: string;
  usage: { inputTokens: number | null; outputTokens: number | null } | null;
}

function safeProviderError(status: number): string {
  if (status === 401 || status === 403) return 'Provider authentication was rejected.';
  if (status === 429) return 'Provider rate limit or quota was reached.';
  if (status >= 500) return 'Provider is temporarily unavailable.';
  return 'Provider rejected the request.';
}

/**
 * Shared API-owned provider adapter used by authenticated API routes and
 * approved AgentRun workers after their respective Gen-X authorization.
 * Provider credentials and endpoints never leave this server-side boundary.
 */
export async function invokeConfiguredProvider(
  body: ProviderInvocationRequest,
  signal: AbortSignal,
): Promise<ProviderInvocationResult> {
  const runtime = resolveProviderRuntime(body.providerId, body.model);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  let url: URL;
  let payload: Record<string, unknown>;

  if (runtime.adapter === 'anthropic-messages') {
    if (body.responseFormat === 'json_object') {
      throw new Error('Structured JSON response mode is not supported by the native Anthropic adapter yet.');
    }
    url = new URL('messages', runtime.endpoint.endsWith('/') ? runtime.endpoint : runtime.endpoint + '/');
    headers['anthropic-version'] = '2023-06-01';
    if (runtime.credential) headers['x-api-key'] = runtime.credential;
    payload = {
      model: runtime.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: body.prompt }],
    };
  } else {
    url = new URL('chat/completions', runtime.endpoint.endsWith('/') ? runtime.endpoint : runtime.endpoint + '/');
    if (runtime.credential) headers.authorization = 'Bearer ' + runtime.credential;
    payload = {
      model: runtime.model,
      messages: [{ role: 'user', content: body.prompt }],
      ...(body.responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) throw new Error(safeProviderError(response.status));

  const result = await response.json() as {
    choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown[] } }>;
    content?: Array<{ type?: string; text?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number };
  };
  const text = runtime.adapter === 'anthropic-messages'
    ? result.content?.filter((item) => item.type === 'text').map((item) => item.text ?? '').join('')
    : result.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Provider returned no text response; provider tool calls are not executed by this gateway.');
  }
  if (body.responseFormat === 'json_object') {
    try { JSON.parse(text); } catch { throw new Error('Provider did not return valid JSON.'); }
  }
  const inputTokens = result.usage?.prompt_tokens ?? result.usage?.input_tokens;
  const outputTokens = result.usage?.completion_tokens ?? result.usage?.output_tokens;
  return {
    response: text,
    usage: result.usage ? {
      inputTokens: typeof inputTokens === 'number' && Number.isFinite(inputTokens) && inputTokens >= 0 ? Math.floor(inputTokens) : null,
      outputTokens: typeof outputTokens === 'number' && Number.isFinite(outputTokens) && outputTokens >= 0 ? Math.floor(outputTokens) : null,
    } : null,
  };
}
