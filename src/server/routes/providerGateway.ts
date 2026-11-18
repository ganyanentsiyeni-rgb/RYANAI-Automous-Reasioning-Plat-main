import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { evaluateGenXSecurityEvent } from '../../security/genxPolicy.js';
import { listProviderRegistry, resolveProviderRuntime, type ProviderId, type ProviderRegistryEntry } from '../../agent/providerRegistry.js';
import { hasValidMcpServiceToken, verifyMcpDelegationToken } from '../security/mcpDelegation.js';

interface GatewayBody {
  providerId: ProviderId;
  model: string;
  prompt: string;
  responseFormat?: 'text' | 'json_object';
}

async function requireMcpService(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const expected = process.env.RYANAI_MCP_SERVICE_TOKEN?.trim() ?? '';
  if (expected.length < 32) {
    reply.code(503).send({ success: false, error: 'MCP service authentication is not configured.' });
    return;
  }
  if (!hasValidMcpServiceToken(request.headers['x-ryanai-service-token'], expected)) {
    reply.code(401).send({ success: false, error: 'Unauthorized MCP service.' });
  }
}

function safeProviderError(status: number): string {
  if (status === 401 || status === 403) return 'Provider authentication was rejected.';
  if (status === 429) return 'Provider rate limit or quota was reached.';
  if (status >= 500) return 'Provider is temporarily unavailable.';
  return 'Provider rejected the request.';
}

async function invokeProvider(body: GatewayBody, signal: AbortSignal) {
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
  return {
    response: text,
    usage: result.usage ? {
      inputTokens: result.usage.prompt_tokens ?? result.usage.input_tokens ?? null,
      outputTokens: result.usage.completion_tokens ?? result.usage.output_tokens ?? null,
    } : null,
  };
}

export const providerGatewayRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: GatewayBody }>('/api/internal/mcp/reasoning', {
    preHandler: requireMcpService,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['providerId', 'model', 'prompt'],
        additionalProperties: false,
        properties: {
          providerId: { type: 'string', enum: ['openai', 'deepseek', 'anthropic', 'openrouter', 'nvidia', 'qwen', 'xai', 'ollama'] },
          model: { type: 'string', minLength: 1, maxLength: 200 },
          prompt: { type: 'string', minLength: 1, maxLength: 20000 },
          responseFormat: { type: 'string', enum: ['text', 'json_object'] },
        },
      },
    },
  }, async (request, reply) => {
    const bearer = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization || '')?.[1];
    if (!bearer) return reply.code(401).send({ success: false, error: 'Delegated user identity is required.' });
    let claims: ReturnType<typeof verifyMcpDelegationToken>;
    try {
      claims = verifyMcpDelegationToken(bearer, process.env.RYANAI_MCP_DELEGATION_SECRET?.trim() ?? '');
    } catch {
      return reply.code(401).send({ success: false, error: 'Delegated user identity is invalid or expired.' });
    }
    if (!claims.scope.includes('reasoning_request')) {
      return reply.code(403).send({ success: false, error: 'Delegated identity does not grant provider reasoning.' });
    }

    const environment = process.env.NODE_ENV === 'production' ? 'production'
      : process.env.NODE_ENV === 'staging' ? 'staging' : 'development';
    const policy = evaluateGenXSecurityEvent({
      agentId: 'ryanai-api',
      principal: claims.sub,
      toolName: 'api_reasoning_request',
      action: 'NETWORK',
      target: 'configured-approved-provider',
      environment,
      actorType: 'human',
    });
    if (policy.decision !== 'ALLOW') {
      fastify.log.warn({ ruleId: policy.ruleId, principal: claims.sub, providerId: request.body.providerId }, 'Gen-X denied delegated provider request');
      return reply.code(403).send({ success: false, error: 'Gen-X denied this provider request.', ruleId: policy.ruleId });
    }

    let configured: ProviderRegistryEntry | undefined;
    try {
      configured = listProviderRegistry().find((entry) => entry.providerId === request.body.providerId);
    } catch {
      return reply.code(503).send({ success: false, error: 'Provider configuration is invalid.' });
    }
    if (!configured?.configured) {
      return reply.code(503).send({ success: false, error: 'The selected provider is not configured.' });
    }
    if (!configured.modelAllowlist.includes(request.body.model)) {
      return reply.code(400).send({ success: false, error: 'The requested model is not allowlisted for this provider.' });
    }
    if (request.body.providerId === 'anthropic' && request.body.responseFormat === 'json_object') {
      return reply.code(400).send({ success: false, error: 'Structured JSON response mode is not supported by the native Anthropic adapter yet.' });
    }

    try {
      const result = await invokeProvider(request.body, AbortSignal.timeout(60_000));
      return {
        success: true,
        providerId: request.body.providerId,
        model: request.body.model,
        response: result.response,
        usage: result.usage,
        policyDecision: policy.decision,
        ruleId: policy.ruleId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider request failed.';
      const unavailable = /temporarily unavailable|rate limit|quota|not configured/i.test(message);
      fastify.log.warn({ providerId: request.body.providerId, model: request.body.model, reason: message }, 'Governed provider request failed');
      return reply.code(unavailable ? 503 : 502).send({ success: false, error: message });
    }
  });
};
